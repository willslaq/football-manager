"""Metric computation over flattened match/event/season records (see events.py for the row
schemas). Every function here is grounded in data the engine actually returns — where a metric
the SRS asks for needs data the engine doesn't expose without a full per-chance trace (e.g. which
position committed a given foul — fouls aren't `MatchEvent`s, only visible via the `onChance`
'foul' trace entries), the docstring says so plainly and the function operates on a trace-sample
DataFrame instead of pretending it's available for every match.

Two goal-scoring event types plus the goal itself make up an on-target-or-not shot: 'goal',
'shot_saved', 'shot_missed' all carry the shooter's `playerId`, which is how shots/conversion by
position get computed without needing a trace (SRS "gols/90 = chutes/90 × conversão").
"""

from __future__ import annotations

import math
from typing import Any, Optional

import numpy as np
import pandas as pd

SHOT_EVENT_TYPES = ("goal", "shot_saved", "shot_missed")
GOAL_BUCKET_LABELS = ["0", "1", "2", "3", "4", "5+"]


def _bucket_goals(n: int) -> str:
    return "5+" if n >= 5 else str(n)


# --- invariantes rápidos (usados durante a corrida pra popular failures.jsonl) -------------------


def check_match_invariants(record: dict) -> list[str]:
    """Checagens baratas o bastante pra rodar em toda partida de um Monte Carlo grande — não
    substitui os testes de propriedade (Hypothesis) em tests/test_properties.py, que exploram bem
    mais o espaço; isso aqui é o que separa uma partida "suspeita" pra failures.jsonl em produção."""
    problems: list[str] = []
    stats = record.get("stats") or {}
    events = record.get("events") or []

    home_goals, away_goals = record.get("home_goals"), record.get("away_goals")
    if home_goals is None or away_goals is None or home_goals < 0 or away_goals < 0:
        problems.append("placar negativo ou ausente")
    for value in (home_goals, away_goals):
        if value is not None and (not math.isfinite(value)):
            problems.append("placar não finito (NaN/Inf)")

    shots = stats.get("shots", {})
    shots_on_target = stats.get("shotsOnTarget", {})
    for side in ("home", "away"):
        if shots_on_target.get(side, 0) > shots.get(side, 0):
            problems.append(f"shotsOnTarget > shots ({side})")
    goals_from_events_home = sum(1 for e in events if e["type"] == "goal" and e["teamId"] == record["home_team"])
    goals_from_events_away = sum(1 for e in events if e["type"] == "goal" and e["teamId"] == record["away_team"])
    if goals_from_events_home != home_goals or goals_from_events_away != away_goals:
        problems.append("placar final não reconcilia com a contagem de eventos 'goal'")

    possession = stats.get("possession", {})
    total_possession = (possession.get("home", 0) or 0) + (possession.get("away", 0) or 0)
    if not (95 <= total_possession <= 105):
        problems.append(f"posse não soma ~100 ({total_possession})")

    minutes = [e["minute"] for e in events]
    if minutes != sorted(minutes):
        problems.append("eventos fora de ordem cronológica")
    if any(m < 1 or m > 90 for m in minutes):
        problems.append("evento com minuto fora de [1, 90]")

    return problems


# --- gols / placar -------------------------------------------------------------------------------


