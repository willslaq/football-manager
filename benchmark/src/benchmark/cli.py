"""Command-line entry point: `benchmark run|compare|report|calibrate|sensitivity`.

See benchmark/README.md for full command docs. Every command resolves configs relative to
benchmark/configs/ and writes artifacts under benchmark/reports/<command>-<timestamp>/ unless
--out is given.
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import click
import pandas as pd
import yaml

from .calibration import load_parameters_config, run_calibration
from .comparison import (
    compare_metrics_table,
    flag_dc_regressions,
    four_way_table,
    load_real_snapshot,
    load_targets_config,
    paired_config_comparison,
    split_fit_holdout,
)
from .dixon_coles import dixon_coles_aggregate_metrics, fit_dixon_coles
from .engine_adapter import EngineAdapter
from .events import build_player_index, season_records_to_summary_df
from .fixtures import build_fixture_bank, load_fixture_bank, load_fixtures_config, save_fixture_bank, strata_summary
from .metrics import authorship_metrics, discipline_metrics, foul_origin_metrics, goal_metrics, season_metrics, strength_response_metrics
from .reporting import build_run_meta, render_markdown, write_parameters_json, write_run_report
from .seed_bank import SeedBank, search_bank, validation_bank
from .sensitivity import parameter_metric_matrix, run_morris, run_sobol, screen_influential_params
from .simulation import run_match_benchmark, run_season_benchmark

BENCHMARK_DIR = Path(__file__).resolve().parents[2]
CONFIGS_DIR = BENCHMARK_DIR / "configs"
REPORTS_DIR = BENCHMARK_DIR / "reports"
SNAPSHOTS_DIR = BENCHMARK_DIR / "snapshots"


def _load_yaml(path: Path) -> dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def _timestamp() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S")


def _ensure_fixture_bank(*, rebuild: bool = False) -> list:
    bank_path = SNAPSHOTS_DIR / "fixtures_bank.json"
    if bank_path.exists() and not rebuild:
        return load_fixture_bank(bank_path)
    fixtures_cfg = load_fixtures_config(CONFIGS_DIR / "fixtures.yaml")
    with EngineAdapter() as adapter:
        fixtures = build_fixture_bank(adapter, fixtures_cfg)
    save_fixture_bank(fixtures, bank_path)
    return fixtures


def _seed_bank_for(kind: str) -> SeedBank:
    return search_bank() if kind == "search" else validation_bank()


def _load_real_and_dc() -> tuple[dict, pd.DataFrame, pd.DataFrame, Any]:
    targets_cfg = load_targets_config(CONFIGS_DIR / "targets.yaml")
    real_df = load_real_snapshot(targets_cfg, BENCHMARK_DIR)
    fit_df, holdout_df = split_fit_holdout(real_df, targets_cfg)
    dc_fit = fit_dixon_coles(fit_df)
    return targets_cfg, fit_df, holdout_df, dc_fit


@click.group()
def cli() -> None:
    """Benchmark, validation and calibration tool for footmanager's match/season engine."""


# --- run -------------------------------------------------------------------------------------


