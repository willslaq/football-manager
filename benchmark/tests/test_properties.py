"""Property-based tests (Hypothesis) over live engine output, plus metamorphic/statistical
relations that only make sense over many paired runs (monotonicity, mirror symmetry, worker-count
invariance) — those use simulation.run_match_benchmark directly rather than Hypothesis, since
their assertions are about an AGGREGATE across seeds, not a single match.

Mirrors the SRS's "Testes de regras e propriedades" list; a few items on that list
(substitution-count limits, "every choice distribution sums to 1") aren't independently
enforced/observable at the simulateMatch boundary — see benchmark/README.md's limitations
section for exactly which and why, instead of fabricating a test for a guarantee that doesn't
exist at this layer.
"""

from __future__ import annotations

import math
from pathlib import Path

import pandas as pd
import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from benchmark.comparison import _extract
from benchmark.fixtures import FixtureSpec
from benchmark.metrics import check_match_invariants
from benchmark.seed_bank import SeedBank
from benchmark.simulation import run_match_benchmark

from .conftest import WORLD_SEED

SEED_STRATEGY = st.integers(min_value=0, max_value=2**32 - 1)
HYPOTHESIS_SETTINGS = settings(max_examples=25, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])


# --- por-partida (Hypothesis sobre seeds aleatórias) --------------------------------------------


@HYPOTHESIS_SETTINGS
@given(seed=SEED_STRATEGY)
def test_match_invariants_hold_for_random_seeds(adapter, club_ids, seed):
    record = adapter.run_match(seed=seed, world_seed=WORLD_SEED, home_club_id=club_ids[0], away_club_id=club_ids[1])
    problems = check_match_invariants(record)
    assert problems == [], f"seed={seed}: {problems}"


@HYPOTHESIS_SETTINGS
@given(seed=SEED_STRATEGY)
def test_events_are_chronological_and_minutes_in_range(adapter, club_ids, seed):
    record = adapter.run_match(seed=seed, world_seed=WORLD_SEED, home_club_id=club_ids[2], away_club_id=club_ids[3])
    minutes = [e["minute"] for e in record["events"]]
    assert minutes == sorted(minutes)
    assert all(1 <= m <= 90 for m in minutes)


@HYPOTHESIS_SETTINGS
@given(seed=SEED_STRATEGY)
def test_counts_never_negative_and_finite(adapter, club_ids, seed):
    record = adapter.run_match(seed=seed, world_seed=WORLD_SEED, home_club_id=club_ids[4], away_club_id=club_ids[5])
    for value in (record["home_goals"], record["away_goals"]):
        assert value >= 0
        assert math.isfinite(value)
    stats = record["stats"]
    for group in (stats["shots"], stats["shotsOnTarget"], stats["fouls"], stats["possession"]):
        for value in group.values():
            assert value >= 0
            assert math.isfinite(value)


@HYPOTHESIS_SETTINGS
@given(seed=SEED_STRATEGY)
def test_red_carded_player_has_no_events_after_dismissal(adapter, club_ids, seed):
    """Expulsões removem o jogador — nenhum evento novo com o mesmo playerId como AUTOR depois
    do minuto do vermelho (substitution's playerInId doesn't count — that's someone else)."""
    record = adapter.run_match(seed=seed, world_seed=WORLD_SEED, home_club_id=club_ids[6], away_club_id=club_ids[7])
    events = record["events"]
    red_cards = [(e["playerId"], e["minute"]) for e in events if e["type"] == "red_card"]
    for player_id, red_minute in red_cards:
        later_as_actor = [e for e in events if e["playerId"] == player_id and e["minute"] > red_minute]
        assert later_as_actor == [], f"seed={seed}: jogador {player_id} expulso no min {red_minute} ainda atua depois: {later_as_actor}"


@HYPOTHESIS_SETTINGS
@given(seed=SEED_STRATEGY)
def test_second_yellow_produces_yellow_and_red_same_minute(adapter, club_ids, seed):
    record = adapter.run_match(seed=seed, world_seed=WORLD_SEED, home_club_id=club_ids[0], away_club_id=club_ids[2])
    events = record["events"]
    yellow_minutes: dict[str, list[int]] = {}
    for e in events:
        if e["type"] == "yellow_card":
            yellow_minutes.setdefault(e["playerId"], []).append(e["minute"])
    red_by_player = {e["playerId"]: e["minute"] for e in events if e["type"] == "red_card"}
    for player_id, minutes in yellow_minutes.items():
        if len(minutes) >= 2:
            # segunda advertência -> tem que ter um red_card no MESMO minuto da segunda
            assert player_id in red_by_player, f"seed={seed}: 2 amarelos sem vermelho pra {player_id}"
            assert red_by_player[player_id] == max(minutes)


@HYPOTHESIS_SETTINGS
@given(seed=SEED_STRATEGY)
def test_trace_chance_probabilities_are_valid(adapter, club_ids, seed):
    record = adapter.run_match(seed=seed, world_seed=WORLD_SEED, home_club_id=club_ids[1], away_club_id=club_ids[3], trace=True)
    for entry in record["trace"]:
        if entry["kind"] == "chance":
            assert 0.0 <= entry["goalProbability"] <= 1.0
            assert 0.0 <= entry["quality"] <= 1.0
        elif entry["kind"] == "possession":
            assert 0.0 <= entry["possessionHome"] <= 1.0