def goal_metrics(df: pd.DataFrame) -> dict[str, Any]:
    n = len(df)
    if n == 0:
        return {"n": 0}
    home_wins = int((df["home_goals"] > df["away_goals"]).sum())
    draws = int((df["home_goals"] == df["away_goals"]).sum())
    away_wins = int((df["away_goals"] > df["home_goals"]).sum())

    goal_dist_total = df["total_goals"].apply(_bucket_goals).value_counts(normalize=True).reindex(GOAL_BUCKET_LABELS, fill_value=0.0)
    goal_dist_home = df["home_goals"].apply(_bucket_goals).value_counts(normalize=True).reindex(GOAL_BUCKET_LABELS, fill_value=0.0)
    goal_dist_away = df["away_goals"].apply(_bucket_goals).value_counts(normalize=True).reindex(GOAL_BUCKET_LABELS, fill_value=0.0)

    score_key = df["home_goals"].clip(upper=5).astype(str) + "-" + df["away_goals"].clip(upper=5).astype(str)
    scoreline_freq = score_key.value_counts(normalize=True).to_dict()

    return {
        "n": n,
        "goals_per_match": float(df["total_goals"].mean()),
        "goals_per_match_home": float(df["home_goals"].mean()),
        "goals_per_match_away": float(df["away_goals"].mean()),
        "home_win_rate": home_wins / n,
        "draw_rate": draws / n,
        "away_win_rate": away_wins / n,
        "home_advantage_win_pp": (home_wins - away_wins) / n,
        "goal_diff_mean": float((df["home_goals"] - df["away_goals"]).mean()),
        "clean_sheet_rate_home": float((df["away_goals"] == 0).mean()),
        "clean_sheet_rate_away": float((df["home_goals"] == 0).mean()),
        "score_0_0": float(scoreline_freq.get("0-0", 0.0)),
        "score_1_0": float(scoreline_freq.get("1-0", 0.0)),
        "score_0_1": float(scoreline_freq.get("0-1", 0.0)),
        "score_1_1": float(scoreline_freq.get("1-1", 0.0)),
        "goal_distribution_total": goal_dist_total.to_dict(),
        "goal_distribution_home": goal_dist_home.to_dict(),
        "goal_distribution_away": goal_dist_away.to_dict(),
        "score_matrix": _score_matrix(df),
    }


def _score_matrix(df: pd.DataFrame) -> dict[str, dict[str, float]]:
    h = df["home_goals"].clip(upper=5).apply(_bucket_goals)
    a = df["away_goals"].clip(upper=5).apply(_bucket_goals)
    table = pd.crosstab(h, a, normalize=True).reindex(index=GOAL_BUCKET_LABELS, columns=GOAL_BUCKET_LABELS, fill_value=0.0)
    return {row: table.loc[row].to_dict() for row in table.index}


def strength_response_metrics(df: pd.DataFrame, *, n_bins: int = 5) -> dict[str, Any]:
    """'saldo esperado por faixa de força' e 'taxa de zebra por diferença de rating' — bineia por
    (rating geral do mandante) - (rating geral do visitante)."""
    if len(df) == 0:
        return {"bins": []}
    rating_diff = (df["home_attack"] + df["home_defense"] + df["home_midfield"]) / 3 - (
        df["away_attack"] + df["away_defense"] + df["away_midfield"]
    ) / 3
    goal_diff = df["home_goals"] - df["away_goals"]
    try:
        bin_labels = pd.qcut(rating_diff, q=min(n_bins, rating_diff.nunique()), duplicates="drop")
    except ValueError:
        return {"bins": []}

    bins = []
    for interval, group in df.groupby(bin_labels, observed=True):
        gd = (group["home_goals"] - group["away_goals"]) if len(group) else pd.Series(dtype=float)
        weaker_is_home = rating_diff.loc[group.index] < 0
        stronger_won = np.where(
            weaker_is_home, group["away_goals"] > group["home_goals"], group["home_goals"] > group["away_goals"]
        )
        upset_rate = float(1 - np.mean(stronger_won)) if len(group) else None
        bins.append(
            {
                "rating_diff_range": [float(interval.left), float(interval.right)],
                "n": int(len(group)),
                "goal_diff_mean": float(gd.mean()) if len(group) else None,
                "upset_rate": upset_rate,
            }
        )
    return {"bins": bins}


# --- disciplina ------------------------------------------------------------------------------


