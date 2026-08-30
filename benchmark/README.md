# footmanager benchmark

Benchmark, validation and calibration tool for footmanager's match/season simulation engine
(`src/engine/**`, TypeScript). The engine stays where it is and stays TypeScript — this is a
Python CLI that drives it over a small JSONL protocol and does all the statistics, comparison,
calibration and sensitivity analysis on the Python side.

```
benchmark run --profile smoke
benchmark run --profile nightly
benchmark compare baseline.json candidate.json
benchmark report reports/<run>/report.json
benchmark calibrate --demo
benchmark sensitivity
```

## Why this shape

The engine (`simulateMatch` in `src/engine/simulation/match.ts`) is already a pure, seeded,
deterministic function — `mulberry32(seed)`, no global `Math.random()`, no I/O. It didn't need
fixing for reproducibility; it needed a way to be *driven at scale from Python* and a way to
*have its balancing constants overridden* without touching the app. Both integration points
turned out to be small, additive changes (see "Integração com o motor" below) — everything else
lives entirely inside `benchmark/`.

`generateWorld()` (real 2026 Brasileirão rosters/clubs) uses Vite's `import.meta.glob`, so the
Node side runs under `vite-node`, not plain `node`/`tsx` — that's the one non-obvious dependency
choice here.

## Setup

The sandbox this was built in has a broken system Python (`pip`/`ensurepip` missing, no
`python3-venv` support installed, no sudo). If your machine is the same:

```bash
cd benchmark
python3 -m venv .venv
curl -sS https://bootstrap.pypa.io/get-pip.py -o /tmp/get-pip.py
.venv/bin/python3 /tmp/get-pip.py --quiet
.venv/bin/python3 -m pip install --quiet setuptools wheel
.venv/bin/python3 -m pip install --quiet -e .
```

If your machine has a normal Python install, just `python3 -m venv .venv && .venv/bin/pip install -e .`.

From the repo root, install `vite-node` (only needed once, shared with the rest of the app's
`node_modules`):

```bash
npm install --save-dev vite-node
```

Then either use `.venv/bin/benchmark <command>` directly, or `source .venv/bin/activate` first.

## Integração com o motor

**Contract.** One persistent `vite-node` subprocess (`benchmark/engine/server.ts`), started once
per Python worker process, talking JSONL over stdin/stdout — one JSON object per line in, one per
line out, strictly request-then-response (the Node handlers are synchronous, so ordering is
FIFO; no request-ID multiplexer needed). `benchmark/src/benchmark/engine_adapter.py` is the only
thing that knows this protocol exists; everything else in the package talks to
`EngineAdapter`/`simulation.run_match_benchmark`/`run_season_benchmark`.

Commands: `ping`, `config_schema`, `world_ratings`, `world_players`, `squad`, `match`, `season`.
Each match/season response carries `run_id`, `seed`, `world_seed`, `engine_version` (package
version + git short SHA, `-dirty` suffix if the tree has uncommitted changes),
`config_hash` (sha256 of the current calibratable-parameter values, see below), `fixture_id`,
both teams' sector ratings (attack/defense/midfield, from the same `EngineTraceEntry` the live UI
uses for its "modo geek"), final score, the full `MatchEvent[]` (goals/cards/subs — always
present, cheap), aggregate `stats` (possession/shots/shotsOnTarget/fouls), `man_of_the_match`,
and `duration_ms`. A match is reproducible by **engine_version + config_hash + fixture + seed** —
verified in `tests/test_determinism.py`.

**The one engine-side change.** `src/engine/simulation/config.ts`'s tunable scalar constants
(`HOME_ADVANTAGE`, `BASE_GOAL_PROBABILITY`, `BASE_FOULS_PER_TEAM`, `FOUL_CARD_BASE.yellow`, ...
26 in total) went from `export const` to `export let`, plus three new functions at the bottom of
the file: `applyEngineParamOverrides(overrides)`, `resetEngineParams()`, `currentEngineParams()`.
Nothing else in the file changed, nothing else in the app calls these functions, so behavior is
byte-identical unless the benchmark explicitly overrides something — confirmed by running the
full `npm run test` suite (94/94 still pass) and `tsc -b` (clean) after the change. This is what
makes `benchmark compare`/`calibrate`/`sensitivity` possible without hand-maintaining a parallel
config system. See `ENGINE_PARAM_NAMES` in `config.ts` for the exact list, mirrored in
`configs/parameters.yaml` with search bounds.

