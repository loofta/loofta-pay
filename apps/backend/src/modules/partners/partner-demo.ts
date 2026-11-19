import type { PublicPartner } from './partners.service';
import type { WithdrawQuote } from './partner-withdraw.service';
import { computePartnerFeeUsdc } from './partner-fee';

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
};

const DEMO_PRIZE_USD = 120;

export function demoQuote(): WithdrawQuote {
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
  };
}

export function demoConfirm() {
  return {
    results: [{ payment_id: 'demo-prize', ok: true, tx: 'demo' }],
    partner_fee_usdc: demoQuote().partner_fee_usdc,
    demo: true as const,
  };
}
