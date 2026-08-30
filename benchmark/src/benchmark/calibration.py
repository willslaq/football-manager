"""Optuna-driven calibration. Runs only after the pieces it depends on are already working
(reproducible RNG, stratified fixtures, metrics/comparison, Dixon-Coles baseline, a passing smoke
profile — SRS's ordering). Every trial evaluates against the SAME search-bank fixtures/seeds,
frozen by the caller before the study starts (SRS "Congele antes da busca"); `cli.py` reevaluates
the winner against the validation bank + holdout season separately — this module never touches
those.

Never writes back into src/engine/simulation/config.ts. `run_calibration` returns a result object;
turning it into an updated engine config is an explicit, separate, human step (SRS "A atualização
da configuração oficial deve ser uma decisão explícita").
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import numpy as np
import optuna
import pandas as pd
import yaml

from .comparison import METRIC_EXTRACTORS, _extract
from .fixtures import FixtureSpec
from .metrics import GOAL_BUCKET_LABELS, _bucket_goals
from .seed_bank import SeedBank
from .simulation import run_match_benchmark
from .statistics import huber_loss, jensen_shannon_distance

optuna.logging.set_verbosity(optuna.logging.WARNING)


def load_parameters_config(path: Path) -> dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def suggest_params(trial: optuna.Trial, param_space: dict[str, dict], names: list[str]) -> dict[str, float]:
    return {name: trial.suggest_float(name, param_space[name]["low"], param_space[name]["high"]) for name in names}


def score_matrix_js(sim_df: pd.DataFrame, real_df: pd.DataFrame) -> float:
    sim_dist = sim_df["total_goals"].apply(_bucket_goals).value_counts(normalize=True).reindex(GOAL_BUCKET_LABELS, fill_value=0.0).to_dict()
    real_total = real_df["home_goals"] + real_df["away_goals"]
    real_dist = real_total.apply(_bucket_goals).value_counts(normalize=True).reindex(GOAL_BUCKET_LABELS, fill_value=0.0).to_dict()
    return jensen_shannon_distance(sim_dist, real_dist)


def composite_loss(
    sim_df: pd.DataFrame,
    real_df: pd.DataFrame,
    tolerances: dict[str, float],
    objective_groups: dict[str, dict],
    distribution_weights: dict[str, float],
) -> dict[str, Any]:
    """SRS's loss formula: sum(weight_metric * huber((sim-real)/tolerance)) per objective group +
    weight_score * JS(score distributions). Groups are kept separate in the output (not just
    summed) so one group's improvement can't silently hide another's regression."""
    group_losses: dict[str, float] = {}
    metric_residuals: dict[str, dict[str, float]] = {}

    for group_name, group_cfg in objective_groups.items():
        group_loss = 0.0
        for metric in group_cfg["metrics"]:
            sim_values = _extract(sim_df, metric)
            real_values = _extract(real_df, metric)
            tolerance = tolerances.get(metric)
            if sim_values is None or real_values is None or not tolerance or len(sim_values) == 0 or len(real_values) == 0:
                continue
            residual = (float(np.mean(sim_values)) - float(np.mean(real_values))) / tolerance
            hl = huber_loss(residual)
            metric_residuals[metric] = {"residual": residual, "huber": hl}
            group_loss += hl
        group_losses[group_name] = group_loss * group_cfg.get("weight", 1.0)

    js = score_matrix_js(sim_df, real_df)
    js_term = distribution_weights.get("score_matrix_jensen_shannon", 0.0) * js
    total = sum(group_losses.values()) + js_term

    return {
        "total": total,
        "by_group": group_losses,
        "by_metric": metric_residuals,
        "score_matrix_js": js,
        "score_matrix_js_term": js_term,
    }


@dataclass
class TrialRecord:
    number: int
    params: dict[str, float]
    loss: dict[str, Any]


@dataclass
class CalibrationResult:
    study: optuna.Study
    best: TrialRecord
    trials: list[TrialRecord] = field(default_factory=list)


def run_calibration(
    fixtures: list[FixtureSpec],
    bank: SeedBank,
    real_fit_df: pd.DataFrame,
    tolerances: dict[str, float],
    objective_groups: dict[str, dict],
    distribution_weights: dict[str, float],
    param_space: dict[str, dict],
    param_names: list[str],
    *,
    n_trials: int = 20,
    replications_per_fixture: int = 30,
    world_seed: int = 2026,
    tactical_intensity: str = "subtle",
    n_workers: Optional[int] = None,
    seed: int = 0,
    prune_after_matches: Optional[int] = None,
    prune_loss_ceiling: Optional[float] = None,
    progress_cb: Optional[Any] = None,
) -> CalibrationResult:
    """`prune_after_matches`/`prune_loss_ceiling`: cheap early-abort for a trial whose partial
    result is already clearly bad (SRS "possibilidade de interromper candidatos claramente
    ruins") — evaluated on a small first slice of the trial's own matches before running the
    rest, not a real Optuna pruner (keeps this simple; still checked before the pool call so a
    bad candidate never fully absorbs replications_per_fixture)."""
    sampler = optuna.samplers.TPESampler(seed=seed)
    study = optuna.create_study(direction="minimize", sampler=sampler)
    trials: list[TrialRecord] = []

    def _evaluate(params: dict[str, float], reps: int) -> tuple[dict[str, Any], pd.DataFrame]:
        result = run_match_benchmark(
            fixtures,
            bank,
            replications_per_fixture=reps,
            world_seed=world_seed,
            tactical_intensity=tactical_intensity,
            params=params,
            trace_sample_per_stratum=0,
            n_workers=n_workers,
        )
        sim_df = pd.DataFrame(result.summary_rows)
        loss = composite_loss(sim_df, real_fit_df, tolerances, objective_groups, distribution_weights)
        return loss, sim_df

    def objective(trial: optuna.Trial) -> float:
        params = suggest_params(trial, param_space, param_names)

        if prune_after_matches and prune_loss_ceiling is not None:
            probe_reps = max(1, prune_after_matches // max(1, len(fixtures)))
            probe_loss, _ = _evaluate(params, probe_reps)
            if probe_loss["total"] > prune_loss_ceiling:
                record = TrialRecord(number=trial.number, params=params, loss={**probe_loss, "pruned": True})
                trials.append(record)
                if progress_cb:
                    progress_cb(trial.number, n_trials, probe_loss["total"])
                return probe_loss["total"]

        loss, _ = _evaluate(params, replications_per_fixture)
        record = TrialRecord(number=trial.number, params=params, loss=loss)
        trials.append(record)
        if progress_cb:
            progress_cb(trial.number, n_trials, loss["total"])
        return loss["total"]

    study.optimize(objective, n_trials=n_trials)
    best = min(trials, key=lambda r: r.loss["total"])
    return CalibrationResult(study=study, best=best, trials=trials)