**Full-season Monte Carlo needed *zero* engine changes.** `createBrasileiraoCareer(seed, trainer,
playerClubId, tacticalIntensity)` + `advanceCalendar(state, input)` already simulate an entire
season end to end; feeding a `playerClubId` that matches no real club means the "player's match"
branch is never taken, so `advanceCalendar` treats the whole 38-round calendar as CPU vs CPU and
resolves it in one call. `server.ts`'s `season` command uses exactly that, plus
`generateNextSeason` for a clean from-round-1 replicate (the default `full_season: true`) as
opposed to `createBrasileiraoCareer`'s built-in behavior of anchoring on the real 2026 mid-season
snapshot (`full_season: false` — useful for "predict the rest of this season" checks, covers
fewer rounds).

**Reproducing a specific match/season for debugging:**

```python
from benchmark.engine_adapter import EngineAdapter
with EngineAdapter() as e:
    record = e.run_match(seed=12345, world_seed=2026, home_club_id="flamengo", away_club_id="vasco", trace=True)
```

`trace=True` additionally returns the full `onChance` trace (minute-by-minute possession/energy,
every chance's quality/goalProbability, every foul's fouler/zone/card) — expensive, so the
benchmark only requests it for a small stratified sample and for failing matches, never for a
whole Monte Carlo run (see `simulation._select_trace_reps`).

## Architecture

```
benchmark/
  pyproject.toml
  engine/
    server.ts          # the one thing that talks to src/engine directly
  src/benchmark/
    cli.py              # run / compare / report / calibrate / sensitivity
    engine_adapter.py    # Python <-> vite-node JSONL bridge
    fixtures.py           # stratified fixture bank (strong/weak, derbies, formations, subs...)
    seed_bank.py            # search vs validation seed streams (SeedSequence-derived)
    simulation.py             # multiprocess Monte Carlo runner + adaptive stopping
    events.py                  # match/season record -> flat row schemas, JSONL/Parquet I/O
    metrics.py                   # goals/discipline/authorship/season metrics + invariant checks
    statistics.py                 # bootstrap (BCa), chi2, JS, Wasserstein, Brier/RPS, equivalence gate
    dixon_coles.py                 # penaltyblog wrapper
    comparison.py                   # real x DC x engine x candidate tables
    reporting.py                     # report.json/.md, metrics.csv/.parquet, failures.jsonl
    calibration.py                    # Optuna search + composite loss
    sensitivity.py                     # SALib Morris -> Sobol
  configs/
    fixtures.yaml    metrics.yaml    parameters.yaml    targets.yaml    profiles.yaml
  snapshots/
    fixtures_bank.json (generated)   real/ (see its own README)
  tests/
  reports/            # gitignored — one timestamped dir per `run`/`compare`/`calibrate`/`sensitivity`
```

`configs/profiles.yaml` isn't in the SRS's literal file list but is the natural place for the
smoke/nightly/calibration/release knobs (replications per fixture, trace sample size, adaptive
stopping target) — small addition, same spirit as the rest.

## Commands

### `benchmark run --profile {smoke,nightly,calibration,release}`

Runs the Monte Carlo match benchmark over the stratified fixture bank (building it from
`world_ratings` on first use — `--rebuild-fixtures` to force a refresh) plus a season Monte Carlo,
checks invariants on every match, compares against the real snapshot / Dixon-Coles / itself, and
writes a full report. `smoke` ≈700 matches + 3 seasons in ~13s on this machine; `nightly` targets
50k-200k matches with adaptive stopping (stops early once every tracked proportion's 95% CI is
under `target_margin_pp`, checked every `check_every_matches`).

### `benchmark compare baseline.json candidate.json [--profile calibration]`

Runs two parameter sets on the **same fixtures and seeds** (common random numbers) and reports a
paired diff per metric with a proper CI — far tighter than comparing two independent runs. Pass a
nonexistent path as `baseline.json` to compare against engine defaults.

### `benchmark report report.json`

Re-renders `report.md` from an existing `report.json` to stdout.

### `benchmark calibrate [--demo|--full] [--n-trials N]`

