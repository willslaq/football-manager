"""Reproducibility is the whole premise of the benchmark: engine_version + config_hash + fixture
+ seed must fully determine a match. These tests exercise that contract through the same
EngineAdapter path the CLI uses (not by importing TS directly — see match.test.ts in the main
engine test suite for that side)."""

from __future__ import annotations

from .conftest import WORLD_SEED


def _run(adapter, seed: int, home: str, away: str, **kwargs):
    return adapter.run_match(seed=seed, world_seed=WORLD_SEED, home_club_id=home, away_club_id=away, **kwargs)


def test_same_seed_same_everything_reproduces_bit_identical(adapter, club_ids):
    home, away = club_ids[0], club_ids[1]
    a = _run(adapter, 12345, home, away, run_id="run-a", fixture_id="fixture-a")
    b = _run(adapter, 12345, home, away, run_id="run-b", fixture_id="fixture-b")

    assert a["home_goals"] == b["home_goals"]
    assert a["away_goals"] == b["away_goals"]
    assert a["events"] == b["events"]
    assert a["stats"] == b["stats"]
    assert a["config_hash"] == b["config_hash"]


def test_different_seed_usually_differs(adapter, club_ids):
    home, away = club_ids[0], club_ids[1]
    results = [_run(adapter, seed, home, away) for seed in range(30)]
    distinct_scorelines = {(r["home_goals"], r["away_goals"]) for r in results}
    assert len(distinct_scorelines) > 1, "30 seeds produced only one scoreline — RNG isn't varying"


def test_run_id_and_fixture_id_are_pure_bookkeeping(adapter, club_ids):
    """Renaming the run_id/fixture_id (labels we attach, not fed to the engine's RNG) must not
    change the simulated outcome — SRS 'renomear IDs sem alterar atributos não muda os agregados'."""
    home, away = club_ids[2], club_ids[3]
    a = _run(adapter, 777, home, away, run_id="alpha", fixture_id="fixture-alpha")
    b = _run(adapter, 777, home, away, run_id="omega-completely-different-label", fixture_id="fixture-omega")
    assert a["home_goals"] == b["home_goals"]
    assert a["away_goals"] == b["away_goals"]
    assert a["events"] == b["events"]


def test_param_override_changes_config_hash_and_can_change_outcome(adapter, club_ids):
    home, away = club_ids[0], club_ids[1]
    default = _run(adapter, 42, home, away)
    overridden = _run(adapter, 42, home, away, params={"BASE_GOAL_PROBABILITY": 0.9})
    assert default["config_hash"] != overridden["config_hash"]
    # probabilidade de gol quase certa por chance -> praticamente garantido mais gols que o default
    assert (overridden["home_goals"] + overridden["away_goals"]) >= (default["home_goals"] + default["away_goals"])


def test_season_same_seed_reproduces_same_standings(adapter):
    a = adapter.run_season(seed=555, full_season=True)
    b = adapter.run_season(seed=555, full_season=True)
    assert a["standings"] == b["standings"]
    assert len(a["matches"]) == len(b["matches"]) == 380
    assert [m["home_goals"] for m in a["matches"]] == [m["home_goals"] for m in b["matches"]]


def test_season_different_seed_usually_differs(adapter):
    a = adapter.run_season(seed=1, full_season=True)
    b = adapter.run_season(seed=2, full_season=True)
    assert a["standings"] != b["standings"]
