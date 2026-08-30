"""Assembles the run's output artifacts (SRS "Relatórios"):

- report.json    — full structured payload, for automation/other tools to consume
- report.md      — human-readable, worst problems first
- metrics.csv/.parquet — one row per match (events.flatten_match_record schema)
- failures.jsonl — seeds/fixtures that failed an invariant check or errored
- parameters.json — written by calibration.py for a candidate, not here (see that module)

REAL_DATA_IS_SYNTHETIC controls a banner printed at the top of every report — flip it only once a
real licensed snapshot replaces snapshots/real/brasileirao_demo.csv (see that directory's README).
"""

from __future__ import annotations

import json
import platform
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import pandas as pd

from . import events as events_mod

REAL_DATA_IS_SYNTHETIC = True


def _installed_versions() -> dict[str, str]:
    versions = {}
    for name in ("numpy", "scipy", "pandas", "optuna", "SALib", "penaltyblog"):
        try:
            module = __import__(name)
            versions[name] = getattr(module, "__version__", "unknown")
        except ImportError:
            versions[name] = "not installed"
    return versions


def build_run_meta(
    *,
    profile: str,
    engine_version: str,
    config_hash: str,
    seed_bank_kind: str,
    root_seed: int,
    n_workers: int,
    elapsed_s: float,
    n_matches: int,
    extra: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    try:
        git_sha = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=Path(__file__).resolve().parents[2]).decode().strip()
    except Exception:
        git_sha = "unknown"
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "profile": profile,
        "engine_version": engine_version,
        "config_hash": config_hash,
        "git_sha": git_sha,
        "seed_bank": seed_bank_kind,
        "root_seed": root_seed,
        "n_workers": n_workers,
        "elapsed_s": elapsed_s,
        "matches_per_second": (n_matches / elapsed_s) if elapsed_s > 0 else None,
        "n_matches": n_matches,
        "python": platform.python_version(),
        "dependency_versions": _installed_versions(),
        "real_data_is_synthetic_demo": REAL_DATA_IS_SYNTHETIC,
        **(extra or {}),
    }


def build_report(
    *,
    meta: dict[str, Any],
    strata_counts: dict[str, int],
    goal_metrics: dict[str, Any],
    discipline_metrics: dict[str, Any],
    authorship_metrics: dict[str, Any],
    strength_response: dict[str, Any],
    comparison_table: Optional[list[dict[str, Any]]] = None,
    four_way: Optional[list[dict[str, Any]]] = None,
    dc_regressions: Optional[list[str]] = None,
    season_metrics: Optional[dict[str, Any]] = None,
    foul_origin: Optional[dict[str, Any]] = None,
    failures: Optional[list[dict[str, Any]]] = None,
) -> dict[str, Any]:
    failures = failures or []
    comparison_table = comparison_table or []
    failed_or_inconclusive = [r for r in comparison_table if r["verdict"] in ("fail", "inconclusive")]
    return {
        "meta": meta,
        "strata_counts": strata_counts,
        "summary": {
            "n_failures": len(failures),
            "n_metrics_failed": sum(1 for r in comparison_table if r["verdict"] == "fail"),
            "n_metrics_inconclusive": sum(1 for r in comparison_table if r["verdict"] == "inconclusive"),
            "n_metrics_passed": sum(1 for r in comparison_table if r["verdict"] == "pass"),
            "dc_regressions": dc_regressions or [],
        },
        "goal_metrics": goal_metrics,
        "discipline_metrics": discipline_metrics,
        "authorship_metrics": authorship_metrics,
        "strength_response": strength_response,
        "foul_origin": foul_origin,
        "season_metrics": season_metrics,
        "comparison_table": comparison_table,
        "four_way_table": four_way,
        "failures_preview": failures[:20],
    }


def write_metrics_table(summary_rows: list[dict[str, Any]], out_dir: Path, *, basename: str = "metrics") -> None:
    events_mod.write_csv(summary_rows, out_dir / f"{basename}.csv")
    events_mod.write_parquet(summary_rows, out_dir / f"{basename}.parquet")


def write_failures(failures: list[dict[str, Any]], out_dir: Path) -> None:
    events_mod.write_jsonl(failures, out_dir / "failures.jsonl")


