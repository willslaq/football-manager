"""Ties together dados reais x Dixon-Coles x motor (atual/candidato) into the per-metric
comparison table the SRS asks for: real value, real n, sim value, sim n, absolute/relative diff,
CI, tolerance, distribution distance, verdict — one row per metric, not a single overall score.

Also implements the paired baseline-vs-candidate comparison under common random numbers (CRN):
when two configs are run against the SAME fixtures+seeds, `paired_config_comparison` uses the
per-match paired differences directly (far tighter than treating the two runs as independent
samples), and reports config_hash for both sides so a diff is always traceable to what actually
changed.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, Optional

import numpy as np
import pandas as pd
import yaml

from . import statistics as stats_mod
from .statistics import CIResult, Verdict

MetricExtractor = Callable[[pd.DataFrame], np.ndarray]

# Cada extractor lê as MESMAS colunas do summary_df do motor (events.flatten_match_record) e,
# quando aplicável, do snapshot real (season/round/date/home_team/away_team/home_goals/away_goals
# — sem fouls/cards, ver snapshots/real/README.md). Um extractor que KeyError/AttributeError num
# DataFrame sinaliza "métrica indisponível nessa fonte", tratado como no_target por
# compare_metrics_table — nunca fabricamos um valor.
METRIC_EXTRACTORS: dict[str, MetricExtractor] = {
    "goals_per_match": lambda df: (df["home_goals"] + df["away_goals"]).to_numpy(dtype=float),
    "goals_per_match_home": lambda df: df["home_goals"].to_numpy(dtype=float),
    "goals_per_match_away": lambda df: df["away_goals"].to_numpy(dtype=float),
    "home_win_rate": lambda df: (df["home_goals"] > df["away_goals"]).to_numpy(dtype=float),
    "draw_rate": lambda df: (df["home_goals"] == df["away_goals"]).to_numpy(dtype=float),
    "away_win_rate": lambda df: (df["home_goals"] < df["away_goals"]).to_numpy(dtype=float),
    "clean_sheet_rate_home": lambda df: (df["away_goals"] == 0).to_numpy(dtype=float),
    "clean_sheet_rate_away": lambda df: (df["home_goals"] == 0).to_numpy(dtype=float),
    "score_0_0": lambda df: ((df["home_goals"] == 0) & (df["away_goals"] == 0)).to_numpy(dtype=float),
    "score_1_0": lambda df: ((df["home_goals"] == 1) & (df["away_goals"] == 0)).to_numpy(dtype=float),
    "score_0_1": lambda df: ((df["home_goals"] == 0) & (df["away_goals"] == 1)).to_numpy(dtype=float),
    "score_1_1": lambda df: ((df["home_goals"] == 1) & (df["away_goals"] == 1)).to_numpy(dtype=float),
    "fouls_per_match": lambda df: (df["fouls_home"] + df["fouls_away"]).to_numpy(dtype=float),
    "yellow_cards_per_match": lambda df: (df["yellow_cards_home"] + df["yellow_cards_away"]).to_numpy(dtype=float),
    "red_cards_per_match": lambda df: (df["red_cards_home"] + df["red_cards_away"]).to_numpy(dtype=float),
}


def load_targets_config(path: Path) -> dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_real_snapshot(config: dict[str, Any], benchmark_dir: Path) -> pd.DataFrame:
    return pd.read_csv(benchmark_dir / config["real_snapshot"]["path"])


def split_fit_holdout(df: pd.DataFrame, config: dict[str, Any]) -> tuple[pd.DataFrame, pd.DataFrame]:
    fit_seasons = set(config["real_snapshot"]["fit_seasons"])
    holdout_seasons = set(config["real_snapshot"]["holdout_seasons"])
    return df[df["season"].isin(fit_seasons)].copy(), df[df["season"].isin(holdout_seasons)].copy()


def _extract(df: pd.DataFrame, metric: str) -> Optional[np.ndarray]:
    extractor = METRIC_EXTRACTORS.get(metric)
    if extractor is None:
        return None
    try:
        return extractor(df)
    except (KeyError, AttributeError):
        return None


def compare_metrics_table(
    sim_df: pd.DataFrame,
    real_df: pd.DataFrame,
    tolerances: dict[str, float],
    *,
    metrics_list: Optional[list[str]] = None,
    real_is_fixed: bool = True,
) -> list[dict[str, Any]]:
    """One row per metric: dados reais x motor. `real_is_fixed=True` treats the real value as a
    known point target (bootstraps only the sim side, via bootstrap_ci — appropriate when the
    real snapshot is a large/authoritative aggregate); set False to bootstrap both sides
    (two_sample_mean_diff_ci) when the real snapshot itself is small enough that its own sampling
    error matters (true here: the demo snapshot is only ~380 fit-season matches)."""
    metrics_list = metrics_list or list(METRIC_EXTRACTORS)
    rows: list[dict[str, Any]] = []

    for metric in metrics_list:
        sim_values = _extract(sim_df, metric)
        real_values = _extract(real_df, metric)
        tolerance = tolerances.get(metric)

        if sim_values is None or real_values is None or len(sim_values) == 0 or len(real_values) == 0:
            rows.append(
                {
                    "metric": metric,
                    "real_value": float(np.mean(real_values)) if real_values is not None and len(real_values) else None,
                    "real_n": int(len(real_values)) if real_values is not None else None,
                    "sim_value": float(np.mean(sim_values)) if sim_values is not None and len(sim_values) else None,
                    "sim_n": int(len(sim_values)) if sim_values is not None else None,
                    "abs_diff": None,
                    "rel_diff": None,
                    "ci_low": None,
                    "ci_high": None,
                    "tolerance": tolerance,
                    "verdict": "no_target",
                }
            )
            continue

        real_value, sim_value = float(np.mean(real_values)), float(np.mean(sim_values))
        if real_is_fixed:
            ci = stats_mod.bootstrap_ci(sim_values - real_value)
        else:
            ci = stats_mod.two_sample_mean_diff_ci(sim_values, real_values)

        verdict: Verdict = "inconclusive"
        if tolerance is not None:
            verdict = stats_mod.equivalence_gate(ci.low, ci.high, tolerance)

        rows.append(
            {
                "metric": metric,
                "real_value": real_value,
                "real_n": int(len(real_values)),
                "sim_value": sim_value,
                "sim_n": int(len(sim_values)),
                "abs_diff": sim_value - real_value,
                "rel_diff": (sim_value - real_value) / real_value if real_value != 0 else None,
                "ci_low": ci.low,
                "ci_high": ci.high,
                "tolerance": tolerance,
                "verdict": verdict,
            }
        )
    return rows


def four_way_table(
    real_df: pd.DataFrame,
    dc_metrics: dict[str, Any],
    engine_current_df: pd.DataFrame,
    engine_candidate_df: Optional[pd.DataFrame] = None,
    *,
    metrics_list: Optional[list[str]] = None,
) -> pd.DataFrame:
    """dados reais x Dixon-Coles x motor atual x motor candidato, lado a lado (SRS's principal
    tabela de comparação). `dc_metrics` is dixon_coles.dixon_coles_aggregate_metrics()'s output —
    a plain dict of the same metric names, not a DataFrame (the DC model gives point predictions,
    not a resampleable per-match distribution)."""
    metrics_list = metrics_list or [
        "goals_per_match", "goals_per_match_home", "goals_per_match_away",
        "home_win_rate", "draw_rate", "away_win_rate",
    ]
    rows = []
    for metric in metrics_list:
        real_values = _extract(real_df, metric)
        current_values = _extract(engine_current_df, metric)
        row = {
            "metric": metric,
            "real": float(np.mean(real_values)) if real_values is not None and len(real_values) else None,
            "dixon_coles": dc_metrics.get(metric),
            "engine_current": float(np.mean(current_values)) if current_values is not None and len(current_values) else None,
        }
        if engine_candidate_df is not None:
            candidate_values = _extract(engine_candidate_df, metric)
            row["engine_candidate"] = (
                float(np.mean(candidate_values)) if candidate_values is not None and len(candidate_values) else None
            )
        rows.append(row)
    return pd.DataFrame(rows)


def flag_dc_regressions(comparison_df: pd.DataFrame, real_df: pd.DataFrame, dc_metrics: dict[str, Any]) -> list[str]:
    """SRS: 'se o motor detalhado ficar estatisticamente pior que o Dixon-Coles, marque a métrica
    como regressão'. Compares |engine - real| vs |dixon_coles - real| per metric."""
    flags = []
    for _, row in comparison_df.iterrows():
        metric, real_value, dc_value, engine_value = row["metric"], row.get("real"), row.get("dixon_coles"), row.get("engine_current")
        if real_value is None or dc_value is None or engine_value is None:
            continue
        if abs(engine_value - real_value) > abs(dc_value - real_value):
            flags.append(metric)
    return flags


