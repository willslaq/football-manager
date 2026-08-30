from __future__ import annotations

import numpy as np
import pytest

from benchmark.statistics import (
    bootstrap_ci,
    brier_score,
    chi_square_test,
    equivalence_gate,
    huber_loss,
    jensen_shannon_distance,
    paired_diff_ci,
    ranked_probability_score,
    sample_size_for_margin,
    two_sample_mean_diff_ci,
    wasserstein_1d,
)


def test_equivalence_gate_boundaries():
    assert equivalence_gate(-0.05, 0.05, tolerance=0.1) == "pass"
    assert equivalence_gate(-0.1, 0.1, tolerance=0.1) == "pass"  # inclusive boundary
    assert equivalence_gate(0.2, 0.3, tolerance=0.1) == "fail"
    assert equivalence_gate(-0.3, -0.2, tolerance=0.1) == "fail"
    assert equivalence_gate(-0.05, 0.2, tolerance=0.1) == "inconclusive"


def test_bootstrap_ci_contains_true_mean_for_normal_data():
    rng = np.random.default_rng(1)
    data = rng.normal(loc=5.0, scale=1.0, size=3000)
    ci = bootstrap_ci(data)
    assert ci.low < 5.0 < ci.high
    assert ci.low < ci.point < ci.high


def test_bootstrap_ci_degenerate_constant_array():
    ci = bootstrap_ci([3.0, 3.0, 3.0, 3.0])
    assert ci.point == ci.low == ci.high == 3.0


def test_paired_diff_ci_tighter_than_unpaired_under_shared_noise():
    """CRN's whole point: pairing cancels shared randomness, so the paired CI on the SAME
    underlying signal should be narrower than treating the two arms as independent."""
    rng = np.random.default_rng(2)
    shared_noise = rng.normal(0, 5, size=500)
    a = shared_noise + rng.normal(0, 0.1, size=500)
    b = shared_noise + 0.5 + rng.normal(0, 0.1, size=500)  # true effect = +0.5

    paired = paired_diff_ci(a, b)
    unpaired = two_sample_mean_diff_ci(b, a)  # sim=b, real=a, independent resampling

    paired_width = paired.high - paired.low
    unpaired_width = unpaired.high - unpaired.low
    assert paired_width < unpaired_width


def test_sample_size_matches_srs_worked_examples():
    assert abs(sample_size_for_margin(0.009) - 12000) < 500
    assert abs(sample_size_for_margin(0.0031) - 100000) < 2000
    assert sample_size_for_margin(0.005) == 38416


def test_jensen_shannon_distance_bounds():
    p = {"a": 0.5, "b": 0.5}
    assert jensen_shannon_distance(p, p) == pytest.approx(0.0, abs=1e-9)
    q = {"a": 1.0, "b": 0.0}
    d = jensen_shannon_distance(p, q)
    assert 0.0 < d <= 1.0


def test_wasserstein_distance_zero_for_identical_samples():
    data = [1.0, 2.0, 3.0, 4.0, 5.0]
    assert wasserstein_1d(data, data) == 0.0
    assert wasserstein_1d(data, [x + 10 for x in data]) == pytest.approx(10.0)


def test_brier_and_rps_perfect_prediction_is_zero():
    probs = np.array([[1.0, 0.0, 0.0]])
    outcomes = [0]
    assert brier_score(probs, outcomes) == pytest.approx(0.0)
    assert ranked_probability_score(probs, outcomes) == pytest.approx(0.0)


def test_rps_penalizes_adjacent_miss_less_than_extreme_miss():
    """RPS's whole point vs Brier: home/draw/away is ORDERED — predicting draw when home actually
    won should cost less than predicting away when home actually won."""
    outcomes = [0]  # home won (índice 0 = home, 1 = draw, 2 = away)
    predict_draw = np.array([[0.0, 1.0, 0.0]])
    predict_away = np.array([[0.0, 0.0, 1.0]])
    assert ranked_probability_score(predict_draw, outcomes) < ranked_probability_score(predict_away, outcomes)


def test_huber_loss_quadratic_near_zero_linear_far():
    assert huber_loss(0.1) == pytest.approx(0.5 * 0.1**2)
    assert huber_loss(10.0, delta=1.0) == pytest.approx(1.0 * (10.0 - 0.5))


def test_chi_square_rejects_obviously_different_distribution():
    observed = [500, 300, 200]
    expected_close = [480, 320, 200]
    expected_far = [100, 100, 800]
    _, p_close = chi_square_test(observed, expected_close)
    _, p_far = chi_square_test(observed, expected_far)
    assert p_close > p_far
