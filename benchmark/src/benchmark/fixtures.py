"""Stratified fixture bank (SRS "Banco de confrontos") — a fixed, versioned set of matchups
covering strong-vs-weak (both directions), similar-strength pairs, derbies, formation/style
variety and scripted substitution scenarios. Built once from `world_ratings` (deterministic given
a world_seed) and frozen to snapshots/fixtures_bank.json before any calibration search touches it.
"""

from __future__ import annotations

import itertools
import json
import random
from dataclasses import asdict, dataclass, field, replace
from pathlib import Path
from typing import Any, Optional

import yaml

from .engine_adapter import EngineAdapter

ATTACK_POSITIONS = {"CA", "SA", "PD", "PE"}


@dataclass
class FixtureSpec:
    fixture_id: str
    stratum: str
    home_club_id: str
    away_club_id: str
    home_formation: str
    home_style: str
    away_formation: str
    away_style: str
    tactical_intensity: str
    home_rating_overall: float
    away_rating_overall: float
    notes: str = ""
    substitutions: Optional[list[dict]] = None

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "FixtureSpec":
        return cls(**data)


def load_fixtures_config(path: Path) -> dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def _build_substitution(adapter: EngineAdapter, world_seed: int, club_id: str, formation: str, style: str) -> Optional[dict]:
    squad = adapter.request("squad", club_id=club_id, world_seed=world_seed, formation=formation, style=style)
    starters, bench = squad["starters"], squad["bench"]
    if not bench:
        return None

    def pick(players: list[dict]) -> Optional[dict]:
        for p in players:
            if p["position"] in ATTACK_POSITIONS:
                return p
        return next((p for p in players if p["position"] != "GOL"), None)

    starter = pick(starters)
    replacement = pick(bench)
    if starter is None or replacement is None:
        return None
    return {"minute": 60, "teamSide": "home", "playerOutId": starter["id"], "playerIn": replacement}


def build_fixture_bank(adapter: EngineAdapter, config: dict[str, Any]) -> list[FixtureSpec]:
    world_seed = config["world_seed"]
    tactical_intensity = config["tactical_intensity"]

    ratings = adapter.world_ratings(world_seed=world_seed, tactical_intensity=tactical_intensity)["clubs"]
    ranked = sorted(ratings, key=lambda c: c["overall"], reverse=True)
    ids = [c["club_id"] for c in ranked]
    by_id = {c["club_id"]: c for c in ranked}
    m = len(ids)

    tiers = config["tiers"]
    top = ids[: tiers["top_n"]]
    bottom = ids[-tiers["bottom_n"] :]

    fixtures: list[FixtureSpec] = []

    def add(
        fixture_id: str,
        stratum: str,
        home: str,
        away: str,
        home_formation: Optional[str] = None,
        home_style: Optional[str] = None,
        away_formation: Optional[str] = None,
        away_style: Optional[str] = None,
        notes: str = "",
    ) -> FixtureSpec:
        spec = FixtureSpec(
            fixture_id=fixture_id,
            stratum=stratum,
            home_club_id=home,
            away_club_id=away,
            home_formation=home_formation or by_id[home]["formation"],
            home_style=home_style or by_id[home]["style"],
            away_formation=away_formation or by_id[away]["formation"],
            away_style=away_style or by_id[away]["style"],
            tactical_intensity=tactical_intensity,
            home_rating_overall=by_id[home]["overall"],
            away_rating_overall=by_id[away]["overall"],
            notes=notes,
        )
        fixtures.append(spec)
        return spec

    strata = config["strata"]

    # -- mandante forte x visitante fraco / invertido -------------------------------------------
    n = strata["strong_home_weak_away"]["count"]
    for i in range(n):
        h, a = top[i % len(top)], bottom[i % len(bottom)]
        add(f"strong_home_weak_away__{h}__{a}__{i}", "strong_home_weak_away", h, a)

    n = strata["weak_home_strong_away"]["count"]
    for i in range(n):
        h, a = bottom[i % len(bottom)], top[i % len(top)]
        add(f"weak_home_strong_away__{h}__{a}__{i}", "weak_home_strong_away", h, a)

    # -- times de força semelhante: pares adjacentes na tabela, espaçados pra cobrir tudo --------
    n = strata["similar_strength"]["count"]
    if m >= 2 and n > 0:
        step = max(1, (m - 1) // n)
        idx = 0
        for count in range(n):
            if idx >= m - 1:
                idx = count % (m - 1)
            h, a = ids[idx], ids[idx + 1]
            if count % 2 == 1:
                h, a = a, h
            add(f"similar_strength__{h}__{a}__{count}", "similar_strength", h, a)
            idx += step

    # -- clássicos, nas duas direções de mando ----------------------------------------------------
    n = strata["derby"]["count"]
    count = 0
    for h_ref, a_ref in config["derbies"]:
        if count >= n:
            break
        if h_ref not in by_id or a_ref not in by_id:
            continue  # clube ausente neste world_seed/dataset — pula silenciosamente
        add(f"derby__{h_ref}__{a_ref}", "derby", h_ref, a_ref, notes="clássico")
        count += 1
        if count >= n:
            break
        add(f"derby__{a_ref}__{h_ref}", "derby", a_ref, h_ref, notes="clássico (mando invertido)")
        count += 1

    # -- formações/estilos variados, em confrontos de força parecida -----------------------------
    n = strata["formation_style_variety"]["count"]
    combos = list(itertools.product(config["formations"], config["styles"]))
    rng = random.Random(1234567)  # shuffle determinístico — não é o RNG do motor, só ordena a lista de combos
    rng.shuffle(combos)
    for i in range(n):
        h = ids[i % m]
        a_idx = (i + m // 2) % m
        if ids[a_idx] == h:
            a_idx = (a_idx + 1) % m
        a = ids[a_idx]
        hf, hs = combos[i % len(combos)]
        af, aw = combos[(i + 1) % len(combos)]
        add(
            f"formation_style__{h}_{hf}_{hs}__vs__{a}_{af}_{aw}__{i}",
            "formation_style_variety",
            h,
            a,
            home_formation=hf,
            home_style=hs,
            away_formation=af,
            away_style=aw,
        )

    # -- substituição roteirizada: reaproveita fixtures de força desigual já geradas -------------
    n = strata["substitution_scenario"]["count"]
    base_pool = [f for f in fixtures if f.stratum in ("strong_home_weak_away", "weak_home_strong_away")]
    made = 0
    for base in base_pool:
        if made >= n:
            break
        sub = _build_substitution(adapter, world_seed, base.home_club_id, base.home_formation, base.home_style)
        if sub is None:
            continue
        fixtures.append(
            replace(
                base,
                fixture_id=f"sub_scenario__{base.fixture_id}",
                stratum="substitution_scenario",
                substitutions=[sub],
                notes="substituição roteirizada (minuto 60, mandante)",
            )
        )
        made += 1

    return fixtures


def save_fixture_bank(fixtures: list[FixtureSpec], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump([spec.to_dict() for spec in fixtures], f, ensure_ascii=False, indent=2)


def load_fixture_bank(path: Path) -> list[FixtureSpec]:
    with open(path, encoding="utf-8") as f:
        return [FixtureSpec.from_dict(d) for d in json.load(f)]


def strata_summary(fixtures: list[FixtureSpec]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for spec in fixtures:
        counts[spec.stratum] = counts.get(spec.stratum, 0) + 1
    return counts
