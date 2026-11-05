-- =====================================================
-- Partner payouts, phase 1: bulk batches + per-partner settings.
-- A "partner" is an existing integrators row (no new identity table). Batches group many
-- payouts created in one API call; each item points at its payments row (payment_id) so the
-- claim, funding and history all stay in the primary payments table.
-- =====================================================

CREATE TABLE IF NOT EXISTS public.partner_settings (
  integrator_id          UUID PRIMARY KEY REFERENCES public.integrators(id) ON DELETE CASCADE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Fee the partner adds on top when a recipient cashes out to non-crypto (bps + flat USD),
  -- capped so a misconfigured partner can't take the whole payout. Applied in a later phase.
  cashout_fee_bps        INT NOT NULL DEFAULT 0 CHECK (cashout_fee_bps >= 0 AND cashout_fee_bps <= 1000),
  cashout_fee_flat_usd   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cashout_fee_flat_usd >= 0 AND cashout_fee_flat_usd <= 25),

  -- Withdrawal methods the embedded portal offers; NULL = all available.
  allowed_withdrawal_methods TEXT[],
  default_withdrawal_method  TEXT,

  webhook_url            TEXT,
  webhook_secret         TEXT
);

DROP TRIGGER IF EXISTS trg_partner_settings_updated_at ON public.partner_settings;
CREATE TRIGGER trg_partner_settings_updated_at
BEFORE UPDATE ON public.partner_settings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.payout_batches (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integrator_id    UUID NOT NULL REFERENCES public.integrators(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Caller-supplied; the same key from the same partner returns the original batch instead of
  -- paying everyone twice when a request is retried.
  idempotency_key  TEXT NOT NULL,
  label            TEXT,
  total_amount     NUMERIC(18,6) NOT NULL DEFAULT 0,
  item_count       INT NOT NULL DEFAULT 0,
  failed_count     INT NOT NULL DEFAULT 0,
  UNIQUE (integrator_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS payout_batches_integrator_idx ON public.payout_batches (integrator_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_payout_batches_updated_at ON public.payout_batches;
CREATE TRIGGER trg_payout_batches_updated_at
BEFORE UPDATE ON public.payout_batches
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.payout_batch_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id              UUID NOT NULL REFERENCES public.payout_batches(id) ON DELETE CASCADE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  row_index             INT NOT NULL,

  recipient_type        TEXT NOT NULL,
  recipient_identifier  TEXT NOT NULL,
  amount                NUMERIC(18,6) NOT NULL,
  -- Partner's own reference for this row (their user id / invoice id), echoed in webhooks.
  external_ref          TEXT,

  status                TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'failed')),
  error                 TEXT,
  payment_id            UUID,
  UNIQUE (batch_id, row_index)
);
CREATE INDEX IF NOT EXISTS payout_batch_items_batch_idx ON public.payout_batch_items (batch_id);
CREATE INDEX IF NOT EXISTS payout_batch_items_payment_idx ON public.payout_batch_items (payment_id);

-- Service-role only: nothing here is ever readable from the browser with the anon key.
ALTER TABLE public.partner_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_batch_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_partner_settings ON public.partner_settings;
CREATE POLICY deny_all_partner_settings ON public.partner_settings FOR ALL USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS deny_all_payout_batches ON public.payout_batches;
CREATE POLICY deny_all_payout_batches ON public.payout_batches FOR ALL USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS deny_all_payout_batch_items ON public.payout_batch_items;
CREATE POLICY deny_all_payout_batch_items ON public.payout_batch_items FOR ALL USING (false) WITH CHECK (false);
REVOKE ALL ON public.partner_settings, public.payout_batches, public.payout_batch_items FROM anon, authenticated;
