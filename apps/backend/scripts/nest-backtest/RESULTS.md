# Nest attention-tilt backtest: results (updated 2026-09-21, real Elfa data)

## Status: complete. Real attention scores fetched for all 27 rebalance dates.

The Elfa key was upgraded (10M monthly cap, overage on, 15,000-credit bonus). `GET /v2/key-status`
now reports `dailyRequestLimit: 10000000, monthlyRequestLimit: 10000000, allowOverage: true`. The
backtest made 1,620 `keyword-mentions` calls (30 names x 27 dates x 2 windows), paced to ~57/min to
stay under Elfa's 60/min per-key limit, concurrency 2. First pass: 1,616 fetched, 2 windows failed
after exhausting retries (transient — not a 4xx, not a horizon limit; `earliestSuccessfulWindow`
came back as far as 2026-03-13, 7 days before the sim's first signal date, so no historical-horizon
wall was hit at this depth). Every fetched window is cached in `cache/elfa-counts.json`, so the
re-run needed only 4 fresh calls (the 2 failed windows plus, incidentally, their prior-week
counterparts) and completed in seconds with 0 failures. Coverage: 27/27 weeks fully scored.

## Numbers

Window: 2026-03-20 to 2026-09-18, 126 trading days, 27 rebalance points (26 holding weeks).
Universe: 30 names (see below, prices from Yahoo Finance, none dropped). Start $10,000. Costs
0.5% of one-way traded notional per rebalance. `HYSTERESIS_BAND = 1.5` replicated exactly from
`nest-rebalance.service.ts` (a held name keeps its seat while ranked in the top `ceil(15*1.5)=23`
of 30, not just the top 15).

| Strategy | Gross return | Net return | Ann. vol | Max drawdown | Avg weekly turnover | Total costs |
|---|---|---|---|---|---|---|
| Equal-weight, 30 names, 95% invested | +18.82% | +18.59% | 20.78% | -10.05% | 2.17% | $79 |
| Attention tilt, **no hysteresis** (pre-fix allocator) | +11.87% | +4.36% | 24.87% | -18.63% | 51.67% | $801 |
| Attention tilt **+ hysteresis** (current live allocator) | +19.21% | +15.37% | 23.57% | -11.80% | 26.52% | $439 |
| Top-15 by attention, equal-weighted (selection only, no hysteresis) | +14.11% | +7.08% | 24.66% | -18.41% | 48.83% | $754 |

**Hysteresis delta:** turnover drops from 51.7%/week to 26.5%/week (-25.2 points), costs drop from
$801 to $439 (-$362, about 3.6 points of NAV over 26 weeks), and net return goes from +4.36% to
+15.37% (+11.0 points) purely from not churning names that briefly slip out of the top 15. Gross
return also improves (+11.87% -> +19.21%), meaning hysteresis is not just cheaper here, the mean-
reversion in a 24h-mention-anomaly score means selling a name that dips one rank and buying it back
next week was actively hurting, independent of costs.

**Vs. equal-weight, net of costs:** the hysteresis tilt (+15.37%) still trails equal-weight
(+18.59%) by 3.2 points over this one window. The no-hysteresis tilt trails by 14.2 points.

### Placebo: 200 shuffles of the real attention scores across symbols, each rebalance date independently

| Variant | Real net return | Percentile of real result | Shuffled net p05 / p50 / p95 |
|---|---|---|---|
| No hysteresis | +4.36% | **16th percentile** | +0.92% / +10.53% / +23.07% |
| With hysteresis (live) | +15.37% | **59th percentile** | +4.86% / +13.70% / +25.10% |

Equal-weight's net return (+18.59%) sits at the 90th percentile of the no-hysteresis placebo
distribution and the 78th percentile of the hysteresis placebo distribution — i.e. equal-weight
beats most random-score tilts too, because both tilted variants hold cash-floor-adjusted, capped,
top-N baskets of a similar 30-name universe, and staying diversified across this period simply won
regardless of which names got the extra tilt weight.

**Reading the percentiles:** the no-hysteresis tilt's real result is *worse* than 84% of runs where
the scores were random noise — the real ranking + high turnover actively underperformed shuffling.
The hysteresis tilt's real result is at the 59th percentile of its own placebo distribution: modestly
better than a coin flip, consistent with "no detectable signal" rather than "an edge." Neither
result clears a bar you'd call evidence of alpha; the hysteresis number is statistically
indistinguishable from noise, and the no-hysteresis number's underperformance is more likely an
artifact of turnover cost + mean-reversion churn than "the signal points the wrong way."