Optuna (TPE) search over `configs/parameters.yaml`'s space (`--demo`: the 3-parameter
`demo_subset`; `--full`: all 26). Every trial evaluates against the **search** seed bank, frozen
before the study starts. The loss is the SRS's formula: per objective-group (result/score,
discipline) sum of `weight * huber((sim-real)/tolerance)`, plus a Jensen-Shannon term on the goal
distribution — objective groups are kept separate in the output specifically so a big
goals-per-match improvement can't hide a discipline regression (this is exactly what the demo run
below caught). After the search, the best trial is **reevaluated against the validation seed bank**
(never touched during search) and the **holdout season** of the real snapshot, and everything is
written to `parameters.json` — old params, candidate params, per-metric diff, search loss,
validation comparison, holdout comparison. **Nothing is written back to
`src/engine/simulation/config.ts`** — applying a candidate is a deliberate, separate, human step.

### `benchmark sensitivity [--demo-space|--full-space]`

Morris screening (cheap, many parameters) followed by Sobol (expensive, only on the parameters
Morris found influential) — writes a parameter × metric matrix (`S1`/`ST` for Sobol, `mu_star` for
Morris-only params) to `sensitivity.json`.

## Amostra estratificada x representativa

Two different `sim_df`s get used for two different purposes, and conflating them gives a wrong
answer:

- **Stratified fixture bank** (`fixtures.py`) deliberately *over-samples* extreme strength gaps,
  derbies, and formation/style variety — exactly what you want for invariant testing, calibration
  search coverage, and per-stratum diagnosis ("does the deviation come from strong-vs-weak
  matchups specifically?"). Its raw aggregate averages (e.g. mean goals/game across the bank) are
  **not** representative of real competitive balance — a bank that's 1/3 "strong home vs weak
  away" fixtures will always average more goals than a real league table.
- **Season Monte Carlo** (`run_season_benchmark`, via `events.season_records_to_summary_df`) uses
  the real 20-club calendar's actual competitive balance — this is the "representative" sample,
  and it's what `benchmark run`'s real-vs-DC-vs-engine comparison is built from.

`benchmark run`'s report makes this distinction: strata-level tables come from the fixture bank,
the headline real-vs-DC-vs-engine table comes from the season Monte Carlo.

## Métricas e tolerâncias

`configs/metrics.yaml` lists `required_metrics` (part of the calibration loss and the pass/fail
gate) vs `informational_metrics`, plus the frozen score bins (`0,1,2,3,4,5+` — never change these
mid-search, they're part of what makes a JS-divergence comparison stable) and objective-group
weights. `configs/targets.yaml` holds the actual tolerance numbers (goals/game ±0.25,
win/draw/loss rate ±0.04pp, fouls/game ±3, yellow cards/game ±1, ...) — same units as the metric,
chosen to be "a real person wouldn't notice this size of difference in play-testing", not derived
from the (synthetic) demo snapshot's own noise.

**Equivalence gate**: `IC95%(sim - real) ⊆ [-tolerance, +tolerance]` → `pass`; CI entirely outside
→ `fail`; CI straddling the tolerance boundary → `inconclusive`. Never "p > 0.05" — see
`statistics.py`'s docstring for why (a large enough Monte Carlo sample makes any nonzero
difference "significant" regardless of practical size).

**Decomposition, not verdicts.** `goals/90 = shots/90 × conversão`: `metrics.authorship_metrics`
computes shots-by-position (from `goal`/`shot_saved`/`shot_missed` events, all of which carry the
shooter's `playerId` — no trace needed) and conversion separately, so a report can say *where* an
excess comes from. `cartões/90 = faltas/90 × cartões-por-falta` needs `metrics.foul_origin_metrics`,
which — unlike the goals decomposition — genuinely does require a traced sample, because fouls
aren't `MatchEvent`s (only visible via the `onChance` `'foul'` trace entries with
`foulerId`/`zone`/`card`).

## Dixon-Coles baseline

`dixon_coles.py` wraps `penaltyblog.models.DixonColesGoalModel` (verified working in this
project's venv, including a workaround for a read-only-buffer bug when feeding it a raw pandas
`.to_numpy()` view). Produces per-team attack/defence, home advantage, `rho` (low-score
dependence correction), and per-fixture expected goals / 1X2 probabilities /
score matrix. It's fit only on `configs/targets.yaml`'s `fit_seasons` and never sees
`holdout_seasons` — see `comparison.split_fit_holdout`. `comparison.flag_dc_regressions` marks any
metric where the engine is further from real than Dixon-Coles is (SRS: "se o motor ficar
estatisticamente pior que o Dixon-Coles, marque a métrica como regressão").

## Dados reais

**The real-data snapshot currently checked in is synthetic**, not real Brasileirão results — see
`snapshots/real/README.md` for exactly why (no network access to a licensed source in this build
environment, and live scraping is explicitly out of scope) and exactly how to swap in a real one
(same CSV schema: `season,round,date,home_team,away_team,home_goals,away_goals`, club IDs matching
`src/data/brasileirao-2026/*.json`). Every report prints a banner when the synthetic flag is set
(`reporting.REAL_DATA_IS_SYNTHETIC`). Treat every "pass"/"fail" against real data in this repo's
example reports as a pipeline demonstration, not a balancing verdict.

## Evidência dos comandos executados

All of these were run against this branch (`engine_version=0.0.0+a054b3f-dirty`) during
development; timestamped output directories are under `benchmark/reports/` (gitignored, but
reproducible by rerunning the same command):

```
$ benchmark run --profile smoke --n-workers 6
[run] profile=smoke fixtures=46 seed_bank=search (root_seed=13087766107565963793)
[run] 690 matches in 2.2s, 0 failures
[run] simulating 3 full seasons...
[run] report written to reports/smoke-20260829-182747
[run] metrics: 0 pass / 5 fail / 7 inconclusive
  (5 fail entries are goals/clean-sheets vs the SYNTHETIC demo snapshot — see above; 0 invariant failures)

$ benchmark compare /tmp/nonexistent.json /tmp/candidate.json --n-workers 6
  (defaults vs {BASE_GOAL_PROBABILITY: 0.26, HOME_ADVANTAGE: 1.10}, common random numbers)
  goals_per_match  4.4641 -> 3.7143  (diff=-0.7498, CI=[-0.7801,-0.7193])  [fail vs tol=0.25 — real effect, correctly detected]
  home_win_rate    0.4355 -> 0.4447  (diff=+0.0092, CI=[-0.0014,+0.0199]) [pass]
  fouls_per_match  24.62  -> 24.65   (diff=+0.0250, CI=[-0.0262,+0.0746]) [pass — untouched param, correctly inert]

$ benchmark calibrate --n-trials 5 --demo --n-workers 6
[calibrate] best trial #3: loss=13.15 params={BASE_GOAL_PROBABILITY: 0.284, BASE_FOULS_PER_TEAM: 11.92, HOME_ADVANTAGE: 1.079}
[calibrate] reevaluating best candidate against VALIDATION seeds...
  goals_per_match          4.475 -> 4.155  [fail, but improved]
  fouls_per_match          24.64 -> 39.15  [fail — REGRESSED]
  yellow_cards_per_match   4.60  -> 7.34   [fail — REGRESSED]
  (demonstrates exactly the failure mode the SRS warns about: the search loss under-weighted
   discipline relative to goals, and the validation reevaluation caught it — this is why
   objective groups are kept separate and why validation reevaluation exists as a stage)

$ benchmark sensitivity --n-trajectories 4 --n-base-samples 8 --n-workers 6
  Morris:  goals_per_match         -> BASE_GOAL_PROBABILITY dominates (mu_star=4.56 vs 0.15/0.08)
           yellow_cards_per_match  -> BASE_FOULS_PER_TEAM dominates (mu_star=6.30 vs 0.03/0.03)
           home_win_rate           -> all three comparably influential
  Sobol:   goals_per_match         -> BASE_GOAL_PROBABILITY ST=0.968
           yellow_cards_per_match  -> BASE_FOULS_PER_TEAM ST=0.533
           home_win_rate           -> BASE_GOAL_PROBABILITY ST=0.605, HOME_ADVANTAGE ST=0.440

$ benchmark run --profile nightly --n-workers 12
[run] profile=nightly fixtures=46 seed_bank=search (root_seed=13087766107565963793)
[run] 10000 matches in 7.4s, 0 failures (adaptive stop)
  (budget was ~55k matches; adaptive stopping — e=z*sqrt(p(1-p)/n) under target_margin_pp=1.0 for
   home/draw/away win rate — kicked in at the first check past 10k matches, well before the full
   budget, and correctly saved ~80% of the planned run)
[run] simulating 40 full seasons...
[run] report written to reports/nightly-20260829-191429

$ pytest -q          # 38 passed (statistics, seed bank, adaptive-stop rule, determinism, Hypothesis properties)
$ npm run test        # 94 passed (engine's own vitest suite, unaffected by the config.ts change)
$ tsc -b --noEmit      # clean
$ tsc --noEmit -p benchmark/engine/tsconfig.json   # clean
```

## Limitações abertas

- **`release` profile not run at full scale.** `smoke`, `nightly` (adaptive-stopped at 10k of a
  ~55k budget — see evidence above), `compare`, `calibrate --demo`, and `sensitivity` were all run
  for real during development; `release` (validation seeds, ~100k-match budget) was exercised only
  through its two building blocks — `calibrate`'s validation-bank reevaluation step and the
  `nightly` adaptive-stop mechanism — not as a full end-to-end `benchmark run --profile release`,
  for build-time reasons. The code path is identical to `nightly`'s (same `run_match_benchmark`,
  different seed bank/budget/margin), so this is a scale gap, not an untested code path.
- **Real data is synthetic.** See "Dados reais" above — the single biggest caveat. Every
  pass/fail against "real data" in this repo's example output is a pipeline demonstration.
- **No discipline target.** The synthetic snapshot has no fouls/cards columns (a real licensed
  source would), so `fouls_per_match`/`yellow_cards_per_match`/`red_cards_per_match` show
  `no_target` in `compare_metrics_table` against real data (they still work fine for
  config-vs-config `compare`/`calibrate`, which don't need a real target).
- **Foul-origin-by-position needs trace.** `MatchEvent` doesn't carry fouls (only cards/goals/
  subs); attributing a foul to a position requires `trace=True`, so `foul_origin_metrics` only
  ever sees the small stratified trace sample, never the full Monte Carlo run.
- **Assists don't exist in the engine.** `Player.seasonStats.assists` is a dead field (tracked in
  the codebase's own memory of prior work) — `authorship_metrics` reports this explicitly rather
  than fabricating a number.
- **Special match-states aren't scriptable beyond substitutions.** `simulateMatch` takes a seed
  and a `substitutions` list, not "start already down a goal" or "start with a man sent off" — the
  fixture bank's `substitution_scenario` stratum exercises the one state the engine's API
  actually supports; expulsion/adverse-scoreline starts would need an engine-side change this
  project deliberately avoided (SRS: smallest possible engine change).
  `MAX_SUBSTITUTIONS_PER_TEAM` also isn't enforced inside `simulateMatch` itself (it's presumably
  enforced by the lineup UI before calling it) — the benchmark doesn't test a limit the function
  itself doesn't guarantee.
