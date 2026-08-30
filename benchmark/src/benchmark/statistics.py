"""Statistical primitives shared by comparison.py (real vs Dixon-Coles vs engine) and
calibration.py (loss function). Kept metric-agnostic — callers pass in raw arrays/blocks and get
back CIs/distances/gate verdicts; no knowledge of "goals" or "cards" lives here.

Equivalence gate (SRS): approval is IC95%(diff) ⊆ [-tolerance, +tolerance], never "p > 0.05" —
a huge Monte Carlo sample makes p-values meaningless for practical equivalence (it'll reject any
nonzero difference, however tiny), so every comparison in this tool reports a CI against a
pre-registered tolerance instead.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Callable, Literal, Optional, Sequence

import numpy as np
from scipy import stats
from scipy.spatial.distance import jensenshannon

Verdict = Literal["pass", "fail", "inconclusive"]


@dataclass
class CIResult:
    point: float
    low: float
    high: float
    method: str


def _subsample(arr: np.ndarray, max_n: int, seed: int) -> np.ndarray:
    """Bootstrap CI width saturates well before n reaches the tens of thousands a nightly run
    produces; scipy.stats.bootstrap materializes an (n_resamples, n) array internally, so an
    uncapped n on a 100k-match run means gigabytes of resample matrix for no accuracy gain.
    Subsampling (without replacement) down to `max_n` first bounds that memory cost."""
    if len(arr) <= max_n:
        return arr
    rng = np.random.default_rng(seed)
    idx = rng.choice(len(arr), size=max_n, replace=False)
    return arr[idx]


def bootstrap_ci(
    data: Sequence[float],
    statistic: Callable[[np.ndarray], float] = np.mean,
    *,
    confidence: float = 0.95,
    n_resamples: int = 2000,
    method: str = "BCa",
    seed: int = 0,
    max_n: int = 20_000,
) -> CIResult:
    """Bootstrap CI for a 1-sample statistic. Falls back from BCa to the percentile method when
    BCa degenerates (e.g. near-zero-variance data, or n too small for the jackknife it needs)."""
    arr = _subsample(np.asarray(data, dtype=float), max_n, seed)
    point = float(statistic(arr))
    if len(arr) < 2 or np.allclose(arr, arr[0]):
        return CIResult(point, point, point, method="degenerate")

    rng = np.random.default_rng(seed)
    try:
        res = stats.bootstrap(
            (arr,), statistic, confidence_level=confidence, n_resamples=n_resamples, method=method, random_state=rng
        )
        return CIResult(point, float(res.confidence_interval.low), float(res.confidence_interval.high), method=method)
    except Exception:
        res = stats.bootstrap(
            (arr,), statistic, confidence_level=confidence, n_resamples=n_resamples, method="percentile", random_state=rng
        )
        return CIResult(point, float(res.confidence_interval.low), float(res.confidence_interval.high), method="percentile")


def block_bootstrap_ci(
    blocks: Sequence[Sequence[float]],
    statistic: Callable[[np.ndarray], float] = np.mean,
    *,
    confidence: float = 0.95,
    n_resamples: int = 2000,
    seed: int = 0,
) -> CIResult:
    """Resamples whole BLOCKS (e.g. one season's 380 matches), not individual matches — for
    metrics where matches inside a block share state (calendar, fatigue, table pressure) and
    aren't independent observations (SRS "trate temporadas como blocos ao estimar a incerteza")."""
    blocks = [np.asarray(b, dtype=float) for b in blocks if len(b) > 0]
    if len(blocks) < 2:
        point = float(statistic(np.concatenate(blocks))) if blocks else float("nan")
        return CIResult(point, point, point, method="degenerate")

    block_means = np.array([statistic(b) for b in blocks])
    rng = np.random.default_rng(seed)
    point = float(np.mean(block_means))
    resampled = rng.choice(block_means, size=(n_resamples, len(block_means)), replace=True)
    resample_means = resampled.mean(axis=1)
    lo, hi = np.percentile(resample_means, [(1 - confidence) / 2 * 100, (1 + confidence) / 2 * 100])
    return CIResult(point, float(lo), float(hi), method="block_percentile")


def paired_diff_ci(a: Sequence[float], b: Sequence[float], **kwargs) -> CIResult:
    """CI for mean(b - a) over PAIRED observations (same fixture+seed under common random
    numbers — see comparison.py). Far tighter than an unpaired comparison because it cancels the
    shared randomness between the two configurations being compared."""
    a_arr, b_arr = np.asarray(a, dtype=float), np.asarray(b, dtype=float)
    if len(a_arr) != len(b_arr):
        raise ValueError(f"paired_diff_ci: tamanhos diferentes ({len(a_arr)} vs {len(b_arr)}) — não são pares CRN")
    return bootstrap_ci(b_arr - a_arr, **kwargs)


def two_sample_mean_diff_ci(
    sim_values: Sequence[float],
    real_values: Sequence[float],
    *,
    confidence: float = 0.95,
    n_resamples: int = 2000,
    seed: int = 0,
    max_n: int = 20_000,
) -> CIResult:
    """CI for mean(sim) - mean(real) treating BOTH sides as samples with their own bootstrap
    uncertainty (unlike bootstrap_ci, which treats its single input as the only uncertain side) —
    used by comparison.py when the real snapshot's sample size is small enough that pretending
    it's a fixed, exactly-known target would understate the comparison's true uncertainty."""
    sim_arr = _subsample(np.asarray(sim_values, dtype=float), max_n, seed)
    real_arr = _subsample(np.asarray(real_values, dtype=float), max_n, seed + 1)
    if len(sim_arr) < 2 or len(real_arr) < 2:
        point = float(np.mean(sim_arr) - np.mean(real_arr)) if len(sim_arr) and len(real_arr) else float("nan")
        return CIResult(point, point, point, method="degenerate")

    def diff_stat(x: np.ndarray, y: np.ndarray, axis: int = -1) -> np.ndarray:
        return np.mean(x, axis=axis) - np.mean(y, axis=axis)

    rng = np.random.default_rng(seed)
    point = float(np.mean(sim_arr) - np.mean(real_arr))
    try:
        res = stats.bootstrap(
            (sim_arr, real_arr), diff_stat, confidence_level=confidence, n_resamples=n_resamples,
            method="BCa", random_state=rng, paired=False,
        )
        return CIResult(point, float(res.confidence_interval.low), float(res.confidence_interval.high), method="BCa")
    except Exception:
        res = stats.bootstrap(
            (sim_arr, real_arr), diff_stat, confidence_level=confidence, n_resamples=n_resamples,
            method="percentile", random_state=rng, paired=False,
        )
        return CIResult(
            point, float(res.confidence_interval.low), float(res.confidence_interval.high), method="percentile"
        )


def equivalence_gate(ci_low: float, ci_high: float, tolerance: float) -> Verdict:
    if -tolerance <= ci_low and ci_high <= tolerance:
        return "pass"
    if ci_high < -tolerance or ci_low > tolerance:
        return "fail"
    return "inconclusive"


def chi_square_test(observed: Sequence[float], expected: Sequence[float]) -> tuple[float, float]:
    """Caller is responsible for merging rare bins first (SRS "agrupe caudas raras... registre os
    bins no arquivo de configuração") — this just runs the test on whatever bins it's handed."""
    observed_arr = np.asarray(observed, dtype=float)
    expected_arr = np.asarray(expected, dtype=float)
    expected_arr = expected_arr * (observed_arr.sum() / expected_arr.sum())  # mesma escala
    statistic, pvalue = stats.chisquare(observed_arr, expected_arr)
    return float(statistic), float(pvalue)


def jensen_shannon_distance(p: dict[str, float], q: dict[str, float]) -> float:
    """JS distance (sqrt of JS divergence, base-2 — bounded in [0, 1]) between two discrete
    distributions given as {category: probability}. Missing categories treated as 0."""
    categories = sorted(set(p) | set(q))
    p_vec = np.array([p.get(c, 0.0) for c in categories])
    q_vec = np.array([q.get(c, 0.0) for c in categories])
    if p_vec.sum() == 0 or q_vec.sum() == 0:
        return float("nan")
    p_vec = p_vec / p_vec.sum()
    q_vec = q_vec / q_vec.sum()
    return float(jensenshannon(p_vec, q_vec, base=2))


def wasserstein_1d(a: Sequence[float], b: Sequence[float]) -> float:
    """1-Wasserstein (earth mover's) distance between two 1D samples — for ordered/continuous
    distributions like minute-of-event, where JS (bin-based, order-blind) would hide a shift."""
    return float(stats.wasserstein_distance(np.asarray(a, dtype=float), np.asarray(b, dtype=float)))


def brier_score(probs: np.ndarray, outcomes: Sequence[int]) -> float:
    """Multi-class Brier score. `probs`: (n, k) array of predicted probabilities (rows sum to 1).
    `outcomes`: length-n array of the realized class index (0..k-1)."""
    probs = np.asarray(probs, dtype=float)
    n, k = probs.shape
    one_hot = np.zeros((n, k))
    one_hot[np.arange(n), np.asarray(outcomes, dtype=int)] = 1.0
    return float(np.mean(np.sum((probs - one_hot) ** 2, axis=1)))


def ranked_probability_score(probs: np.ndarray, outcomes: Sequence[int]) -> float:
    """RPS for ORDERED outcomes (home/draw/away is ordered: away < draw < home in "how many goals
    home is ahead by", loosely) — penalizes a miss between adjacent classes less than a miss
    between the extremes, unlike Brier. Column order of `probs` must match the outcome ordering."""
    probs = np.asarray(probs, dtype=float)
    n, k = probs.shape
    one_hot = np.zeros((n, k))
    one_hot[np.arange(n), np.asarray(outcomes, dtype=int)] = 1.0
    cum_probs = np.cumsum(probs, axis=1)
    cum_outcomes = np.cumsum(one_hot, axis=1)
    return float(np.mean(np.sum((cum_probs - cum_outcomes) ** 2, axis=1)) / (k - 1))


def huber_loss(residual: float, delta: float = 1.0) -> float:
    """Huber loss on a (dimensionless — caller pre-divides by tolerance) residual. Used by
    calibration.py's composite loss so one badly-off metric can't dominate via a squared blowup,
    while still being smooth (unlike a hard cutoff) for the optimizer to follow a gradient on."""
    a = abs(residual)
    return 0.5 * a * a if a <= delta else delta * (a - 0.5 * delta)


def sample_size_for_margin(margin: float, *, p: float = 0.5, z: float = 1.96) -> int:
    """n = (z / margin)^2 * p*(1-p) — inverse of e = z*sqrt(p(1-p)/n), the sizing formula the SRS
    gives for smoke/nightly/release profiles."""
    if margin <= 0:
        raise ValueError("margin deve ser > 0")
    return math.ceil((z / margin) ** 2 * p * (1 - p))