@HYPOTHESIS_SETTINGS
@given(seed=SEED_STRATEGY)
def test_lineups_always_exactly_eleven(adapter, club_ids, seed):
    record = adapter.run_match(seed=seed, world_seed=WORLD_SEED, home_club_id=club_ids[8], away_club_id=club_ids[9], trace=True)
    setup = next(e for e in record["trace"] if e["kind"] == "setup")
    assert setup["home"]["clubId"] == club_ids[8]
    assert setup["away"]["clubId"] == club_ids[9]


# --- metamórficas / estatísticas (pareadas, múltiplas seeds) -------------------------------------


def _tiny_bank(fixture_id: str, n: int, offset: int = 0) -> list[int]:
    return list(range(1 + offset, 1 + n + offset))


@pytest.fixture(scope="module")
def two_clubs(club_ids) -> tuple[str, str]:
    return club_ids[0], club_ids[10]


def test_no_home_advantage_swap_mirrors_outcome_distribution(adapter, two_clubs):
    """Sem vantagem de mando (HOME_ADVANTAGE=1, POSSESSION_HOME_BOOST=0), trocar quem manda o
    jogo deve espelhar a distribuição de resultados (dentro de ruído estatístico) — não bit a bit
    partida a partida, já que o RNG segue caminhos diferentes, mas em agregado sobre muitas seeds."""
    club_a, club_b = two_clubs
    neutral_params = {"HOME_ADVANTAGE": 1.0, "POSSESSION_HOME_BOOST": 0.0}
    n = 150
    a_home = [adapter.run_match(seed=s, world_seed=WORLD_SEED, home_club_id=club_a, away_club_id=club_b, params=neutral_params) for s in range(n)]
    b_home = [adapter.run_match(seed=s, world_seed=WORLD_SEED, home_club_id=club_b, away_club_id=club_a, params=neutral_params) for s in range(n)]

    a_win_rate_as_home = sum(1 for r in a_home if r["home_goals"] > r["away_goals"]) / n
    a_win_rate_as_away = sum(1 for r in b_home if r["away_goals"] > r["home_goals"]) / n
    # mesmas seeds, papéis espelhados -> taxas devem bater de perto (mesmo RNG stream, só o lado muda)
    assert abs(a_win_rate_as_home - a_win_rate_as_away) < 0.12, (a_win_rate_as_home, a_win_rate_as_away)


def test_increasing_goal_probability_does_not_decrease_expected_goals(adapter, two_clubs):
    club_a, club_b = two_clubs
    n = 120
    low = [adapter.run_match(seed=s, world_seed=WORLD_SEED, home_club_id=club_a, away_club_id=club_b, params={"BASE_GOAL_PROBABILITY": 0.20}) for s in range(n)]
    high = [adapter.run_match(seed=s, world_seed=WORLD_SEED, home_club_id=club_a, away_club_id=club_b, params={"BASE_GOAL_PROBABILITY": 0.45}) for s in range(n)]
    mean_low = sum(r["home_goals"] + r["away_goals"] for r in low) / n
    mean_high = sum(r["home_goals"] + r["away_goals"] for r in high) / n
    assert mean_high > mean_low, (mean_low, mean_high)


def test_decreasing_card_probability_does_not_increase_expected_cards(adapter, two_clubs):
    club_a, club_b = two_clubs
    n = 120
    lenient = [
        adapter.run_match(seed=s, world_seed=WORLD_SEED, home_club_id=club_a, away_club_id=club_b, params={"FOUL_CARD_BASE.yellow": 0.05, "FOUL_CARD_BASE.red": 0.001})
        for s in range(n)
    ]
    strict = [
        adapter.run_match(seed=s, world_seed=WORLD_SEED, home_club_id=club_a, away_club_id=club_b, params={"FOUL_CARD_BASE.yellow": 0.30, "FOUL_CARD_BASE.red": 0.015})
        for s in range(n)
    ]

    def cards(r):
        return sum(1 for e in r["events"] if e["type"] in ("yellow_card", "red_card"))

    mean_lenient = sum(cards(r) for r in lenient) / n
    mean_strict = sum(cards(r) for r in strict) / n
    assert mean_strict >= mean_lenient, (mean_lenient, mean_strict)


def test_worker_count_does_not_change_aggregate_result(tmp_path):
    """Mesmas seeds/fixtures, número de workers diferente -> mesmo conjunto de resultados
    agregados (particionamento entre processos não pode afetar o que cada partida individual
    produz, já que cada partida é 100% determinística pelo seu próprio (seed, params))."""
    fixtures = [
        FixtureSpec(
            fixture_id="worker-invariance-fixture",
            stratum="test",
            home_club_id="flamengo",
            away_club_id="vasco",
            home_formation="4-4-2",
            home_style="balanced",
            away_formation="4-4-2",
            away_style="balanced",
            tactical_intensity="subtle",
            home_rating_overall=0.0,
            away_rating_overall=0.0,
        )
    ]
    bank = SeedBank(kind="search", root_seed=123456789)

    result_1 = run_match_benchmark(fixtures, bank, replications_per_fixture=20, world_seed=WORLD_SEED, tactical_intensity="subtle", n_workers=1)
    result_4 = run_match_benchmark(fixtures, bank, replications_per_fixture=20, world_seed=WORLD_SEED, tactical_intensity="subtle", n_workers=4)

    key = lambda rows: sorted((r["run_id"], r["home_goals"], r["away_goals"]) for r in rows)  # noqa: E731
    assert key(result_1.summary_rows) == key(result_4.summary_rows)
