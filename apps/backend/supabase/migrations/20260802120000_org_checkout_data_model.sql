-- =====================================================
-- Organization checkout: data model for Phase 1
--
-- `organization_payments` already exists live in the database (provisioned
-- for an earlier, abandoned checkout concept) but has no tracked migration
-- in this repo. This migration formally tracks it (idempotent CREATE TABLE
-- matching its live shape) and adds the columns needed to wire it into the
-- real checkout flow (payment_id FK back to `payments`, flat fee column).
-- =====================================================

CREATE TABLE IF NOT EXISTS public.organization_payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  amount_usd      TEXT NOT NULL,
  deposit_address TEXT NOT NULL,
  memo            TEXT,
  referral        TEXT,
  status          TEXT NOT NULL DEFAULT 'OPEN',
  token_chain     TEXT,
  token_symbol    TEXT,
  tx_hash         TEXT,
  explorer_url    TEXT
);

-- Links the ledger row to the real payments/claim row that actually moves funds.
ALTER TABLE public.organization_payments
  ADD COLUMN IF NOT EXISTS payment_id UUID REFERENCES public.payments(id);

-- Flat $0.01 Loofta checkout fee actually charged on this payment (org-facing reporting).
ALTER TABLE public.organization_payments
  ADD COLUMN IF NOT EXISTS loofta_fee_usdc NUMERIC(20, 6);

CREATE INDEX IF NOT EXISTS organization_payments_organization_id_idx
  ON public.organization_payments (organization_id);
CREATE INDEX IF NOT EXISTS organization_payments_payment_id_idx
  ON public.organization_payments (payment_id) WHERE payment_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_organization_payments_updated_at ON public.organization_payments;
CREATE TRIGGER trg_organization_payments_updated_at
BEFORE UPDATE ON public.organization_payments
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.organization_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_organization_payments ON public.organization_payments;
CREATE POLICY deny_all_organization_payments ON public.organization_payments FOR ALL USING (false) WITH CHECK (false);

-- Deliberately no organization_id column on `payments` — organization_payments.payment_id
-- (above) is the only place that link lives; ClaimsService's fee check and the auto-settle
-- cron both key off organization_payments instead of a duplicated column on the high-traffic
-- payments table.

-- Self-serve organization ownership (distinct from created_by, which today
-- means "admin who created this row" for admin-created organizations).
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS owner_privy_user_id TEXT;

-- The live checkout_status CHECK constraint only ever allowed ('active','inactive') — the
-- original 20240101000002_create_organizations.sql migration. CreateOrganizationDto's
-- CheckoutStatus enum has claimed 'pending' was valid since that same file, but it was never
-- actually wired into the database until now — self-serve signup (which lands as 'pending')
-- would otherwise violate this constraint on every single call.
ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_checkout_status_check;
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_checkout_status_check
  CHECK (checkout_status IN ('active', 'inactive', 'pending'));

-- Links an API key set to an organization (integrators had no tenant concept before).
-- Guarded: the `integrators` table itself comes from a separate, already-tracked migration
-- (20260721100000_create_integrators_tables.sql) that may not have been applied to every
-- environment yet — this must not hard-fail the rest of this migration if it's missing.
-- Self-serve API key issuance (OrganizationsService.createApiKey) won't work until that
-- earlier migration is applied too; that's a pre-existing gap, not something to reproduce here.
DO $$
BEGIN
  IF to_regclass('public.integrators') IS NOT NULL THEN
    ALTER TABLE public.integrators
      ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id);
    CREATE INDEX IF NOT EXISTS integrators_organization_id_idx
      ON public.integrators (organization_id) WHERE organization_id IS NOT NULL;
  END IF;
END $$;
