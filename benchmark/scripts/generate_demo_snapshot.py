"""One-off generator for snapshots/real/brasileirao_demo.csv — a SYNTHETIC stand-in for a real
licensed Brasileirão results snapshot (CBF/OpenFootball), used only to exercise the benchmark's
Dixon-Coles fit + real-vs-DC-vs-engine comparison pipeline end to end.

This is NOT real observed data — see snapshots/real/README.md. The sandbox this tool was built in
has no access to a licensed match-results dataset (no live scraping is allowed by design — SRS
"o benchmark não deve depender de scraping ao vivo" — and no bundled CBF/OpenFootball export was
available to vendor in). Swap this file for a real snapshot before trusting any calibration
decision made against it; the loader (targets.py-equivalent logic in comparison.py) only cares
about the CSV schema, not this generator.

Goals are drawn i.i.d. Poisson per team, rate = base_home_or_away x attack_factor(reputation) x
defense_factor(opponent reputation) — base rates chosen so the aggregate goals/game and
win/draw/loss split land in the neighborhood of published Série A aggregates (~2.5 goals/game,
roughly 45/27/28% home/draw/away), without claiming precision beyond "plausible order of
magnitude for pipeline testing".
"""

from __future__ import annotations

import hashlib
import json
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from benchmark.engine_adapter import EngineAdapter

BASE_HOME_RATE = 1.55
BASE_AWAY_RATE = 1.15
SEASONS = [2024, 2025]
RNG_SEED = 20260829


def round_robin_pairs(teams: list[str]) -> list[list[tuple[str, str]]]:
    """Classic circle method — n-1 rounds, n/2 pairs each, n even."""
    items: list[str | None] = list(teams)
    if len(items) % 2 != 0:
        items.append(None)
    n = len(items)
    rounds = []
    for _ in range(n - 1):
        pairs = []
        for i in range(n // 2):
            a, b = items[i], items[n - 1 - i]
            if a is not None and b is not None:
                pairs.append((a, b))
        rounds.append(pairs)
        items.insert(1, items.pop())
    return rounds


def main() -> None:
    with EngineAdapter() as adapter:
        clubs = adapter.world_ratings(world_seed=2026)["clubs"]

    club_df = pd.DataFrame(clubs)[["club_id", "reputation"]].set_index("club_id")
    rep_z = (club_df["reputation"] - club_df["reputation"].mean()) / club_df["reputation"].std()
    attack_factor = 1.0 + 0.18 * rep_z
    defense_factor = 1.0 - 0.12 * rep_z

    teams = club_df.index.tolist()
    rng = np.random.default_rng(RNG_SEED)
    rounds = round_robin_pairs(teams)

    rows = []
    for season in SEASONS:
        match_date = date(season, 4, 13)
        round_no = 0
        # turno (mando como veio do circle method) + returno (mando invertido)
        for leg in (0, 1):
            for pairs in rounds:
                round_no += 1
                for home, away in pairs:
                    if leg == 1:
                        home, away = away, home
                    lam_home = BASE_HOME_RATE * attack_factor[home] * defense_factor[away]
                    lam_away = BASE_AWAY_RATE * attack_factor[away] * defense_factor[home]
                    home_goals = int(rng.poisson(max(lam_home, 0.05)))
                    away_goals = int(rng.poisson(max(lam_away, 0.05)))
                    rows.append(
                        {
                            "season": season,
                            "round": round_no,
                            "date": match_date.isoformat(),
                            "home_team": home,
                            "away_team": away,
                            "home_goals": home_goals,
                            "away_goals": away_goals,
                        }
                    )
                match_date += timedelta(days=7)

    df = pd.DataFrame(rows)
    out_dir = Path(__file__).resolve().parents[1] / "snapshots" / "real"
    out_dir.mkdir(parents=True, exist_ok=True)
    csv_path = out_dir / "brasileirao_demo.csv"
    df.to_csv(csv_path, index=False)

    checksum = hashlib.sha256(csv_path.read_bytes()).hexdigest()
    manifest = {
        "source": "SYNTHETIC DEMO — not real observed results (see snapshots/real/README.md)",
        "url": None,
        "seasons": SEASONS,
        "collected_at": None,
        "license": "N/A — gerado localmente com scripts/generate_demo_snapshot.py só pra exercitar o pipeline",
        "transformation": (
            "gols i.i.d. Poisson por time; taxa = base_mando x fator_ataque(reputação) x "
            "fator_defesa(reputação do adversário); parâmetros base escolhidos pra aproximar a "
            "ordem de grandeza de agregados publicados do Brasileirão, sem reivindicar precisão"
        ),
        "checksum_sha256": checksum,
        "n_matches": len(df),
        "fields": list(df.columns),
        "generator": "benchmark/scripts/generate_demo_snapshot.py",
        "generator_seed": RNG_SEED,
    }
    (out_dir / "brasileirao_demo.manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"wrote {len(df)} matches to {csv_path} (checksum {checksum[:12]}...)")
    print(
        "goals/game:",
        round(float((df.home_goals + df.away_goals).mean()), 3),
        "home_win_rate:",
        round(float((df.home_goals > df.away_goals).mean()), 3),
        "draw_rate:",
        round(float((df.home_goals == df.away_goals).mean()), 3),
    )


if __name__ == "__main__":
    main()
