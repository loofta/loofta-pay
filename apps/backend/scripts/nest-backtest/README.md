# Nest attention-tilt backtest

Self-contained backtest for the Loofta Nest robo-allocator. Answers one question: does the
Elfa attention tilt in `src/modules/nest/nest-rebalance.service.ts` beat plain equal-weight after
turnover costs? See `RESULTS.md` for the answer and its caveats.

Nothing here imports app code or touches the database. `run.ts` replicates `computeTargetWeights`,
`RISK_CONFIG`, `SENTIMENT_TILT_STRENGTH`, `MIN_USER_TRADE_USD`, `HYSTERESIS_BAND` and the Elfa
z-score line for line, and cross-checks its 30-name universe subset against
`NEST_UNIVERSE_ALLOWLIST` in `xstocks.service.ts` at startup (it parses the source file, so a
renamed or removed ticker fails loudly — SHOPx was dropped from the live allowlist since the first
run and this subset now uses MCD in its place). It also writes
`src/modules/nest/backtest-summary.json`, a small committed app-servable summary of the latest
real-mode run (see that file's shape below); this is the one file this script writes outside its
own directory.

## Run

From `apps/backend`:

```
npx ts-node --transpile-only scripts/nest-backtest/run.ts                # real run
npx ts-node --transpile-only scripts/nest-backtest/run.ts --offline      # caches only
npx ts-node --transpile-only scripts/nest-backtest/run.ts --synthetic    # smoke test, fake scores
npx ts-node --transpile-only scripts/nest-backtest/run.ts --turnover-cap # also apply the live 10%/tick cap
npx ts-node --transpile-only scripts/nest-backtest/run.ts --weeks=20 --shuffles=500
```

Reads `ELFA_API_KEY` from `apps/backend/.env.production.local` (parsed directly, never printed).

## Files

- `run.ts` - the whole thing: data fetch, cache, allocator replica, simulation, placebo, report.
- `cache/prices.json` - daily adjusted closes per underlying ticker (Yahoo Finance chart API, keyless;
  Stooq is tried second but currently serves a JavaScript anti-bot wall instead of CSV).
- `cache/elfa-counts.json` - one entry per `(TICKER, from, to)` window: `metadata.total`. Re-runs
  never refetch a cached window.
- `results/results.json` - full real-mode output: both allocator variants (with/without
  hysteresis), the selection-only decomposition, both paired placebo distributions, per-week
  scores, and NAV series.
- `results/results-synthetic.json` - smoke-test output with seeded fake scores. Not evidence of
  anything about the real signal; it exists to prove the tilt/placebo/hysteresis code paths run
  before spending real Elfa calls.
- `../../src/modules/nest/backtest-summary.json` - committed app-servable summary written only in
  real mode (never from `--synthetic`): `strategy` (no hysteresis), `strategyHysteresis` (current
  live allocator), `equalWeight`, `placebo` (netReturnP05/P50/P95 + realPercentile, for the
  hysteresis variant), and `caveats`. Returns are decimals (0.1537 = +15.37%), drawdown negative.

## Design

- Tier `balanced`, no interest tags, $10,000 start, weekly rebalance (last trading day of each ISO
  week), 26 holding weeks, full rebalance to `computeTargetWeights` targets (sells before buys,
  buys clamped to cash, trades under $2 skipped, exactly like the engine).
- Attention score at each rebalance date `t` (20:00 UTC = US close): Elfa `keyword-mentions`
  `metadata.total` for `[t-1d, t)` vs `[t-7d, t-1d)`, `z = (recent - baseline/6) / sqrt(max(baseline/6, 0.5))`,
  `score = tanh(z/10)`. Two calls per (symbol, week): 30 x 27 x 2 = 1,620 calls.
- Elfa client: concurrency 2-3, a global pacer capped at ~57 requests/minute (Elfa's limit is
  60/min per key), backs off on 429/5xx using `retry-after` / `ratelimit-reset`, aborts immediately
  on a "Monthly request limit exceeded" body (still checked, but does not gate the run just because
  `key-status` shows headroom — only an actual 429 with that message stops further calls), records
  per-window 4xx errors and the earliest successful window so a history horizon would be visible in
  `results.json`. In practice Elfa served windows back to 2026-03-13 with no horizon error.
- Two allocator variants, both run every time: `computeTargetWeights(..., held=∅)` (pre-hysteresis
  behavior: pure top-N rerank every week) and `computeTargetWeights(..., held=<current positions>)`
  (current live allocator: `HYSTERESIS_BAND = 1.5`, a held name keeps its seat while ranked in the
  top `ceil(maxPositions * 1.5)`).
- Costs: 0.5% of one-way traded notional per rebalance (a sell-A/buy-B swap costs 0.5% of the
  notional moved, i.e. a round trip). Reported gross and net for both variants.
- Benchmarks: equal-weight across all 30 names at 95% invested (same cash floor as the tier);
  "top-15 by attention, equal-weighted" (no hysteresis) to separate selection from sizing.
- Placebo: 200 runs with the score vector shuffled across symbols independently at each rebalance
  date, seeded, fed through both allocator variants (paired distributions). Reports where each real
  variant's net return lands in its own shuffled distribution.
