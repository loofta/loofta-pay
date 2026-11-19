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

export function demoQuote(opts: { methods?: string; history?: string } = {}): WithdrawQuote {
  const o = parseDemoOptions(opts.methods, opts.history);
  const partnerFee = computePartnerFeeUsdc(DEMO_PARTNER, DEMO_PRIZE_USD);
  return {
    partner: DEMO_PARTNER,
    available: [
      {
        payment_id: 'demo-prize',
        amount: DEMO_PRIZE_USD,
        message: 'Summer Quest, 1st place',
        created_at: new Date().toISOString(),
        funded: true,
      },
    ],
    processing: [],
    gross_usdc: DEMO_PRIZE_USD,
    partner_fee_usdc: partnerFee,
    loofta_fee_usdc: 0,
    net_usdc: Math.round((DEMO_PRIZE_USD - partnerFee) * 1e6) / 1e6,
    min_usd: DEMO_PARTNER.withdraw_min_usd,
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
