"""Runs the actual Monte Carlo: dispatches match/season requests across a pool of persistent
engine worker processes (one `EngineAdapter`/`vite-node` subprocess per Python worker — see
`_init_worker`), streams results into summary rows + event rows (events.py), and separates the
cheap per-match invariant check (metrics.check_match_invariants) from the expensive full trace,
which is only kept for a stratified sample and for failing matches (SRS "não persista o trace
completo... guarde traces de uma amostra estratificada e das falhas").

Also implements the adaptive-stopping rule for the `nightly`/`release` profiles: after every
`check_every_matches` matches, checks whether e = z*sqrt(p(1-p)/n) is already under the target
margin for every metric marked as required — if so, stops early instead of burning the full
budget.
"""

from __future__ import annotations

import math
import multiprocessing as mp
import os
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from .engine_adapter import EngineAdapter, EngineError
from .events import build_player_index, flatten_match_record, match_event_rows
from .fixtures import FixtureSpec
from .metrics import check_match_invariants
from .seed_bank import SeedBank

_WORKER_ADAPTER: Optional[EngineAdapter] = None


def _init_worker() -> None:
    global _WORKER_ADAPTER
    _WORKER_ADAPTER = EngineAdapter()
    _WORKER_ADAPTER.start()


def _run_match_job(job: dict) -> dict:
    assert _WORKER_ADAPTER is not None, "worker not initialized — _init_worker must run first"
    request = job["request"]
    try:
        data = _WORKER_ADAPTER.run_match(**request)
        return {"ok": True, "stratum": job["stratum"], "data": data}
    except EngineError as exc:
        return {"ok": False, "stratum": job["stratum"], "request": request, "error": str(exc)}


def _run_season_job(job: dict) -> dict:
    assert _WORKER_ADAPTER is not None, "worker not initialized — _init_worker must run first"
    request = job["request"]
    try:
        data = _WORKER_ADAPTER.run_season(**request)
        return {"ok": True, "data": data}
    except EngineError as exc:
        return {"ok": False, "request": request, "error": str(exc)}


@dataclass
class MatchBenchmarkResult:
    summary_rows: list[dict] = field(default_factory=list)
    event_rows: list[dict] = field(default_factory=list)
    trace_records: list[dict] = field(default_factory=list)
    failures: list[dict] = field(default_factory=list)
    n_matches: int = 0
    elapsed_s: float = 0.0
    stopped_early: bool = False


@dataclass
class SeasonBenchmarkResult:
    records: list[dict] = field(default_factory=list)
    failures: list[dict] = field(default_factory=list)
    elapsed_s: float = 0.0


def _select_trace_reps(fixtures: list[FixtureSpec], trace_sample_per_stratum: int) -> set[tuple[str, int]]:
    """Picks replication index 0 of the first `trace_sample_per_stratum` fixtures seen per
    stratum — small, deterministic, stratified sample; never "trace everything"."""
    if trace_sample_per_stratum <= 0:
        return set()
    chosen: set[tuple[str, int]] = set()
    seen_per_stratum: dict[str, int] = {}
    for fixture in fixtures:
        seen = seen_per_stratum.get(fixture.stratum, 0)
        if seen < trace_sample_per_stratum:
            chosen.add((fixture.fixture_id, 0))
            seen_per_stratum[fixture.stratum] = seen + 1
    return chosen


def _build_match_jobs(
    fixtures: list[FixtureSpec],
    bank: SeedBank,
    replications_per_fixture: int,
    world_seed: int,
    tactical_intensity: str,
    params: Optional[dict[str, float]],
    trace_reps: set[tuple[str, int]],
) -> list[dict]:
    jobs = []
    for fixture in fixtures:
        seeds = bank.stream(fixture.fixture_id, replications_per_fixture)
        for i, seed in enumerate(seeds):
            request: dict[str, Any] = dict(
                run_id=f"{fixture.fixture_id}::{i}",
                fixture_id=fixture.fixture_id,
                seed=int(seed),
                world_seed=world_seed,
                home_club_id=fixture.home_club_id,
                away_club_id=fixture.away_club_id,
                home_formation=fixture.home_formation,
                home_style=fixture.home_style,
                away_formation=fixture.away_formation,
                away_style=fixture.away_style,
                tactical_intensity=tactical_intensity,
                trace=(fixture.fixture_id, i) in trace_reps,
            )
            if fixture.substitutions:
                request["substitutions"] = fixture.substitutions
            if params:
                request["params"] = params
            jobs.append({"stratum": fixture.stratum, "request": request})
    return jobs