def discipline_metrics(df: pd.DataFrame, events_df: pd.DataFrame) -> dict[str, Any]:
    n = len(df)
    if n == 0:
        return {"n": 0}
    yellow = df["yellow_cards_home"] + df["yellow_cards_away"]
    red = df["red_cards_home"] + df["red_cards_away"]
    fouls = df["fouls_home"] + df["fouls_away"]

    cards = events_df[events_df["type"].isin(["yellow_card", "red_card"])] if len(events_df) else events_df
    by_position = (
        cards.groupby(["type", "position"]).size().unstack(fill_value=0).to_dict() if len(cards) else {}
    )
    minute_stats = {
        card_type: {
            "mean": float(sub["minute"].mean()),
            "p50": float(sub["minute"].median()),
        }
        for card_type, sub in cards.groupby("type")
        if len(sub)
    }

    second_yellow_rate = _second_yellow_rate(events_df)

    return {
        "n": n,
        "fouls_per_match": float(fouls.mean()),
        "yellow_cards_per_match": float(yellow.mean()),
        "red_cards_per_match": float(red.mean()),
        "cards_by_position": by_position,
        "card_minute_stats": minute_stats,
        "second_yellow_rate_of_reds": second_yellow_rate,
        "cards_by_scoreline_state": cards_by_scoreline_state(events_df),
        "note": (
            "faltas/cartões por POSIÇÃO de quem cometeu a falta (não o cartão) exigem trace "
            "('foul' kind do onChance) — ver foul_origin_metrics(), que só opera sobre a amostra "
            "traçada, não sobre toda partida do Monte Carlo."
        ),
    }


def _second_yellow_rate(events_df: pd.DataFrame) -> Optional[float]:
    """Detecta 2º amarelo: mesmo jogador com yellow_card e red_card no MESMO minuto da mesma
    partida (é assim que o motor emite os dois eventos — ver match.ts's resolveFoul)."""
    if len(events_df) == 0:
        return None
    cards = events_df[events_df["type"].isin(["yellow_card", "red_card"])]
    if len(cards) == 0:
        return None
    reds = cards[cards["type"] == "red_card"]
    if len(reds) == 0:
        return 0.0
    yellows = cards[cards["type"] == "yellow_card"].set_index(["run_id", "player_id", "minute"]).index
    is_second_yellow = reds.apply(lambda r: (r["run_id"], r["player_id"], r["minute"]) in yellows, axis=1)
    return float(is_second_yellow.mean())


def cards_by_scoreline_state(events_df: pd.DataFrame) -> dict[str, float]:
    """Pra cada cartão, reconstrói o placar até aquele minuto (via os eventos 'goal' da mesma
    partida) e classifica o estado do time que recebeu o cartão: leading/level/trailing."""
    if len(events_df) == 0:
        return {}
    counts = {"leading": 0, "level": 0, "trailing": 0}
    for run_id, match_events in events_df.groupby("run_id"):
        goals = match_events[match_events["type"] == "goal"].sort_values("minute")
        cards = match_events[match_events["type"].isin(["yellow_card", "red_card"])]
        for _, card in cards.iterrows():
            prior_goals = goals[goals["minute"] <= card["minute"]]
            own_goals = int((prior_goals["team_id"] == card["team_id"]).sum())
            opp_goals = int(len(prior_goals) - own_goals)
            if own_goals > opp_goals:
                counts["leading"] += 1
            elif own_goals < opp_goals:
                counts["trailing"] += 1
            else:
                counts["level"] += 1
    total = sum(counts.values())
    return {k: (v / total if total else 0.0) for k, v in counts.items()}


def foul_origin_metrics(trace_records: list[dict], player_index: dict[str, dict]) -> dict[str, Any]:
    """Decomposição faltas/cartões por posição — SÓ a partir de partidas rodadas com trace=True
    (onChance 'foul' entries carregam foulerId/zone/card; MatchEvent não). cartões/90 = faltas/90 x
    cartões-por-falta; mostra os dois fatores separados, não só o produto."""
    rows = []
    for record in trace_records:
        for entry in record.get("trace") or []:
            if entry.get("kind") != "foul":
                continue
            fouler = player_index.get(entry.get("foulerId"), {})
            rows.append(
                {
                    "run_id": record.get("run_id"),
                    "minute": entry["minute"],
                    "team_id": entry["teamId"],
                    "position": fouler.get("position"),
                    "zone": entry["zone"],
                    "card": entry["card"],
                }
            )
    if not rows:
        return {"n_fouls": 0, "note": "nenhum registro de trace disponível (rode com trace=True numa amostra)"}

    df = pd.DataFrame(rows)
    n_matches = df["run_id"].nunique()
    by_position = df.groupby("position").agg(fouls=("card", "size"), cards=("card", lambda s: (s != "none").sum()))
    by_position["fouls_per_90"] = by_position["fouls"] / n_matches
    by_position["cards_per_foul"] = by_position["cards"] / by_position["fouls"]
    by_position["cards_per_90"] = by_position["fouls_per_90"] * by_position["cards_per_foul"]

    return {
        "n_fouls": int(len(df)),
        "n_matches_traced": int(n_matches),
        "by_position": by_position[["fouls_per_90", "cards_per_foul", "cards_per_90"]].to_dict(orient="index"),
        "by_zone": df["zone"].value_counts(normalize=True).to_dict(),
    }