# --- comparação pareada entre duas configurações (common random numbers) ------------------------


def paired_config_comparison(
    baseline_df: pd.DataFrame,
    candidate_df: pd.DataFrame,
    tolerances: dict[str, float],
    *,
    metrics_list: Optional[list[str]] = None,
    join_key: str = "run_id",
) -> list[dict[str, Any]]:
    """Baseline x candidato usando OS MESMOS fixtures/seeds (join por run_id, que embute
    fixture_id+índice de replicação — ver simulation._build_match_jobs). A diferença pareada
    cancela a aleatoriedade compartilhada, então a mesma quantidade de partidas detecta uma
    diferença bem menor que comparar as duas amostras como se fossem independentes."""
    merged = baseline_df.merge(candidate_df, on=join_key, suffixes=("_baseline", "_candidate"))
    if len(merged) == 0:
        raise ValueError("paired_config_comparison: nenhum run_id em comum — as duas corridas usaram fixtures/seeds diferentes?")

    metrics_list = metrics_list or list(METRIC_EXTRACTORS)
    rows = []
    for metric in metrics_list:
        extractor = METRIC_EXTRACTORS.get(metric)
        if extractor is None:
            continue
        try:
            baseline_cols = merged.rename(columns=lambda c: c.replace("_baseline", "") if c.endswith("_baseline") else c)
            candidate_cols = merged.rename(columns=lambda c: c.replace("_candidate", "") if c.endswith("_candidate") else c)
            a = extractor(baseline_cols)
            b = extractor(candidate_cols)
        except (KeyError, AttributeError):
            continue

        ci = stats_mod.paired_diff_ci(a, b)
        tolerance = tolerances.get(metric)
        verdict = stats_mod.equivalence_gate(ci.low, ci.high, tolerance) if tolerance is not None else "inconclusive"
        rows.append(
            {
                "metric": metric,
                "n_pairs": int(len(merged)),
                "baseline_value": float(np.mean(a)),
                "candidate_value": float(np.mean(b)),
                "diff": ci.point,
                "ci_low": ci.low,
                "ci_high": ci.high,
                "tolerance": tolerance,
                "verdict": verdict,
            }
        )
    return rows
