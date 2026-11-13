/**
 * The terminal's "safe filter", risk label and plain-language checks. Pure functions, no I/O, so
 * the rules are unit-tested and the feed endpoint is the only place that applies them (the
 * frontend never re-derives a risk label).
 *
 * Wording rule: never call anything "safe". The labels are "fewer red flags" / "some" / "many".
 */

export const FILTERS = {
  minVolumeUsd: 500,
  minHolders: 12,
  maxBundlerPct: 20,
  maxDevPct: 15,
} as const;

/** A locked LP is treated as burned/locked at or above this share of LP tokens. */
export const LP_LOCKED_MIN_PCT = 95;

export type RiskLevel = 'low' | 'med' | 'high';
export type StageKey = 'new' | 'final' | 'grad';
export type CheckStatus = 'good' | 'warn' | 'bad';

export interface TokenMetrics {
  status: 'launchpad' | 'migrated';
  curveProgress: number | null;
  volume24hUsd: number | null;
  holders: number | null;
  bundlerPct: number | null;
  devPct: number | null;
  lpBurnPct: number | null;
  dexPaid: boolean;
  mintAuthorityActive: boolean | null;
  freezeAuthorityActive: boolean | null;
  rugged: boolean | null;
}

export interface Check {
  status: CheckStatus;
  title: string;
  why: string;
}

export function liquidityLocked(t: TokenMetrics): boolean {
  return (t.lpBurnPct ?? 0) >= LP_LOCKED_MIN_PCT;
}

/** Why a coin is hidden by the safe filter, or null if it passes. Unknown numbers fail. */
export function failReason(t: TokenMetrics): string | null {
  if (t.rugged === true) return 'rugged';
  if (t.mintAuthorityActive === true) return 'mint authority active';
  if (t.freezeAuthorityActive === true) return 'freeze authority active';
  if (t.volume24hUsd == null || t.holders == null || t.bundlerPct == null || t.devPct == null) return 'metrics not available yet';
  if (t.volume24hUsd < FILTERS.minVolumeUsd) return 'low volume';
  if (t.holders < FILTERS.minHolders) return 'too few holders';
  if (t.bundlerPct > FILTERS.maxBundlerPct) return 'too much bundled';
  if (t.devPct > FILTERS.maxDevPct) return 'creator holds too much';
  return null;
}

export function passesFilters(t: TokenMetrics): boolean {
  return failReason(t) === null;
}

export function riskLevel(t: TokenMetrics): RiskLevel {
  if (!passesFilters(t)) return 'high';
  const bundle = t.bundlerPct as number;
  const dev = t.devPct as number;
  const holders = t.holders as number;
  const safety = liquidityLocked(t) || t.dexPaid;
  const score =
    (bundle >= 15 ? 2 : bundle >= 10 ? 1 : 0) +
    (dev >= 10 ? 2 : dev >= 5 ? 1 : 0) +
    (safety ? 0 : 1) +
    (holders < 200 ? 1 : 0);
  if (safety && score <= 1) return 'low';
  return score >= 3 ? 'high' : 'med';
}

export function stageOf(t: Pick<TokenMetrics, 'status' | 'curveProgress'>): { key: StageKey; percent: number } {
  if (t.status === 'migrated') return { key: 'grad', percent: 100 };
  const p = Math.min(0.99, Math.max(0, t.curveProgress ?? 0));
  return { key: p >= 0.5 ? 'final' : 'new', percent: Math.max(2, Math.round(p * 100)) };
}