# --- autoria / participação ------------------------------------------------------------------


def authorship_metrics(events_df: pd.DataFrame, n_matches: int) -> dict[str, Any]:
    """gols/90, chutes/90 e conversão por posição — chutes vêm de 'goal'+'shot_saved'+'shot_missed'
    (todos carregam o playerId de quem chutou), sem precisar de trace. Assistências não existem no
    motor hoje (Player.seasonStats.assists é um campo morto — ver benchmark/README.md's
    limitações) e por isso ficam de fora, em vez de inventadas."""
    if len(events_df) == 0 or n_matches == 0:
        return {"n_matches": n_matches}

    shots = events_df[events_df["type"].isin(SHOT_EVENT_TYPES)]
    goals = events_df[events_df["type"] == "goal"]

    shots_by_pos = shots.groupby("position").size()
    goals_by_pos = goals.groupby("position").size()
    conversion = (goals_by_pos / shots_by_pos).fillna(0.0)

    set_piece_goals = goals[goals["set_piece"].notna()]

    return {
        "n_matches": n_matches,
        "shots_per_90_by_position": (shots_by_pos / n_matches).to_dict(),
        "goals_per_90_by_position": (goals_by_pos / n_matches).reindex(shots_by_pos.index, fill_value=0.0).to_dict(),
        "conversion_by_position": conversion.to_dict(),
        "set_piece_goal_share": float(len(set_piece_goals) / len(goals)) if len(goals) else 0.0,
        "man_of_the_match_top": None,  # preenchido pelo caller a partir do summary df (man_of_the_match column)
        "assists": "não disponível — Player.seasonStats.assists é um campo morto no motor atual",
    }


# --- temporada -------------------------------------------------------------------------------


def season_metrics(season_records: list[dict], world_ratings: Optional[list[dict]] = None) -> dict[str, Any]:
    if not season_records:
        return {"n_seasons": 0}

    n = len(season_records)
    champions = [rec["standings"][0]["clubId"] for rec in season_records]
    relegated = [entry["clubId"] for rec in season_records for entry in rec["standings"][-4:]]

    points_by_club: dict[str, list[int]] = {}
    for rec in season_records:
        for entry in rec["standings"]:
            points_by_club.setdefault(entry["clubId"], []).append(entry["points"])

    champion_dist = pd.Series(champions).value_counts(normalize=True).to_dict()
    relegation_dist = pd.Series(relegated).value_counts(normalize=True).to_dict()

    result: dict[str, Any] = {
        "n_seasons": n,
        "champion_distribution": champion_dist,
        "relegation_distribution": relegation_dist,
        "points_mean_by_club": {club: float(np.mean(pts)) for club, pts in points_by_club.items()},
        "points_std_by_club": {club: float(np.std(pts)) for club, pts in points_by_club.items()},
        "table_spread_points_champion_minus_last": float(
            np.mean(
                [rec["standings"][0]["points"] - rec["standings"][-1]["points"] for rec in season_records]
            )
        ),
    }

    if world_ratings:
        rating_by_club = {c["club_id"]: c["overall"] for c in world_ratings}
        positions, ratings = [], []
        for rec in season_records:
            for pos, entry in enumerate(rec["standings"], start=1):
                if entry["clubId"] in rating_by_club:
                    positions.append(pos)
                    ratings.append(rating_by_club[entry["clubId"]])
        if len(positions) >= 2:
            from scipy.stats import spearmanr

            corr, pvalue = spearmanr(ratings, positions)
            # posição 1 = melhor colocado, então correlação negativa = "mais força -> melhor posição" (esperado)
            result["initial_strength_vs_final_position_spearman"] = {"corr": float(corr), "pvalue": float(pvalue)}

    return result
