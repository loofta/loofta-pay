# Nest attention-tilt backtest: results (2026-09-20)

## Status: the real tilt could NOT be evaluated. Elfa quota is exhausted.

The Elfa key in `.env.production.local` is on a plan with `monthlyRequestLimit: 1000`,
`dailyRequestLimit: 1000`, `allowOverage: false` (from `GET /v2/key-status`). Every
`keyword-mentions` call, including a window from yesterday, returns
`429 ERR_RATE_LIMITED "Monthly request limit exceeded and overages are disabled"`. This is the
account's monthly cap, not burst throttling: the per-minute headers showed 993/1000 remaining while
the call was refused. The key was created 2026-09-14; the live daily cron alone spends about
180 calls/day (roughly 90 universe symbols x 2 windows), so the month's 1,000 were gone in under a
week. The reset date is not exposed by the API.

Consequence: 0 of 27 weekly signal dates have attention scores. The script refuses to run the
tilt on partial coverage (it would silently degrade to equal weight for missing symbols, since the
engine treats a missing score as 0), so only the equal-weight baseline is a real number below.

This design needs 1,620 Elfa calls (30 names x 27 dates x 2 windows). It cannot fit under a
1,000/month plan while the production cron is also running. To complete it: upgrade the Elfa plan
or pause the Nest cron for the run, then re-run `run.ts`; every fetched window is cached, so the
run can be spread across days if needed.

## Numbers

Window: 2026-03-20 to 2026-09-18, 126 trading days, 27 rebalance points (26 holding weeks).
Universe: 30 names (see below). Start $10,000. Costs 0.5% of one-way traded notional.

| Strategy | Gross return | Net return | Ann. vol | Max drawdown | Avg weekly turnover | Total costs |
|---|---|---|---|---|---|---|
| Equal-weight, 30 names, 95% invested (REAL prices) | +20.18% | +19.95% | 21.65% | -9.71% | 2.22% | $80 |
| Attention tilt (live allocator) | not computed | not computed | | | | |
| Top-15 by attention, equal-weighted | not computed | not computed | | | | |

Placebo percentile of the real tilt: not computable without scores.

### What the smoke test says about the design itself (synthetic scores, NOT the real signal)

`--synthetic` feeds the identical allocator seeded random scores with the same `tanh(z/10)` shape
(z ~ N(0, 3)) so the tilt and placebo paths run end to end. Read these as properties of the
allocator plus cadence, not of Elfa data:

| Strategy (synthetic scores) | Gross | Net | Ann. vol | Max DD | Turnover/wk | Costs |
|---|---|---|---|---|---|---|
| Attention tilt | +15.67% | +8.31% | 24.10% | -14.31% | 51.8% | $788 |
| Top-15 by attention, equal-weighted | +15.25% | +8.33% | 23.94% | -14.78% | 48.3% | $744 |
| Placebo, 200 shuffles, net return | p05 +0.65% | p50 +11.57% | p95 +25.71% | | | |

Two things carry over to the real signal:

1. Turnover is dominated by the top-15-of-30 selection step, not the weight tilt (48% vs 52%).
   A 24h-vs-6-day anomaly score is mean-reverting by construction, so the set of "top 15" changes
   a lot week to week. With scores that are uncorrelated across weeks this costs ~7.4 points of
   return over 26 weeks; real scores have some persistence so real turnover should be lower, but
   it is the cost line the tilt has to clear before any edge shows.
2. Noise is enormous at this sample size. The spread of net outcomes from *meaningless* scores is
   0.65% to 25.7% (5th to 95th percentile) over one 26-week window of 30 names. A real result
   would have to land well outside that band to say anything, and a single 6-month window almost
   certainly cannot.

## Universe subset (30 of the 90-name allowlist)

AAPL MSFT GOOGL AMZN META NVDA ORCL NFLX (big-tech/ai), AVGO AMD QCOM (semis), PLTR COIN HOOD MSTR
CRCL (ai/crypto-adjacent), UBER SHOP RBLX WMT DIS (consumer), JPM V GS (finance), UNH LLY
(healthcare), TSLA (ev), BA CAT (industrial), XOM (energy). Index ETFs SPYx/QQQx excluded on purpose
(a mention count for "S&P 500 ETF,SPY" is not comparable to a company's). No ticker was dropped
for missing prices: all 30 returned 251 daily rows from Yahoo Finance.

## Data caveats

- **Universe subset.** 30 of ~90 live names, hand-picked for liquidity and tag coverage today.
- **Survivorship.** The allowlist was curated on 2026-09-15 with knowledge of which names exist,
  are liquid and are not trading-halted now; a name that blew up in April would not be in it.
- **Weekly vs daily.** The live engine rebalances daily with a 10%-of-NAV-per-tick turnover cap.
  Weekly full rebalancing to target is a different (and more expensive per trade, cheaper per
  month) process. `--turnover-cap` applies the 10% cap per weekly tick as a sensitivity.
- **Prices.** Yahoo Finance adjusted closes of the underlying US stock, not xStock token prices on
  Solana. xStocks track the underlying closely in liquid hours but the token can trade at a spread
  or stale price outside US hours, which is exactly when a daily cron may fire.
- **Signal timing.** Score is computed from mentions up to 20:00 UTC and the trade fills at that
  same day's close. Slightly optimistic; the live cron has its own lag.
- **Costs.** 0.5% round trip is an assumption for Jupiter swap + slippage on xStock pools; thin
  pools could be worse. Doubling it doubles the drag line above.
- **Elfa horizon.** Unknown. The script records the earliest window that returns data and any
  4xx "date range" errors so a horizon limit will show up in `results.json` once quota allows.
- **Stooq** now serves a JavaScript proof-of-work wall instead of CSV; not used.

## Verdict (plain English)

1. The question "does the attention tilt beat equal-weight" is unanswered: Elfa's monthly quota
   is exhausted and overages are off, so zero historical attention scores could be fetched.
2. Equal-weight over the same 30 names returned +20.2% gross / +20.0% net in the 26 weeks, with
   negligible turnover cost ($80). That is the bar.
3. The allocator's weekly top-15 rerank on an anomaly score is structurally high-turnover
   (~50%/week on synthetic scores), which at 0.5% per swap costs roughly 7 to 8 points over six
   months. The tilt would need a large, consistent gross edge just to break even.
4. With 30 names and one 26-week window, random scores alone produce net returns anywhere from
   +0.7% to +25.7%. Even with real data, this test is too thin to distinguish edge from luck; a
   credible answer needs several years or many more names, and Elfa's cost per window makes that
   expensive.
5. Until data proves otherwise, treat the attention tilt as a product feature, not an alpha source,
   and consider reducing turnover (score smoothing, a hysteresis band around the top-N cutoff,
   or the daily 10% cap) before spending on a larger Elfa plan to test it.
