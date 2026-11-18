-- Partner batches created by signed-in team members (Privy), not only by API-key integrators.
-- A batch is drafted (rows only, no money, no burners), approved by a different member when it
-- is over the partner's threshold, then "prepared": claims are created and funding transactions
-- are returned for the member's own wallet to sign. Loofta never holds the partner's funds.

ALTER TABLE public.payout_batches ALTER COLUMN integrator_id DROP NOT NULL;
ALTER TABLE public.payout_batches DROP CONSTRAINT IF EXISTS payout_batches_owner_chk;
ALTER TABLE public.payout_batches
  ADD CONSTRAINT payout_batches_owner_chk CHECK (integrator_id IS NOT NULL OR partner_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS payout_batches_partner_idem_uidx
  ON public.payout_batches (partner_id, idempotency_key) WHERE partner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payout_batches_partner_idx
  ON public.payout_batches (partner_id, created_at DESC) WHERE partner_id IS NOT NULL;

-- 'awaiting_funding': claims exist and funding transactions were issued, waiting for the wallet.
ALTER TABLE public.payout_batches DROP CONSTRAINT IF EXISTS payout_batches_status_check;
ALTER TABLE public.payout_batches
  ADD CONSTRAINT payout_batches_status_check
  CHECK (status IN ('pending_approval', 'approved', 'awaiting_funding', 'executed', 'rejected', 'cancelled'));

-- The wallet that funds the batch, fixed when the batch is prepared so a later confirm cannot be
-- satisfied by a different payer.
ALTER TABLE public.payout_batches ADD COLUMN IF NOT EXISTS sender_wallet TEXT;
ALTER TABLE public.payout_batches ADD COLUMN IF NOT EXISTS prepared_at TIMESTAMPTZ;

-- Rows are stored as 'queued' at draft time (no claim yet), 'created' once the claim exists,
-- 'funded' once the funding transaction is verified on-chain.
ALTER TABLE public.payout_batch_items DROP CONSTRAINT IF EXISTS payout_batch_items_status_check;
ALTER TABLE public.payout_batch_items
  ADD CONSTRAINT payout_batch_items_status_check
  CHECK (status IN ('queued', 'created', 'funded', 'failed'));
ALTER TABLE public.payout_batch_items ADD COLUMN IF NOT EXISTS message TEXT;
ALTER TABLE public.payout_batch_items ADD COLUMN IF NOT EXISTS funding_tx TEXT;

-- Short business description shown on the partner's withdraw page.
ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS description TEXT CHECK (description IS NULL OR char_length(description) <= 500);