@cli.command()
@click.option("--profile", type=click.Choice(["smoke", "nightly", "calibration", "release"]), default="smoke")
@click.option("--out", type=click.Path(path_type=Path), default=None)
@click.option("--rebuild-fixtures", is_flag=True, help="Rebuild the stratified fixture bank from world_ratings before running.")
@click.option("--world-seed", type=int, default=2026)
@click.option("--n-workers", type=int, default=None)
def run(profile: str, out: Optional[Path], rebuild_fixtures: bool, world_seed: int, n_workers: Optional[int]) -> None:
    """Run the Monte Carlo match+season benchmark for one profile and write a full report."""
    profiles_cfg = _load_yaml(CONFIGS_DIR / "profiles.yaml")
    profile_cfg = profiles_cfg[profile]
    fixtures_cfg = load_fixtures_config(CONFIGS_DIR / "fixtures.yaml")
    tactical_intensity = fixtures_cfg["tactical_intensity"]

    fixtures = _ensure_fixture_bank(rebuild=rebuild_fixtures)
    bank = _seed_bank_for(profile_cfg["seed_bank"])
    click.echo(f"[run] profile={profile} fixtures={len(fixtures)} seed_bank={profile_cfg['seed_bank']} (root_seed={bank.root_seed})")

    def progress(i: int, n: int) -> None:
        if i % max(1, n // 10) == 0 or i == n:
            click.echo(f"  matches: {i}/{n}")

    result = run_match_benchmark(
        fixtures,
        bank,
        replications_per_fixture=profile_cfg["replications_per_fixture"],
        world_seed=world_seed,
        tactical_intensity=tactical_intensity,
        trace_sample_per_stratum=profile_cfg["trace_sample_per_stratum"],
        n_workers=n_workers,
        adaptive=profile_cfg.get("adaptive"),
        progress_cb=progress,
    )
    click.echo(
        f"[run] {result.n_matches} matches in {result.elapsed_s:.1f}s, {len(result.failures)} failures"
        + (" (adaptive stop)" if result.stopped_early else "")
    )

    sim_df = pd.DataFrame(result.summary_rows)
    events_df = pd.DataFrame(result.event_rows)

    n_seasons = profile_cfg.get("n_seasons", 0)
    season_result = None
    if n_seasons:
        click.echo(f"[run] simulating {n_seasons} full seasons...")
        season_result = run_season_benchmark(bank, n_seasons=n_seasons, tactical_intensity=tactical_intensity, n_workers=n_workers)
    representative_df = season_records_to_summary_df(season_result.records) if season_result and season_result.records else sim_df

    targets_cfg, fit_df, _holdout_df, dc_fit = _load_real_and_dc()
    dc_metrics = dixon_coles_aggregate_metrics(dc_fit, list(zip(representative_df["home_team"], representative_df["away_team"])))
    comparison_table = compare_metrics_table(representative_df, fit_df, targets_cfg["tolerances"], real_is_fixed=False)
    four_way_df = four_way_table(fit_df, dc_metrics, representative_df)
    dc_regressions = flag_dc_regressions(four_way_df, fit_df, dc_metrics)

    with EngineAdapter() as adapter:
        engine_version = adapter.engine_version
        world_ratings = adapter.world_ratings(world_seed=world_seed)["clubs"]
        player_index = build_player_index(adapter.world_players(world_seed=world_seed))

    config_hash = sim_df["config_hash"].iloc[0] if len(sim_df) else "unknown"
    meta = build_run_meta(
        profile=profile,
        engine_version=engine_version or "unknown",
        config_hash=config_hash,
        seed_bank_kind=profile_cfg["seed_bank"],
        root_seed=bank.root_seed,
        n_workers=n_workers or max(1, (os.cpu_count() or 2) - 1),
        elapsed_s=result.elapsed_s,
        n_matches=result.n_matches,
        extra={"stopped_early": result.stopped_early, "n_seasons": n_seasons},
    )

    out_dir = out or (REPORTS_DIR / f"{profile}-{_timestamp()}")
    report = write_run_report(
        out_dir,
        meta=meta,
        summary_rows=result.summary_rows,
        event_rows=result.event_rows,
        failures=result.failures,
        strata_counts=strata_summary(fixtures),
        goal_metrics=goal_metrics(sim_df),
        discipline_metrics=discipline_metrics(sim_df, events_df),
        authorship_metrics=authorship_metrics(events_df, len(sim_df)),
        strength_response=strength_response_metrics(sim_df),
        comparison_table=comparison_table,
        four_way=four_way_df.to_dict(orient="records"),
        dc_regressions=dc_regressions,
        season_metrics=season_metrics(season_result.records, world_ratings) if season_result else None,
        foul_origin=foul_origin_metrics(result.trace_records, player_index) if result.trace_records else None,
    )
    click.echo(f"[run] report written to {out_dir}")
    click.echo(
        f"[run] metrics: {report['summary']['n_metrics_passed']} pass / "
        f"{report['summary']['n_metrics_failed']} fail / {report['summary']['n_metrics_inconclusive']} inconclusive"
    )


# --- compare -----------------------------------------------------------------------------------


@cli.command()
@click.argument("baseline_params", type=click.Path(path_type=Path))
@click.argument("candidate_params", type=click.Path(path_type=Path))
@click.option("--profile", default="calibration")
@click.option("--out", type=click.Path(path_type=Path), default=None)
@click.option("--world-seed", type=int, default=2026)
@click.option("--n-workers", type=int, default=None)
def compare(baseline_params: Path, candidate_params: Path, profile: str, out: Optional[Path], world_seed: int, n_workers: Optional[int]) -> None:
    """Compare two engine configs (JSON param-override files) on the SAME fixtures+seeds (CRN).

    Pass a path that doesn't exist (e.g. `-`) for BASELINE_PARAMS to compare the engine's
    defaults against CANDIDATE_PARAMS.
    """
    baseline = json.loads(baseline_params.read_text()) if baseline_params.exists() else {}
    candidate = json.loads(candidate_params.read_text())

    profiles_cfg = _load_yaml(CONFIGS_DIR / "profiles.yaml")
    profile_cfg = profiles_cfg[profile]
    fixtures_cfg = load_fixtures_config(CONFIGS_DIR / "fixtures.yaml")
    tactical_intensity = fixtures_cfg["tactical_intensity"]

    fixtures = _ensure_fixture_bank()
    bank = _seed_bank_for(profile_cfg["seed_bank"])
    reps = profile_cfg["replications_per_fixture"]

    click.echo(f"[compare] running baseline ({len(fixtures)} fixtures x {reps} reps)...")
    baseline_result = run_match_benchmark(
        fixtures, bank, replications_per_fixture=reps, world_seed=world_seed, tactical_intensity=tactical_intensity,
        params=baseline or None, trace_sample_per_stratum=0, n_workers=n_workers,
    )
    click.echo("[compare] running candidate...")
    candidate_result = run_match_benchmark(
        fixtures, bank, replications_per_fixture=reps, world_seed=world_seed, tactical_intensity=tactical_intensity,
        params=candidate, trace_sample_per_stratum=0, n_workers=n_workers,
    )

    baseline_df = pd.DataFrame(baseline_result.summary_rows)
    candidate_df = pd.DataFrame(candidate_result.summary_rows)
    targets_cfg = load_targets_config(CONFIGS_DIR / "targets.yaml")
    paired = paired_config_comparison(baseline_df, candidate_df, targets_cfg["tolerances"])

    click.echo(f"\nbaseline config_hash={baseline_df['config_hash'].iloc[0]} candidate config_hash={candidate_df['config_hash'].iloc[0]}")
    for row in sorted(paired, key=lambda r: {"fail": 0, "inconclusive": 1, "pass": 2}.get(r["verdict"], 9)):
        click.echo(
            f"  {row['metric']:26s} {row['baseline_value']:.4f} -> {row['candidate_value']:.4f} "
            f"(diff={row['diff']:+.4f}, CI=[{row['ci_low']:+.4f}, {row['ci_high']:+.4f}], tol={row['tolerance']}) [{row['verdict']}]"
        )

    out_dir = out or (REPORTS_DIR / f"compare-{_timestamp()}")
    write_parameters_json(
        {
            "baseline_params": baseline,
            "candidate_params": candidate,
            "baseline_config_hash": baseline_df["config_hash"].iloc[0],
            "candidate_config_hash": candidate_df["config_hash"].iloc[0],
            "n_pairs": len(baseline_df),
            "paired_comparison": paired,
        },
        out_dir,
        filename="comparison.json",
    )
    click.echo(f"\n[compare] full report written to {out_dir}/comparison.json")


# --- report ------------------------------------------------------------------------------------


@cli.command()
@click.argument("report_json", type=click.Path(exists=True, path_type=Path))
def report(report_json: Path) -> None:
    """Re-render report.md (to stdout) from an existing report.json."""
    data = json.loads(report_json.read_text())
    click.echo(render_markdown(data))


# --- calibrate ---------------------------------------------------------------------------------


@cli.command()
@click.option("--profile", default="calibration")
@click.option("--n-trials", type=int, default=20)
@click.option("--demo/--full", default=True, help="--demo uses parameters.yaml's small demo_subset; --full searches every parameter.")
@click.option("--out", type=click.Path(path_type=Path), default=None)
@click.option("--world-seed", type=int, default=2026)
@click.option("--n-workers", type=int, default=None)
def calibrate(profile: str, n_trials: int, demo: bool, out: Optional[Path], world_seed: int, n_workers: Optional[int]) -> None:
    """Optuna search over the engine's tunable parameters. Writes a candidates report — never
    applies anything to src/engine/simulation/config.ts (that's an explicit, separate decision)."""
    profiles_cfg = _load_yaml(CONFIGS_DIR / "profiles.yaml")
    profile_cfg = profiles_cfg[profile]
    fixtures_cfg = load_fixtures_config(CONFIGS_DIR / "fixtures.yaml")
    tactical_intensity = fixtures_cfg["tactical_intensity"]
    metrics_cfg = _load_yaml(CONFIGS_DIR / "metrics.yaml")
    params_cfg = load_parameters_config(CONFIGS_DIR / "parameters.yaml")
    names = params_cfg["demo_subset"] if demo else list(params_cfg["parameters"])

    fixtures = _ensure_fixture_bank()
    search_seeds = _seed_bank_for(profile_cfg["seed_bank"])
    targets_cfg, fit_df, holdout_df, _dc_fit = _load_real_and_dc()

    with EngineAdapter() as adapter:
        defaults = adapter.config_schema()["defaults"]

    click.echo(f"[calibrate] {n_trials} trials over {len(names)} params ({'demo' if demo else 'full'} space): {names}")

    def progress(i: int, n: int, loss: float) -> None:
        click.echo(f"  trial {i + 1}/{n} loss={loss:.4f}")

    result = run_calibration(
        fixtures, search_seeds, fit_df, targets_cfg["tolerances"], metrics_cfg["objective_groups"], metrics_cfg["distribution_weights"],
        params_cfg["parameters"], names, n_trials=n_trials, replications_per_fixture=profile_cfg["replications_per_fixture"],
        world_seed=world_seed, tactical_intensity=tactical_intensity, n_workers=n_workers, progress_cb=progress,
    )
    click.echo(f"[calibrate] best trial #{result.best.number}: loss={result.best.loss['total']:.4f} params={result.best.params}")

    click.echo("[calibrate] reevaluating best candidate against VALIDATION seeds (never used during search)...")
    validation_seeds = validation_bank()
    reval_reps = profile_cfg["replications_per_fixture"] * 2
    baseline_result = run_match_benchmark(
        fixtures, validation_seeds, replications_per_fixture=reval_reps, world_seed=world_seed, tactical_intensity=tactical_intensity,
        params=None, trace_sample_per_stratum=0, n_workers=n_workers,
    )
    candidate_result = run_match_benchmark(
        fixtures, validation_seeds, replications_per_fixture=reval_reps, world_seed=world_seed, tactical_intensity=tactical_intensity,
        params=result.best.params, trace_sample_per_stratum=0, n_workers=n_workers,
    )
    baseline_df = pd.DataFrame(baseline_result.summary_rows)
    candidate_df = pd.DataFrame(candidate_result.summary_rows)
    validation_paired = paired_config_comparison(baseline_df, candidate_df, targets_cfg["tolerances"])
    holdout_comparison = compare_metrics_table(candidate_df, holdout_df, targets_cfg["tolerances"], real_is_fixed=False)

    for row in validation_paired:
        click.echo(f"  [validation] {row['metric']:26s} {row['baseline_value']:.4f} -> {row['candidate_value']:.4f} [{row['verdict']}]")

    payload = {
        "profile": profile,
        "n_trials": n_trials,
        "param_space": names,
        "old_params": defaults,
        "candidate_params": result.best.params,
        "diff": {k: result.best.params[k] - defaults.get(k, 0.0) for k in result.best.params},
        "search_loss": result.best.loss,
        "validation_paired_comparison": validation_paired,
        "holdout_comparison": holdout_comparison,
        "all_trials": [{"number": t.number, "params": t.params, "loss_total": t.loss["total"]} for t in result.trials],
        "note": "Candidato NÃO foi aplicado a src/engine/simulation/config.ts — decisão explícita e manual.",
    }
    out_dir = out or (REPORTS_DIR / f"calibrate-{_timestamp()}")
    write_parameters_json(payload, out_dir)
    click.echo(f"[calibrate] candidate report written to {out_dir}/parameters.json")


# --- sensitivity ---------------------------------------------------------------------------------


@cli.command()
@click.option("--metrics", "metrics_list", multiple=True, default=["goals_per_match", "yellow_cards_per_match", "home_win_rate"])
@click.option("--n-trajectories", type=int, default=8)
@click.option("--sobol/--no-sobol", default=True)
@click.option("--n-base-samples", type=int, default=16)
@click.option("--full-space/--demo-space", default=False)
@click.option("--out", type=click.Path(path_type=Path), default=None)
@click.option("--world-seed", type=int, default=2026)
@click.option("--n-workers", type=int, default=None)
def sensitivity(
    metrics_list: tuple[str, ...],
    n_trajectories: int,
    sobol: bool,
    n_base_samples: int,
    full_space: bool,
    out: Optional[Path],
    world_seed: int,
    n_workers: Optional[int],
) -> None:
    """Morris screening, then Sobol on the survivors — a parameter x metric influence matrix."""
    fixtures = _ensure_fixture_bank()
    bank = search_bank()
    params_cfg = load_parameters_config(CONFIGS_DIR / "parameters.yaml")
    names = list(params_cfg["parameters"]) if full_space else params_cfg["demo_subset"]
    metrics = list(metrics_list)

    click.echo(f"[sensitivity] Morris screening: {len(names)} params x {len(metrics)} metrics, {n_trajectories} trajectories")
    morris_results = run_morris(params_cfg["parameters"], names, fixtures, bank, metrics, n_trajectories=n_trajectories, world_seed=world_seed, n_workers=n_workers)
    for metric, df in morris_results.items():
        click.echo(f"  {metric}:")
        for _, r in df.sort_values("mu_star", ascending=False).iterrows():
            click.echo(f"    {r['parameter']:32s} mu_star={r['mu_star']:.4f} sigma={r['sigma']:.4f}")

    influential = screen_influential_params(morris_results)
    click.echo(f"[sensitivity] influential params (survive to Sobol): {influential}")

    payload: dict[str, Any] = {
        "morris": {m: df.to_dict(orient="records") for m, df in morris_results.items()},
        "influential_params": influential,
    }

    if sobol and influential:
        click.echo(f"[sensitivity] Sobol on {len(influential)} survivors, N={n_base_samples}")
        sobol_results = run_sobol(params_cfg["parameters"], influential, fixtures, bank, metrics, n_base_samples=n_base_samples, world_seed=world_seed, n_workers=n_workers)
        for metric, df in sobol_results.items():
            click.echo(f"  {metric}:")
            for _, r in df.sort_values("ST", ascending=False).iterrows():
                click.echo(f"    {r['parameter']:32s} S1={r['S1']:.4f} ST={r['ST']:.4f}")
        payload["sobol"] = {m: df.to_dict(orient="records") for m, df in sobol_results.items()}
        payload["parameter_metric_matrix_ST"] = parameter_metric_matrix(sobol_results, "ST").to_dict()

    out_dir = out or (REPORTS_DIR / f"sensitivity-{_timestamp()}")
    write_parameters_json(payload, out_dir, filename="sensitivity.json")
    click.echo(f"[sensitivity] report written to {out_dir}/sensitivity.json")


if __name__ == "__main__":
    cli()
