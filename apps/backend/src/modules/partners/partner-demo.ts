import type { PublicPartner } from './partners.service';
import type { WithdrawQuote } from './partner-withdraw.service';
import { computePartnerFeeUsdc } from './partner-fee';
import { WITHDRAW_METHODS, WithdrawMethod } from './partner-withdraw-options';

/**
 * A built-in sample partner, so anyone can open the real withdraw page at `?orgId=demo` and click through it.
 * Real org ids are always `org_<hex>`, so this can never collide with a partner. Nothing here touches the
 * database or the chain: the quote is fixed data and a "withdrawal" only echoes success.
 */
export const DEMO_ORG_ID = 'demo';

export const DEMO_PARTNER: PublicPartner = {
  org_id: DEMO_ORG_ID,
  name: 'Rally',
  description: 'Demo campaign. Nothing on this page moves real money.',
  logo_url: null,
  brand_color: '#ff7a2a',
  withdraw_min_usd: 1,
  fee_fixed_usd: 0.25,
  fee_percent_bps: 100,
  disabled_withdraw_methods: [],
  show_history: true,
};

const DEMO_PRIZE_USD = 120;
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const DEMO_HISTORY = [
  { payment_id: 'demo-past-2', amount: 45, message: 'Summer Quest, weekly bonus', partner_fee_usdc: 0.7, daysAgo: 9 },
  { payment_id: 'demo-past-1', amount: 200, message: 'Spring Quest, 2nd place', partner_fee_usdc: 2.25, daysAgo: 41 },
];

/** The sample partner takes its options from the link, so a demo can show every combination. Real partners never do. */
export function parseDemoOptions(methods?: string, history?: string): { methods: WithdrawMethod[]; showHistory: boolean } {
  const picked = (methods ?? '').split(',').map((m) => m.trim()).filter((m): m is WithdrawMethod => (WITHDRAW_METHODS as readonly string[]).includes(m));
  return { methods: picked.length ? [...new Set(picked)] : [...WITHDRAW_METHODS], showHistory: history !== '0' };
}

export type DemoQuery = { methods?: string; history?: string; name?: string; color?: string; fee?: string; pct?: string; prize?: string; logo?: string };

/** Sample logos the demo store serves. Only these ids map to a URL, so a link can never point the page at an arbitrary image. */
const DEMO_LOGOS = ['ring', 'bars', 'spark', 'wave', 'tri', 'dia'];

const num = (v: string | undefined, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/**
 * The sample partner also takes its look and fees from the link (name, brand color, flat fee, percent, prize), so a
 * prospect can set their own up in the demo store and see this page change. Everything is clamped and sanitised, and
 * only the built-in demo partner ever reads it.
 */
export function demoPartner(q: DemoQuery = {}): PublicPartner {
  const o = parseDemoOptions(q.methods, q.history);
  const name = (q.name ?? '').replace(/[^\p{L}\p{N} .&'-]/gu, '').trim().slice(0, 30);
  return {
    ...DEMO_PARTNER,
    name: name || DEMO_PARTNER.name,
    logo_url: DEMO_LOGOS.includes(q.logo ?? '') ? `https://loofta-rally.fly.dev/logos/${q.logo}.svg` : DEMO_PARTNER.logo_url,
    brand_color: /^[0-9a-fA-F]{6}$/.test(q.color ?? '') ? `#${q.color}` : DEMO_PARTNER.brand_color,
    fee_fixed_usd: num(q.fee, 0, 5, DEMO_PARTNER.fee_fixed_usd),
    fee_percent_bps: Math.round(num(q.pct, 0, 20, DEMO_PARTNER.fee_percent_bps / 100) * 100),
    disabled_withdraw_methods: WITHDRAW_METHODS.filter((m) => !o.methods.includes(m)),
    show_history: o.showHistory,
  };
}

export function demoQuote(opts: DemoQuery = {}): WithdrawQuote {
  const o = parseDemoOptions(opts.methods, opts.history);
  const partner = demoPartner(opts);
  const prize = num(opts.prize, 1, 10_000, DEMO_PRIZE_USD);
  const partnerFee = computePartnerFeeUsdc(partner, prize);
  return {
    partner,
    available: [
      {
        payment_id: 'demo-prize',
        amount: prize,
        message: 'Summer Quest, 1st place',
        created_at: new Date().toISOString(),
        funded: true,
      },
    ],
    processing: [],
    gross_usdc: prize,
    partner_fee_usdc: partnerFee,
    loofta_fee_usdc: 0,
    net_usdc: Math.round((prize - partnerFee) * 1e6) / 1e6,
    min_usd: partner.withdraw_min_usd,
    can_withdraw: true,
    reason: null,
    methods: o.methods,
    history_enabled: o.showHistory,
    history: !o.showHistory ? [] : DEMO_HISTORY.map((h) => ({ ...h, received_at: ago(h.daysAgo + 1), withdrawn_at: ago(h.daysAgo) })),
  };
}

export function demoConfirm() {
  return {
    results: [{ payment_id: 'demo-prize', ok: true, tx: 'demo' }],
    partner_fee_usdc: demoQuote().partner_fee_usdc,
    demo: true as const,
  };
}
