"""Record schemas + JSONL/Parquet I/O for match/season results.

Two granularities, matching the "summary vs trace" logging modes the SRS asks for:

- **summary row** (`flatten_match_record`): one flat dict per match — score, ratings, team-level
  stats (shots/fouls/cards/possession), duration. Cheap; this is what gets written for every
  match in a Monte Carlo run.
- **event rows** (`match_event_rows`): one row per goal/card/substitution, with the scoring/
  carded player's position and club attached via a player index (see
  `EngineAdapter.world_players`). This is what position-level metrics (goals by position, cards
  by position, minute-of-card distributions) are computed from — no full per-chance trace needed
  for these, since `MatchEvent[]` is always returned by the engine (see benchmark/engine/server.ts).

Raw traces (`onChance` entries, requested via `trace=True`) are kept separately and only for a
stratified sample + failing seeds — never for every match (SRS "não persista o trace completo de
100 mil partidas").
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable, Optional

import pandas as pd

PlayerIndex = dict[str, dict[str, Any]]


def build_player_index(world_players_response: dict) -> PlayerIndex:
    """id -> {position, club_id, strength}, from EngineAdapter.world_players()."""
    return {p["id"]: p for p in world_players_response["players"]}


def flatten_match_record(record: dict, *, stratum: Optional[str] = None) -> dict:
    """Match record (from EngineAdapter.run_match, possibly merged with FixtureSpec metadata by
    the caller) -> one flat row suitable for a DataFrame/Parquet/CSV."""
    stats = record.get("stats") or {}
    home_rating = record.get("home_rating") or {}
    away_rating = record.get("away_rating") or {}
    events = record.get("events") or []

    def count(event_type: str, team_id: Optional[str]) -> int:
        return sum(1 for e in events if e["type"] == event_type and (team_id is None or e["teamId"] == team_id))

    home_team, away_team = record["home_team"], record["away_team"]
    possession = stats.get("possession", {})
    shots = stats.get("shots", {})
    shots_on_target = stats.get("shotsOnTarget", {})
    fouls = stats.get("fouls", {})

    return {
        "run_id": record.get("run_id"),
        "fixture_id": record.get("fixture_id"),
        "stratum": stratum,
        "seed": record.get("seed"),
        "world_seed": record.get("world_seed"),
        "engine_version": record.get("engine_version"),
        "config_hash": record.get("config_hash"),
        "tactical_intensity": record.get("tactical_intensity"),
        "home_team": home_team,
        "away_team": away_team,
        "home_formation": record.get("home_formation"),
        "home_style": record.get("home_style"),
        "away_formation": record.get("away_formation"),
        "away_style": record.get("away_style"),
        "home_attack": home_rating.get("attack"),
        "home_defense": home_rating.get("defense"),
        "home_midfield": home_rating.get("midfield"),
        "away_attack": away_rating.get("attack"),
        "away_defense": away_rating.get("defense"),
        "away_midfield": away_rating.get("midfield"),
        "home_goals": record["home_goals"],
        "away_goals": record["away_goals"],
        "total_goals": record["home_goals"] + record["away_goals"],
        "possession_home": possession.get("home"),
        "possession_away": possession.get("away"),
        "shots_home": shots.get("home"),
        "shots_away": shots.get("away"),
        "shots_on_target_home": shots_on_target.get("home"),
        "shots_on_target_away": shots_on_target.get("away"),
        "fouls_home": fouls.get("home"),
        "fouls_away": fouls.get("away"),
        "yellow_cards_home": count("yellow_card", home_team),
        "yellow_cards_away": count("yellow_card", away_team),
        "red_cards_home": count("red_card", home_team),
        "red_cards_away": count("red_card", away_team),
        "man_of_the_match": record.get("man_of_the_match"),
        "duration_ms": record.get("duration_ms"),
    }


EVENT_TYPES_TRACKED = {"goal", "yellow_card", "red_card", "shot_saved", "shot_missed", "substitution"}


def match_event_rows(record: dict, player_index: PlayerIndex, *, stratum: Optional[str] = None) -> list[dict]:
    """One row per tracked MatchEvent, with the acting player's position/club attached."""
    rows: list[dict] = []
    for event in record.get("events") or []:
        if event["type"] not in EVENT_TYPES_TRACKED:
            continue
        player = player_index.get(event.get("playerId"), {})
        rows.append(
            {
                "run_id": record.get("run_id"),
                "fixture_id": record.get("fixture_id"),
                "stratum": stratum,
                "seed": record.get("seed"),
                "minute": event["minute"],
                "type": event["type"],
                "team_id": event["teamId"],
                "is_home_team": event["teamId"] == record["home_team"],
                "player_id": event.get("playerId"),
                "position": player.get("position"),
                "player_club_id": player.get("club_id"),
                "set_piece": event.get("setPiece"),
                "goalkeeper_id": event.get("goalkeeperId"),
                "player_in_id": event.get("playerInId"),
            }
        )
    return rows


def flatten_season_match(season_run_id: str, season_seed: int, match: dict) -> dict:
    """One row per match INSIDE a season replicate (simulation.run_season_benchmark), reshaped to
    the same flat schema as flatten_match_record — this is the "representative" sample (real
    calendar, real competitive-balance distribution) that real-vs-engine aggregate comparisons
    should use, as opposed to the stratified fixture bank (which deliberately over-samples
    extreme strength gaps for coverage/diagnosis and would bias a raw aggregate comparison — see
    benchmark/README.md's "Amostra estratificada x representativa")."""
    stats = match.get("stats") or {}
    possession = stats.get("possession", {})
    shots = stats.get("shots", {})
    shots_on_target = stats.get("shotsOnTarget", {})
    fouls = stats.get("fouls", {})
    return {
        "run_id": f"{season_run_id}::r{match['round']}::{match['home_team']}_{match['away_team']}",
        "season_run_id": season_run_id,
        "seed": season_seed,
        "round": match["round"],
        "date": match.get("date"),
        "home_team": match["home_team"],
        "away_team": match["away_team"],
        "home_goals": match["home_goals"],
        "away_goals": match["away_goals"],
        "total_goals": match["home_goals"] + match["away_goals"],
        "possession_home": possession.get("home"),
        "possession_away": possession.get("away"),
        "shots_home": shots.get("home"),
        "shots_away": shots.get("away"),
        "shots_on_target_home": shots_on_target.get("home"),
        "shots_on_target_away": shots_on_target.get("away"),
        "fouls_home": fouls.get("home"),
        "fouls_away": fouls.get("away"),
        "yellow_cards_home": match.get("yellow_cards_home"),
        "yellow_cards_away": match.get("yellow_cards_away"),
        "red_cards_home": match.get("red_cards_home"),
        "red_cards_away": match.get("red_cards_away"),
    }


def season_records_to_summary_df(season_records: list[dict]) -> pd.DataFrame:
    rows = [
        flatten_season_match(rec["run_id"], rec["seed"], match) for rec in season_records for match in rec["matches"]
    ]
    return pd.DataFrame(rows)


def write_jsonl(records: Iterable[dict], path: Path, *, mode: str = "w") -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with open(path, mode, encoding="utf-8") as f:
        for record in records:
            f.write(json.dumps(record, ensure_ascii=False, default=str))
            f.write("\n")
            n += 1
    return n


def read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def write_parquet(rows: list[dict], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(rows).to_parquet(path, index=False)


def write_csv(rows: list[dict], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(rows).to_csv(path, index=False)