def write_report_json(report: dict[str, Any], out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    with open(out_dir / "report.json", "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False, default=str)


def write_parameters_json(payload: dict[str, Any], out_dir: Path, *, filename: str = "parameters.json") -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    with open(out_dir / filename, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False, default=str)


def _fmt(x: Any, digits: int = 3) -> str:
    if x is None:
        return "—"
    if isinstance(x, float):
        return f"{x:.{digits}f}"
    return str(x)


def render_markdown(report: dict[str, Any]) -> str:
    meta = report["meta"]
    lines: list[str] = []
    lines.append(f"# Benchmark report — profile `{meta['profile']}`")
    lines.append("")
    if meta.get("real_data_is_synthetic_demo"):
        lines.append(
            "> ⚠️ **Dados reais = demo sintético.** O snapshot em `snapshots/real/` não é o "
            "Brasileirão de verdade — ver `snapshots/real/README.md`. Trate qualquer status "
            "`pass`/`fail` contra 'dados reais' abaixo como demonstração do pipeline, não como "
            "veredito de balanceamento real."
        )
        lines.append("")

    lines.append(
        f"engine_version=`{meta['engine_version']}` · config_hash=`{meta['config_hash']}` · "
        f"git=`{meta['git_sha']}` · seed_bank=`{meta['seed_bank']}` (root_seed={meta['root_seed']}) · "
        f"{meta['n_matches']} partidas em {meta['elapsed_s']:.1f}s "
        f"({_fmt(meta.get('matches_per_second'), 1)} partidas/s, {meta['n_workers']} workers)"
    )
    lines.append("")

    summary = report["summary"]
    lines.append("## Resumo")
    lines.append(
        f"- Falhas de invariante/execução: **{summary['n_failures']}**\n"
        f"- Métricas: {summary['n_metrics_passed']} pass · {summary['n_metrics_failed']} fail · "
        f"{summary['n_metrics_inconclusive']} inconclusive\n"
        f"- Regressão vs Dixon-Coles: {', '.join(summary['dc_regressions']) if summary['dc_regressions'] else 'nenhuma'}"
    )
    lines.append("")

    if report.get("failures_preview"):
        lines.append("## Falhas (prioridade máxima)")
        for f in report["failures_preview"]:
            desc = f.get("problems") or f.get("error")
            lines.append(f"- `{f.get('fixture_id') or f.get('stratum')}` seed={f.get('seed')}: {desc}")
        lines.append("")

    comparison_table = report.get("comparison_table") or []
    if comparison_table:
        lines.append("## Dados reais x motor — por métrica")
        lines.append("")
        lines.append("| métrica | real (n) | sim (n) | diff abs | diff rel | IC95% | tolerância | status |")
        lines.append("|---|---|---|---|---|---|---|---|")
        # pior primeiro: fail, depois inconclusive, depois pass
        order = {"fail": 0, "inconclusive": 1, "no_target": 2, "pass": 3}
        for row in sorted(comparison_table, key=lambda r: order.get(r["verdict"], 9)):
            real = f"{_fmt(row['real_value'])} (n={row['real_n']})" if row["real_n"] else "—"
            sim = f"{_fmt(row['sim_value'])} (n={row['sim_n']})" if row["sim_n"] else "—"
            ci = f"[{_fmt(row['ci_low'])}, {_fmt(row['ci_high'])}]" if row.get("ci_low") is not None else "—"
            lines.append(
                f"| {row['metric']} | {real} | {sim} | {_fmt(row['abs_diff'])} | {_fmt(row['rel_diff'])} | "
                f"{ci} | {_fmt(row['tolerance'])} | **{row['verdict']}** |"
            )
        lines.append("")

    four_way = report.get("four_way_table")
    if four_way:
        lines.append("## Dados reais x Dixon-Coles x motor atual x candidato")
        lines.append("")
        cols = list(four_way[0].keys())
        lines.append("| " + " | ".join(cols) + " |")
        lines.append("|" + "---|" * len(cols))
        for row in four_way:
            lines.append("| " + " | ".join(_fmt(row.get(c)) for c in cols) + " |")
        lines.append("")

    goal_metrics = report.get("goal_metrics") or {}
    if goal_metrics.get("n"):
        lines.append("## Gols / placar (amostra simulada)")
        lines.append(
            f"- {_fmt(goal_metrics.get('goals_per_match'))} gols/partida "
            f"(mandante {_fmt(goal_metrics.get('goals_per_match_home'))}, visitante {_fmt(goal_metrics.get('goals_per_match_away'))})\n"
            f"- V/E/D mandante: {_fmt(goal_metrics.get('home_win_rate'))} / {_fmt(goal_metrics.get('draw_rate'))} / "
            f"{_fmt(goal_metrics.get('away_win_rate'))}\n"
            f"- Clean sheets: mandante {_fmt(goal_metrics.get('clean_sheet_rate_home'))}, "
            f"visitante {_fmt(goal_metrics.get('clean_sheet_rate_away'))}"
        )
        lines.append("")

    discipline = report.get("discipline_metrics") or {}
    if discipline.get("n"):
        lines.append("## Disciplina")
        lines.append(
            f"- {_fmt(discipline.get('fouls_per_match'))} faltas/partida, "
            f"{_fmt(discipline.get('yellow_cards_per_match'))} amarelos/partida, "
            f"{_fmt(discipline.get('red_cards_per_match'))} vermelhos/partida\n"
            f"- 2º amarelo entre os vermelhos: {_fmt(discipline.get('second_yellow_rate_of_reds'))}\n"
            f"- Cartão por estado do placar: {discipline.get('cards_by_scoreline_state')}"
        )
        lines.append("")

    foul_origin = report.get("foul_origin")
    if foul_origin and foul_origin.get("n_fouls"):
        lines.append("## Origem das faltas/cartões (amostra traçada)")
        lines.append(f"- {foul_origin['n_fouls']} faltas em {foul_origin['n_matches_traced']} partidas com trace")
        lines.append("")
        lines.append("| posição | faltas/90 | cartões/falta | cartões/90 |")
        lines.append("|---|---|---|---|")
        for pos, row in foul_origin.get("by_position", {}).items():
            lines.append(f"| {pos} | {_fmt(row['fouls_per_90'])} | {_fmt(row['cards_per_foul'])} | {_fmt(row['cards_per_90'])} |")
        lines.append("")

    authorship = report.get("authorship_metrics") or {}
    if authorship.get("n_matches"):
        lines.append("## Autoria — gols/chutes/conversão por posição")
        lines.append("| posição | chutes/90 | gols/90 | conversão |")
        lines.append("|---|---|---|---|")
        shots = authorship.get("shots_per_90_by_position", {})
        goals = authorship.get("goals_per_90_by_position", {})
        conv = authorship.get("conversion_by_position", {})
        for pos in sorted(shots):
            lines.append(f"| {pos} | {_fmt(shots.get(pos))} | {_fmt(goals.get(pos))} | {_fmt(conv.get(pos))} |")
        lines.append("")
        lines.append(f"_{authorship.get('assists')}_")
        lines.append("")

    strength = report.get("strength_response") or {}
    if strength.get("bins"):
        lines.append("## Resposta à diferença de força")
        lines.append("| faixa de rating_diff | n | saldo médio | taxa de zebra |")
        lines.append("|---|---|---|---|")
        for b in strength["bins"]:
            rng_str = f"[{_fmt(b['rating_diff_range'][0],1)}, {_fmt(b['rating_diff_range'][1],1)}]"
            lines.append(f"| {rng_str} | {b['n']} | {_fmt(b['goal_diff_mean'])} | {_fmt(b['upset_rate'])} |")
        lines.append("")

    season_metrics = report.get("season_metrics")
    if season_metrics and season_metrics.get("n_seasons"):
        lines.append("## Temporada (Monte Carlo)")
        champ = season_metrics.get("champion_distribution", {})
        top_champs = sorted(champ.items(), key=lambda kv: -kv[1])[:5]
        lines.append(f"- {season_metrics['n_seasons']} temporadas simuladas")
        lines.append(f"- Campeões mais frequentes: {', '.join(f'{c} ({_fmt(p,2)})' for c, p in top_champs)}")
        if "initial_strength_vs_final_position_spearman" in season_metrics:
            corr = season_metrics["initial_strength_vs_final_position_spearman"]
            lines.append(f"- Correlação força inicial x posição final (Spearman): {_fmt(corr['corr'])} (p={_fmt(corr['pvalue'],4)})")
        lines.append("")

    lines.append("## Cobertura de estratos")
    for stratum, count in report.get("strata_counts", {}).items():
        lines.append(f"- {stratum}: {count} fixtures")

    return "\n".join(lines)


def write_run_report(
    out_dir: Path,
    *,
    meta: dict[str, Any],
    summary_rows: list[dict[str, Any]],
    event_rows: list[dict[str, Any]],
    failures: list[dict[str, Any]],
    strata_counts: dict[str, int],
    goal_metrics: dict[str, Any],
    discipline_metrics: dict[str, Any],
    authorship_metrics: dict[str, Any],
    strength_response: dict[str, Any],
    comparison_table: Optional[list[dict[str, Any]]] = None,
    four_way: Optional[list[dict[str, Any]]] = None,
    dc_regressions: Optional[list[str]] = None,
    season_metrics: Optional[dict[str, Any]] = None,
    foul_origin: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Writes every artifact for one run into out_dir and returns the report dict."""
    out_dir.mkdir(parents=True, exist_ok=True)
    write_metrics_table(summary_rows, out_dir)
    if event_rows:
        events_mod.write_parquet(event_rows, out_dir / "events.parquet")
    write_failures(failures, out_dir)

    report = build_report(
        meta=meta,
        strata_counts=strata_counts,
        goal_metrics=goal_metrics,
        discipline_metrics=discipline_metrics,
        authorship_metrics=authorship_metrics,
        strength_response=strength_response,
        comparison_table=comparison_table,
        four_way=four_way,
        dc_regressions=dc_regressions,
        season_metrics=season_metrics,
        foul_origin=foul_origin,
        failures=failures,
    )
    write_report_json(report, out_dir)
    with open(out_dir / "report.md", "w", encoding="utf-8") as f:
        f.write(render_markdown(report))
    return report
