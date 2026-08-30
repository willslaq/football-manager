"""Morris screening + Sobol on the survivors (SRS's sensitivity order): Morris first, cheaply,
to drop parameters with negligible influence from the expensive Sobol pass; both produce a
parameter x metric matrix (mu_star for Morris, S1/ST for Sobol) rather than a single number.

Every evaluation reruns the match benchmark with a given parameter vector — this is the expensive
part, so `replications_per_fixture` here should stay small (this is screening, not a final
report) and `metrics` should be the short list actually worth mapping, not everything in
metrics.yaml. Uses the SAME fixtures+seed bank for every sample point (implicitly, since caller
passes one `fixtures`/`bank` pair — no combination the engine considers invalid is ever
constructed, since we only vary the flat scalar params in configs/parameters.yaml, never
formation/style/lineup validity).
"""

from __future__ import annotations

from typing import Any, Optional

import numpy as np
import pandas as pd
from SALib.analyze import morris as morris_analyze
from SALib.analyze import sobol as sobol_analyze
from SALib.sample import morris as morris_sample
from SALib.sample import sobol as sobol_sample

from .comparison import _extract
from .fixtures import FixtureSpec
from .seed_bank import SeedBank
from .simulation import run_match_benchmark


def build_salib_problem(param_space: dict[str, dict], names: list[str]) -> dict[str, Any]:
    return {
        "num_vars": len(names),
        "names": names,
        "bounds": [[param_space[n]["low"], param_space[n]["high"]] for n in names],
    }


def _metric_value(sim_df: pd.DataFrame, metric: str) -> float:
    values = _extract(sim_df, metric)
    return float(np.mean(values)) if values is not None and len(values) else float("nan")


def evaluate_samples(
    samples: np.ndarray,
    names: list[str],
    fixtures: list[FixtureSpec],
    bank: SeedBank,
    metrics: list[str],
    *,
    replications_per_fixture: int = 8,
    world_seed: int = 2026,
    tactical_intensity: str = "subtle",
    n_workers: Optional[int] = None,
    progress_cb: Optional[Any] = None,
) -> pd.DataFrame:
    rows = []
    for i, sample in enumerate(samples):
        params = dict(zip(names, (float(x) for x in sample)))
        result = run_match_benchmark(
            fixtures,
            bank,
            replications_per_fixture=replications_per_fixture,
            world_seed=world_seed,
            tactical_intensity=tactical_intensity,
            params=params,
            trace_sample_per_stratum=0,
            n_workers=n_workers,
        )
        sim_df = pd.DataFrame(result.summary_rows)
        rows.append({f"metric__{m}": _metric_value(sim_df, m) for m in metrics})
        if progress_cb:
            progress_cb(i + 1, len(samples))
    return pd.DataFrame(rows)


def run_morris(
    param_space: dict[str, dict],
    names: list[str],
    fixtures: list[FixtureSpec],
    bank: SeedBank,
    metrics: list[str],
    *,
    n_trajectories: int = 8,
    num_levels: int = 4,
    replications_per_fixture: int = 8,
    seed: int = 0,
    **kwargs: Any,
) -> dict[str, pd.DataFrame]:
    problem = build_salib_problem(param_space, names)
    samples = morris_sample.sample(problem, N=n_trajectories, num_levels=num_levels, seed=seed)
    outputs = evaluate_samples(samples, names, fixtures, bank, metrics, replications_per_fixture=replications_per_fixture, **kwargs)

    results: dict[str, pd.DataFrame] = {}
    for metric in metrics:
        y = outputs[f"metric__{metric}"].to_numpy()
        if np.any(np.isnan(y)) or np.allclose(y, y[0]):
            continue
        si = morris_analyze.analyze(problem, samples, y, print_to_console=False, num_levels=num_levels, seed=seed)
        results[metric] = pd.DataFrame({"parameter": si["names"], "mu_star": si["mu_star"], "mu": si["mu"], "sigma": si["sigma"]})
    return results


def screen_influential_params(morris_results: dict[str, pd.DataFrame], *, threshold_fraction: float = 0.1) -> list[str]:
    """Union, over all metrics, of parameters whose mu_star is at least `threshold_fraction` of
    that metric's max mu_star — SRS "elimine da análise cara os parâmetros com influência
    desprezível". A parameter negligible for every metric never enters the Sobol pass."""
    influential: set[str] = set()
    for df in morris_results.values():
        max_mu_star = df["mu_star"].max()
        if max_mu_star <= 0:
            continue
        cutoff = threshold_fraction * max_mu_star
        influential |= set(df.loc[df["mu_star"] >= cutoff, "parameter"])
    return sorted(influential)


def run_sobol(
    param_space: dict[str, dict],
    names: list[str],
    fixtures: list[FixtureSpec],
    bank: SeedBank,
    metrics: list[str],
    *,
    n_base_samples: int = 32,
    replications_per_fixture: int = 8,
    seed: int = 0,
    **kwargs: Any,
) -> dict[str, pd.DataFrame]:
    """n_base_samples=32 with calc_second_order=False costs N*(k+2) evaluations — small on
    purpose (a demonstration-scale run, not a converged Sobol estimate); each evaluation is
    itself a full match-benchmark run. Scale up n_base_samples/replications_per_fixture for a
    real analysis, budget permitting."""
    problem = build_salib_problem(param_space, names)
    samples = sobol_sample.sample(problem, N=n_base_samples, calc_second_order=False, seed=seed)
    outputs = evaluate_samples(samples, names, fixtures, bank, metrics, replications_per_fixture=replications_per_fixture, **kwargs)

    results: dict[str, pd.DataFrame] = {}
    for metric in metrics:
        y = outputs[f"metric__{metric}"].to_numpy()
        if np.any(np.isnan(y)) or np.allclose(y, y[0]):
            continue
        si = sobol_analyze.analyze(problem, y, calc_second_order=False, print_to_console=False, seed=seed)
        results[metric] = pd.DataFrame({"parameter": problem["names"], "S1": si["S1"], "ST": si["ST"]})
    return results


def parameter_metric_matrix(results: dict[str, pd.DataFrame], value_col: str) -> pd.DataFrame:
    """Pivots {metric: DataFrame(parameter, value_col, ...)} into one parameter x metric matrix —
    the SRS's headline sensitivity output (e.g. agressividade -> cartões de atacantes)."""
    series = [df.set_index("parameter")[value_col].rename(metric) for metric, df in results.items()]
    return pd.concat(series, axis=1) if series else pd.DataFrame()
