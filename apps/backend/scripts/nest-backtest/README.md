# Nest attention-tilt backtest

Self-contained backtest for the Loofta Nest robo-allocator. Answers one question: does the
Elfa attention tilt in `src/modules/nest/nest-rebalance.service.ts` beat plain equal-weight after
turnover costs? See `RESULTS.md` for the answer and its caveats.

Nothing here imports app code or touches the database. `run.ts` replicates `computeTargetWeights`,
`RISK_CONFIG`, `SENTIMENT_TILT_STRENGTH`, `MIN_USER_TRADE_USD` and the Elfa z-score line for line,
and cross-checks its 30-name universe subset against `NEST_UNIVERSE_ALLOWLIST` in
`xstocks.service.ts` at startup (it parses the source file, so a renamed ticker fails loudly).

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
  never refetch a cached window. Empty until Elfa quota is available (see RESULTS.md).
- `results/results.json` - real-mode output (currently equal-weight baseline only).
- `results/results-synthetic.json` - smoke-test output with seeded fake scores. Not evidence of
  anything about the real signal; it exists to prove the tilt/placebo code paths run.

## Design

- Tier `balanced`, no interest tags, $10,000 start, weekly rebalance (last trading day of each ISO
  week), 26 holding weeks, full rebalance to `computeTargetWeights` targets (sells before buys,
  buys clamped to cash, trades under $2 skipped, exactly like the engine).
- Attention score at each rebalance date `t` (20:00 UTC = US close): Elfa `keyword-mentions`
  `metadata.total` for `[t-1d, t)` vs `[t-7d, t-1d)`, `z = (recent - baseline/6) / sqrt(max(baseline/6, 0.5))`,
  `score = tanh(z/10)`. Two calls per (symbol, week): 30 x 27 x 2 = 1,620 calls.
- Elfa client: concurrency 2, backs off on 429/5xx using `retry-after` / `ratelimit-reset`, aborts
  immediately on the "Monthly request limit exceeded" body, records per-window 4xx errors and the
  earliest successful window so a history horizon would be visible in `results.json`.
- Costs: 0.5% of one-way traded notional per rebalance (a sell-A/buy-B swap costs 0.5% of the
  notional moved, i.e. a round trip). Reported gross and net.
- Benchmarks: equal-weight across all 30 names at 95% invested (same cash floor as the tier);
  "top-15 by attention, equal-weighted" to separate selection from sizing.
- Placebo: 200 runs with the score vector shuffled across symbols independently at each rebalance
  date, seeded. Reports where the real tilt's net return lands in that distribution.
