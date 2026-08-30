"""Unit tests for simulation.py's pure helpers that don't need the engine running."""

from __future__ import annotations

from benchmark.simulation import _adaptive_satisfied


def _rows(home_wins: int, draws: int, away_wins: int) -> list[dict]:
    rows = [{"home_goals": 1, "away_goals": 0} for _ in range(home_wins)]
    rows += [{"home_goals": 1, "away_goals": 1} for _ in range(draws)]
    rows += [{"home_goals": 0, "away_goals": 1} for _ in range(away_wins)]
    return rows


def test_adaptive_disabled_never_satisfied():
    rows = _rows(1000, 1000, 1000)
    assert _adaptive_satisfied(rows, None) is False
    assert _adaptive_satisfied(rows, {"enabled": False}) is False


def test_adaptive_not_satisfied_below_min_sample():
    rows = _rows(5, 5, 5)
    adaptive = {"enabled": True, "metrics": ["home_win_rate"], "target_margin_pp": 1.0, "z": 1.96}
    assert _adaptive_satisfied(rows, adaptive) is False


def test_adaptive_satisfied_once_margin_under_target():
    # p~0.33 cada, margem alvo generosa (5pp) com bastante gente -> deve bater
    rows = _rows(2000, 2000, 2000)
    adaptive = {"enabled": True, "metrics": ["home_win_rate", "draw_rate", "away_win_rate"], "target_margin_pp": 5.0, "z": 1.96}
    assert _adaptive_satisfied(rows, adaptive) is True


def test_adaptive_not_satisfied_with_tight_margin_and_few_matches():
    rows = _rows(50, 30, 20)
    adaptive = {"enabled": True, "metrics": ["home_win_rate"], "target_margin_pp": 0.1, "z": 1.96}
    assert _adaptive_satisfied(rows, adaptive) is False


def test_adaptive_margin_shrinks_with_more_matches():
    """Sanity check on e = z*sqrt(p(1-p)/n): mesma proporção, mais partidas -> satisfaz uma
    margem que menos partidas não satisfazia."""
    small = _rows(100, 100, 100)
    large = _rows(5000, 5000, 5000)
    adaptive = {"enabled": True, "metrics": ["home_win_rate"], "target_margin_pp": 2.0, "z": 1.96}
    assert _adaptive_satisfied(small, adaptive) is False
    assert _adaptive_satisfied(large, adaptive) is True
