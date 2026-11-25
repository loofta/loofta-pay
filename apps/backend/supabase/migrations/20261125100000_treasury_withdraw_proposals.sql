-- Company wallet withdrawals: a proposal that moves USDC out to an address the owner chooses, approved like any other.
ALTER TABLE public.partner_treasury_proposals DROP CONSTRAINT IF EXISTS partner_treasury_proposals_kind_check;
ALTER TABLE public.partner_treasury_proposals ADD CONSTRAINT partner_treasury_proposals_kind_check CHECK (kind IN ('payout', 'config', 'withdraw'));
