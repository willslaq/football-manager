# Real-data snapshots

`brasileirao_demo.csv` (+ its `.manifest.json`) is a **synthetic demo dataset**, not real observed
Brasileirão results. It exists only to exercise the benchmark's Dixon-Coles fit and the
real-vs-DC-vs-engine comparison pipeline end to end while this tool was built.

Why synthetic: the SRS requires versioned, licensed snapshots and explicitly forbids live
scraping ("o benchmark não deve depender de scraping ao vivo"). This build environment has no
network access to CBF's official data, no bundled OpenFootball Brasil export, and no
event-level source with a clear license for cards/players/positions. Rather than either quietly
skipping the "real data" comparison entirely or passing off an unlicensed scrape as production
data, `scripts/generate_demo_snapshot.py` generates a small i.i.d.-Poisson dataset (2 synthetic
seasons, 760 matches, using the real 20 club IDs and each club's `reputation` from
`src/data/brasileirao-2026/*.json` as an attack/defense proxy) calibrated to roughly the right
order of magnitude (~2.5-2.8 goals/game, ~45-47% home win rate) — enough to fit a non-degenerate
Dixon-Coles model and demonstrate every downstream step, but **not a source of truth for
balancing decisions**.

## Swapping in a real snapshot

`comparison.py` and `dixon_coles.py` only care about a CSV with these columns:

```
season, round, date (ISO 8601), home_team, away_team, home_goals, away_goals
```

`home_team`/`away_team` must use the same club IDs as `src/data/brasileirao-2026/*.json` (e.g.
`flamengo`, `sao-paulo`) — that's what ties a real result to the engine's simulated one for the
same fixture.

To wire in a real source:

1. Get match-level results with a clear license — CBF's official aggregates, an OpenFootball
   Brasil export, or an event-level provider you have explicit permission for. StatsBomb Open
   Data does **not** cover the Brasileirão — use it only to study event-schema structure or build
   auxiliary priors, never as a stand-in for real Brasileirão results.
2. Transform to the schema above; keep the transformation script alongside the output (see this
   generator for the pattern).
3. Write a manifest next to the CSV recording: `source`, `url`, `seasons`, `collected_at`,
   `license`, `transformation`, `checksum_sha256` (of the CSV), `n_matches`, `fields` — same shape
   as `brasileirao_demo.manifest.json`.
4. Split by time: earlier season(s) for Dixon-Coles fitting / calibration targets, a later season
   held out for validation, and (once available) the most recent season as a locked release
   holdout — never fit on a season you're also validating against (temporal leakage).
5. Point `configs/targets.yaml`'s `real_snapshot` at the new CSV path.

Until a real snapshot is wired in, every report produced by this tool prints a banner making clear
that the "real data" column is synthetic-demo, not production-grade — see
`reporting.py`'s `REAL_DATA_IS_SYNTHETIC` flag.