def _adaptive_satisfied(rows: list[dict], adaptive: Optional[dict]) -> bool:
    if not adaptive or not adaptive.get("enabled") or not rows:
        return False
    n = len(rows)
    if n < 30:
        return False
    z = adaptive.get("z", 1.96)
    target = adaptive.get("target_margin_pp", 1.0) / 100.0
    home_wins = sum(1 for r in rows if r["home_goals"] > r["away_goals"])
    draws = sum(1 for r in rows if r["home_goals"] == r["away_goals"])
    away_wins = n - home_wins - draws
    proportions = {"home_win_rate": home_wins / n, "draw_rate": draws / n, "away_win_rate": away_wins / n}
    for name in adaptive.get("metrics", []):
        p = proportions.get(name)
        if p is None:
            continue
        p = min(max(p, 1e-6), 1 - 1e-6)
        margin = z * math.sqrt(p * (1 - p) / n)
        if margin > target:
            return False
    return True


def run_match_benchmark(
    fixtures: list[FixtureSpec],
    bank: SeedBank,
    *,
    replications_per_fixture: int,
    world_seed: int,
    tactical_intensity: str,
    params: Optional[dict[str, float]] = None,
    trace_sample_per_stratum: int = 1,
    n_workers: Optional[int] = None,
    adaptive: Optional[dict] = None,
    progress_cb: Optional[Callable[[int, int], None]] = None,
) -> MatchBenchmarkResult:
    n_workers = n_workers or max(1, (os.cpu_count() or 2) - 1)
    trace_reps = _select_trace_reps(fixtures, trace_sample_per_stratum)
    jobs = _build_match_jobs(fixtures, bank, replications_per_fixture, world_seed, tactical_intensity, params, trace_reps)

    with EngineAdapter() as bootstrap:
        player_index = build_player_index(bootstrap.world_players(world_seed=world_seed))

    result = MatchBenchmarkResult()
    started = time.monotonic()
    check_every = (adaptive or {}).get("check_every_matches") if adaptive and adaptive.get("enabled") else None

    def handle(response: dict) -> None:
        if not response["ok"]:
            result.failures.append(
                {"stratum": response["stratum"], "request": response["request"], "error": response["error"]}
            )
            return
        data, stratum = response["data"], response["stratum"]
        problems = check_match_invariants(data)
        if problems:
            result.failures.append(
                {
                    "stratum": stratum,
                    "fixture_id": data.get("fixture_id"),
                    "seed": data.get("seed"),
                    "run_id": data.get("run_id"),
                    "problems": problems,
                }
            )
        result.summary_rows.append(flatten_match_record(data, stratum=stratum))
        result.event_rows.extend(match_event_rows(data, player_index, stratum=stratum))
        if data.get("trace"):
            result.trace_records.append(data)

    with mp.Pool(processes=n_workers, initializer=_init_worker) as pool:
        for i, response in enumerate(pool.imap_unordered(_run_match_job, jobs, chunksize=8), start=1):
            handle(response)
            if progress_cb and i % 200 == 0:
                progress_cb(i, len(jobs))
            if check_every and i % check_every == 0 and _adaptive_satisfied(result.summary_rows, adaptive):
                result.stopped_early = True
                pool.terminate()
                break

    result.n_matches = len(result.summary_rows)
    result.elapsed_s = time.monotonic() - started
    return result


def run_season_benchmark(
    bank: SeedBank,
    *,
    n_seasons: int,
    tactical_intensity: str,
    params: Optional[dict[str, float]] = None,
    full_season: bool = True,
    n_workers: Optional[int] = None,
    progress_cb: Optional[Callable[[int, int], None]] = None,
) -> SeasonBenchmarkResult:
    """One seed drives BOTH the roster (generateWorld) and every match's RNG for that season
    replicate — that's the engine's existing design (createBrasileiraoCareer(seed, ...) reuses
    `seed` for both), not something this function layers on top. There is intentionally no
    separate `world_seed` parameter here."""
    if n_seasons <= 0:
        return SeasonBenchmarkResult()

    n_workers = n_workers or max(1, (os.cpu_count() or 2) - 1)
    seeds = bank.stream("season", n_seasons)
    jobs = []
    for i, seed in enumerate(seeds):
        request: dict[str, Any] = dict(
            run_id=f"season::{i}", seed=int(seed), tactical_intensity=tactical_intensity, full_season=full_season
        )
        if params:
            request["params"] = params
        jobs.append({"request": request})

    result = SeasonBenchmarkResult()
    started = time.monotonic()
    with mp.Pool(processes=min(n_workers, max(1, n_seasons)), initializer=_init_worker) as pool:
        for i, response in enumerate(pool.imap_unordered(_run_season_job, jobs, chunksize=1), start=1):
            if response["ok"]:
                result.records.append(response["data"])
            else:
                result.failures.append(response)
            if progress_cb:
                progress_cb(i, len(jobs))

    result.elapsed_s = time.monotonic() - started
    return result
