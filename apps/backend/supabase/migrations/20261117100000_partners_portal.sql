-- =====================================================
-- Partner portal. A partner is an org that pays its own users (creators, affiliates) through
-- Loofta. The owner logs in with Privy like any user; the public identifier is org_id.
-- Supersedes the integrator-keyed partner_settings/partner_recipients shape from 20261104*:
-- those tables stay (they are unapplied or empty) and gain a partner_id.
-- =====================================================

CREATE TABLE IF NOT EXISTS public.partners (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Public, URL-safe identifier used in pay.loofta.com/withdraw?orgId= and the SDK.
  org_id             TEXT NOT NULL UNIQUE,
  owner_user_id      TEXT NOT NULL,           -- Privy user id of the creator of the org
  name               TEXT NOT NULL,
  logo_url           TEXT,
  brand_color        TEXT,

  -- Org details. KYB comes later; for now these are self-declared and optional.
  legal_name         TEXT,
  country            TEXT,
  website            TEXT,
  contact_email      TEXT,
  kyb_status         TEXT NOT NULL DEFAULT 'not_required' CHECK (kyb_status IN ('not_required', 'pending', 'verified', 'rejected')),

  -- Withdrawal widget settings the partner controls. Always ADDED to Loofta's own fee.
  withdraw_min_usd   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (withdraw_min_usd >= 0),
  fee_fixed_usd      NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (fee_fixed_usd >= 0 AND fee_fixed_usd <= 25),
  fee_percent_bps    INT NOT NULL DEFAULT 0 CHECK (fee_percent_bps >= 0 AND fee_percent_bps <= 1000),

  -- Where the partner's cut is sent on every withdrawal (their own wallet, never ours).
  fee_wallet         TEXT,

  -- Optional: API key identity for SDK/server use, created on demand.
  integrator_id      UUID REFERENCES public.integrators(id),

  webhook_url        TEXT,
  webhook_secret     TEXT,
  recipients_pull_url TEXT,                   -- we GET this to import recipients

  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended'))
);
CREATE UNIQUE INDEX IF NOT EXISTS partners_owner_idx ON public.partners (owner_user_id);

DROP TRIGGER IF EXISTS trg_partners_updated_at ON public.partners;
CREATE TRIGGER trg_partners_updated_at
BEFORE UPDATE ON public.partners
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- A partner's recipients (the people it pays). Keyed by the partner's own ref plus at least one
-- way to reach them: email or a social handle. loofta_user_id is filled once they log in.
ALTER TABLE public.partner_recipients ADD COLUMN IF NOT EXISTS partner_id UUID REFERENCES public.partners(id) ON DELETE CASCADE;
ALTER TABLE public.partner_recipients ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.partner_recipients ADD COLUMN IF NOT EXISTS handle_platform TEXT;
ALTER TABLE public.partner_recipients ADD COLUMN IF NOT EXISTS handle TEXT;
ALTER TABLE public.partner_recipients ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.partner_recipients ADD COLUMN IF NOT EXISTS loofta_user_id TEXT;
ALTER TABLE public.partner_recipients ALTER COLUMN integrator_id DROP NOT NULL;
ALTER TABLE public.partner_recipients ALTER COLUMN external_user_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS partner_recipients_partner_ext_idx
  ON public.partner_recipients (partner_id, external_user_id) WHERE partner_id IS NOT NULL AND external_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS partner_recipients_partner_email_idx
  ON public.partner_recipients (partner_id, lower(email)) WHERE email IS NOT NULL;

-- Payments paid by a partner. Set => the money ALWAYS sits in a burner until the recipient
-- withdraws it on the partner withdraw page, where the partner fee is applied.
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS partner_id UUID REFERENCES public.partners(id);
CREATE INDEX IF NOT EXISTS payments_partner_idx ON public.payments (partner_id) WHERE partner_id IS NOT NULL;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS partner_fee_usdc NUMERIC(18,6);

ALTER TABLE public.payout_batches ADD COLUMN IF NOT EXISTS partner_id UUID REFERENCES public.partners(id);

ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_partners ON public.partners;
CREATE POLICY deny_all_partners ON public.partners FOR ALL USING (false) WITH CHECK (false);
REVOKE ALL ON public.partners FROM anon, authenticated;