const usd = (n: number): string => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`);

/** The "what we checked" list on the coin page. Metrics that are unknown show as a warning. */
export function buildChecks(t: TokenMetrics): Check[] {
  const status = (good: boolean, mid: boolean): CheckStatus => (good ? 'good' : mid ? 'warn' : 'bad');
  const out: Check[] = [];

  if (t.bundlerPct == null) {
    out.push({ status: 'warn', title: 'Launch buying unknown', why: 'We could not measure how much was bought by linked wallets at launch.' });
  } else {
    out.push({
      status: status(t.bundlerPct < 10, t.bundlerPct <= FILTERS.maxBundlerPct),
      title: `${t.bundlerPct.toFixed(0)}% grabbed at launch`,
      why: 'Wallets working together bought this much in the first second. If they sell together, the price falls hard.',
    });
  }

  if (t.devPct == null) {
    out.push({ status: 'warn', title: 'Creator share unknown', why: 'We could not measure how much the creator still holds.' });
  } else {
    out.push({
      status: status(t.devPct < 5, t.devPct <= FILTERS.maxDevPct),
      title: `Creator holds ${t.devPct.toFixed(0)}%`,
      why: t.devPct <= FILTERS.maxDevPct ? "Small enough that the creator can't crash it alone." : 'The creator could sell and crash the price on their own.',
    });
  }

  const locked = liquidityLocked(t);
  out.push({
    status: locked ? 'good' : 'warn',
    title: locked ? 'Liquidity locked' : 'Liquidity not locked',
    why: locked ? "The money pool that makes trading possible can't be pulled out by the creator." : 'The creator could pull the money pool. This is the classic rug.',
  });

  out.push({
    status: t.dexPaid ? 'good' : 'warn',
    title: t.dexPaid ? 'Dex paid' : 'Dex not paid',
    why: t.dexPaid ? 'The team paid for a proper listing page. A small sign they plan to stay.' : 'No paid listing yet. Common for very new coins.',
  });

  if (t.holders == null) {
    out.push({ status: 'warn', title: 'Holders unknown', why: 'We could not count the holders yet.' });
  } else {
    out.push({
      status: status(t.holders >= 200, t.holders >= FILTERS.minHolders),
      title: `${t.holders.toLocaleString('en-US')} holders`,
      why: t.holders >= FILTERS.minHolders ? 'Real people own it, not just the creator.' : 'Almost nobody holds it besides the creator.',
    });
  }

  if (t.volume24hUsd == null) {
    out.push({ status: 'warn', title: 'Volume unknown', why: 'We could not read the trading volume yet.' });
  } else {
    out.push({
      status: status(t.volume24hUsd >= 10_000, t.volume24hUsd >= FILTERS.minVolumeUsd),
      title: `${usd(t.volume24hUsd)} traded today`,
      why: t.volume24hUsd >= FILTERS.minVolumeUsd ? 'People are actually buying and selling.' : 'Barely any trading. Hard to sell if you want out.',
    });
  }

  if (t.mintAuthorityActive === true || t.freezeAuthorityActive === true) {
    out.push({
      status: 'bad',
      title: t.mintAuthorityActive ? 'Creator can print more coins' : 'Creator can freeze wallets',
      why: 'A leftover creator power. It lets them dilute holders or lock people out of selling.',
    });
  }
  if (t.rugged === true) {
    out.push({ status: 'bad', title: 'Flagged as rugged', why: 'The money pool is gone. Do not buy.' });
  }
  return out;
}

export function riskSummary(t: TokenMetrics): string {
  const reason = failReason(t);
  if (reason === 'metrics not available yet') return "We're still checking this coin. It stays hidden until the numbers are in.";
  if (reason) return 'This coin fails our basic checks. Insiders hold too much, nobody trades it, or the creator kept powers that can hurt holders. Coins like this are often rugs.';
  const level = riskLevel(t);
  const why = [liquidityLocked(t) && 'liquidity is locked', t.dexPaid && 'the Dex listing is paid'].filter(Boolean).join(' and ');
  if (level === 'low') return `Fewer warning signs than most: ${why}, and insiders hold little. This is not safe. Meme coins can still drop to zero.`;
  if (level === 'med') return `Passes our checks, but ${why ? why + ', while ' : ''}a few things need watching below. Expect big swings.`;
  return 'Passes the minimum checks, but insiders hold a lot and there is no lock or paid listing. Treat this as a lottery ticket.';
}
