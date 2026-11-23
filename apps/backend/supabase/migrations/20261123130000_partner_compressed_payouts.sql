-- Partner payouts held as compressed USDC (see docs/proposals/PARTNER_COMPRESSED_PAYOUTS.md).
-- Only used when PARTNER_COMPRESSED_PAYOUTS=true. Old payouts are untouched.

-- Per payout: its burner holds a compressed balance (no token account), and which compress transaction funded it.
-- compress_sig is stored BEFORE the transaction is sent, so a crash can never fund a burner twice.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS burner_compressed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS compress_sig TEXT,
  ADD COLUMN IF NOT EXISTS compress_last_valid_block_height BIGINT;

-- Per funding proposal: the money staged for this batch and how far compressing it into burners has got.
ALTER TABLE public.partner_treasury_proposals
  ADD COLUMN IF NOT EXISTS staged_usdc NUMERIC,
  ADD COLUMN IF NOT EXISTS compress_status TEXT,        -- NULL: not a compressed proposal; pending | running | done | failed
  ADD COLUMN IF NOT EXISTS compress_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS compress_error TEXT,
  ADD COLUMN IF NOT EXISTS compressed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS partner_treasury_proposals_compress_idx
  ON public.partner_treasury_proposals (compress_status)
  WHERE compress_status IN ('pending', 'running');

CREATE INDEX IF NOT EXISTS payments_compress_sig_idx
  ON public.payments (compress_sig)
  WHERE compress_sig IS NOT NULL;