## Universe subset (30 of the allowlist; SHOP replaced with MCD)

AAPL MSFT GOOGL AMZN META NVDA ORCL NFLX (big-tech/ai), AVGO AMD QCOM (semis), PLTR COIN HOOD MSTR
CRCL (ai/crypto-adjacent), UBER MCD RBLX WMT DIS (consumer), JPM V GS (finance), UNH LLY
(healthcare), TSLA (ev), BA CAT (industrial), XOM (energy). SHOPx was dropped from
`NEST_UNIVERSE_ALLOWLIST` since the prior run (it's not in Backed's catalog); MCD substituted to
keep the subset at 30 names and the consumer tag represented. Index ETFs SPYx/QQQx excluded on
purpose (a mention count for "S&P 500 ETF,SPY" is not comparable to a company's). No ticker was
dropped for missing prices: all 30 returned 251 daily rows from Yahoo Finance.

## Data caveats

- **Universe subset.** 30 of ~90 live names, hand-picked for liquidity and tag coverage today.
- **Survivorship.** The allowlist was curated with knowledge of which names exist, are liquid and
  are not trading-halted now; a name that blew up earlier in the window would not be in it.
- **Weekly vs daily.** The live engine rebalances daily with a 10%-of-NAV-per-tick turnover cap.
  Weekly full rebalancing to target is a different (and more expensive per trade, cheaper per
  month) process. `--turnover-cap` applies the 10% cap per weekly tick as a sensitivity; not run
  for this report — worth doing as a follow-up since it interacts with hysteresis differently.
- **Prices.** Yahoo Finance adjusted closes of the underlying US stock, not xStock token prices on
  Solana. xStocks track the underlying closely in liquid hours but the token can trade at a spread
  or stale price outside US hours, which is exactly when a daily cron may fire.
- **Signal timing.** Score is computed from mentions up to 20:00 UTC and the trade fills at that
  same day's close. Slightly optimistic; the live cron has its own lag.
- **Costs.** 0.5% round trip is an assumption for Jupiter swap + slippage on xStock pools; thin
  pools could be worse. Doubling it roughly doubles each strategy's cost drag line above.
- **Elfa horizon.** Not hit at this depth (successful windows as far back as 2026-03-13, i.e. the
  full 26-week + 7-day-baseline span needed). Whether it extends further back is untested.
- **One window, one universe.** 26 weeks and 30 names is a single draw. The placebo distribution
  (noise band of +0.9% to +25% net over this same period) is the real takeaway: it shows how wide
  the range of outcomes is even with zero real signal, which is most of why neither tilt variant's
  result should be read as proof of anything either way.
- **Stooq** serves a JavaScript proof-of-work wall instead of CSV; not used, Yahoo used instead.

## Verdict (plain English)

1. Real attention data is in, and it does not show an edge. The current live allocator (with
   hysteresis) returned +15.37% net vs equal-weight's +18.59% over the same 26 weeks — it lost by
   3.2 points, and its result sits at the 59th percentile of what 200 random-score shuffles would
   have produced, i.e. statistically unremarkable.
2. Hysteresis is doing real, measurable work as a cost fix: it cut weekly turnover roughly in half
   (51.7% -> 26.5%) and turned a -14 point performance gap into a -3 point one, mostly by not
   selling and rebuying names that bounce around the top-15/top-23 boundary from week to week.
   That's the single most impactful change available here, independent of whether the underlying
   signal has any edge.
3. Without hysteresis, the tilt actively underperformed noise (16th percentile of its own placebo
   distribution) — high turnover on a mean-reverting anomaly score was actively harmful, not just
   costly.
4. This is still one 26-week window on 30 names. The placebo band alone spans +0.9% to +25% net
   from pure noise; a real edge would need to clear that band by a wide margin to be believable,
   and neither variant did. This sample is too thin to rule an edge in or out with confidence — it
   rules out "large and obvious," nothing more.
5. Recommendation: keep hysteresis (it's a clear net positive regardless of signal quality), do not
   market the attention tilt as an outperformance mechanism based on this data, and if a real
   answer matters, extend the test to 1-2+ years and/or the full ~90-name universe before drawing
   further conclusions.