- **Only 26 of config.ts's ~40 constants are calibratable.** Position-level tables
  (`POSITION_FOUL_WEIGHT`, `POSITION_FOUL_ZONE`, full `STYLE_MODIFIERS` per style) aren't wired
  into `applyEngineParamOverrides` yet — the registry (`PARAM_ACCESSORS` in `config.ts`) is
  designed to make adding more a mechanical one-line-per-field addition, not a redesign.
  `STYLE_FOUL_MODIFIERS` (7 styles) IS covered, as a deliberately-chosen slice matching the SRS's
  "agressividade → faltas → cartões" example.
  - Only scalar/leaf params are supported; nothing conditional/categorical (e.g. "which formation
    gets a bonus") is exposed to Optuna yet.
- **Sobol/Morris sample counts in the example run are demonstration-scale** (`n_trajectories=4`,
  `n_base_samples=8`) — real analysis needs far more (SALib's own guidance: Sobol total-effect
  indices stabilize around N·(k+2) ≳ few hundred to thousand evaluations for k~3-10 parameters);
  scale `--n-trajectories`/`--n-base-samples` up along with `replications_per_fixture` for a
  trustworthy result, budget permitting.
- **No pyABC/ABC-SMC.** Deliberately out of scope for this cycle per the SRS's own phasing
  ("trate isso como uma fase posterior").
- **`bootstrap_ci`/`two_sample_mean_diff_ci` subsample to `max_n=20_000`** before calling
  `scipy.stats.bootstrap`, to bound the O(n_resamples × n) resample-matrix memory a 100k-match
  `release` run would otherwise need. CI width barely changes past a few thousand observations, so
  this is a deliberate, documented approximation, not a bug.
- **No hard per-request timeout in `EngineAdapter.request`.** A wedged engine call blocks forever
  rather than erroring out after N seconds — acceptable for now since `simulateMatch` has no
  unbounded loops, but worth adding if this ever talks to a less-trusted engine build.
- **Chess-clock realism of `duration_ms`/`matches_per_second`** includes Python-side overhead
  (JSON encode/decode, multiprocessing dispatch) on top of the engine's actual simulate time —
  fine for capacity planning, not a pure engine benchmark.
