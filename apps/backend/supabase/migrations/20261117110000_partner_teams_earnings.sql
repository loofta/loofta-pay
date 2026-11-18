-- =====================================================
-- Partner teams, audit log, earnings + settlements, batch approvals.
-- Every table is service-role only (RLS on, anon/authenticated revoked).
-- =====================================================

-- Team members. A row is either an invite (status 'invited', user_id NULL until accepted) or an
-- active member. Authority is checked against this table on EVERY request (no caching), so removing
-- a member cuts their access immediately.
CREATE TABLE IF NOT EXISTS public.partner_members (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id         UUID NOT NULL REFERENCES public.partners(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  user_id            TEXT,                         -- Privy id; NULL while only invited
  email              TEXT,                         -- invite target; the accepting user must have this verified email
  role               TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'payer', 'viewer')),
  status             TEXT NOT NULL CHECK (status IN ('invited', 'active', 'removed')),
  invited_by         TEXT,
  -- SHA-256 of the invite token. The raw token is shown once and never stored.
  invite_token_hash  TEXT UNIQUE,
  invite_expires_at  TIMESTAMPTZ,
  accepted_at        TIMESTAMPTZ,
  removed_at         TIMESTAMPTZ,
  removed_by         TEXT,

  CHECK (status <> 'active' OR user_id IS NOT NULL),
  CHECK (status <> 'invited' OR (email IS NOT NULL AND invite_token_hash IS NOT NULL AND invite_expires_at IS NOT NULL))
);
-- One live membership per user per org, and one live invite per email per org.
CREATE UNIQUE INDEX IF NOT EXISTS partner_members_active_user_idx
  ON public.partner_members (partner_id, user_id) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS partner_members_live_invite_idx
  ON public.partner_members (partner_id, lower(email)) WHERE status = 'invited';
CREATE INDEX IF NOT EXISTS partner_members_user_idx ON public.partner_members (user_id) WHERE status = 'active';

DROP TRIGGER IF EXISTS trg_partner_members_updated_at ON public.partner_members;
CREATE TRIGGER trg_partner_members_updated_at
BEFORE UPDATE ON public.partner_members
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Append-only audit trail. The trigger refuses UPDATE and DELETE even for the service role, so a
-- compromised admin account cannot quietly rewrite who approved what.
CREATE TABLE IF NOT EXISTS public.partner_audit_log (
  id             BIGSERIAL PRIMARY KEY,
  partner_id     UUID NOT NULL REFERENCES public.partners(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_user_id  TEXT,                 -- NULL for system actions (cron settlement)
  action         TEXT NOT NULL,
  target_type    TEXT,
  target_id      TEXT,
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS partner_audit_log_partner_idx ON public.partner_audit_log (partner_id, id DESC);

CREATE OR REPLACE FUNCTION public.partner_audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'partner_audit_log is append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_partner_audit_log_immutable ON public.partner_audit_log;
CREATE TRIGGER trg_partner_audit_log_immutable
BEFORE UPDATE OR DELETE ON public.partner_audit_log
FOR EACH ROW EXECUTE FUNCTION public.partner_audit_log_immutable();

-- The partner's cut of each withdrawal. It is paid straight to the partner's own wallet inside the
-- withdrawal's sweep transaction, so Loofta never holds it; this table is the record for reporting.
-- One row per payment (UNIQUE), so a retried sweep or the backfill can never double-count.
CREATE TABLE IF NOT EXISTS public.partner_earnings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id     UUID NOT NULL REFERENCES public.partners(id),
  payment_id     UUID NOT NULL UNIQUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  amount_usdc    NUMERIC(18,6) NOT NULL CHECK (amount_usdc > 0),
  is_devnet      BOOLEAN NOT NULL DEFAULT false,
  fee_wallet     TEXT NOT NULL,         -- where it was paid
  tx_hash        TEXT
);
CREATE INDEX IF NOT EXISTS partner_earnings_partner_idx ON public.partner_earnings (partner_id, created_at DESC);

-- Partner settings that guard money.
ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS approval_threshold_usd NUMERIC(14,2) NOT NULL DEFAULT 1000 CHECK (approval_threshold_usd >= 0);
-- A changed fee wallet only takes effect after a cooling-off period, so a hijacked owner login
-- cannot silently redirect earnings; the real owner has time to notice and revert.
ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS fee_wallet_pending TEXT;
ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS fee_wallet_effective_at TIMESTAMPTZ;

-- Fee stamped on a partner payment BEFORE its burner is swept. The sweep refuses a partner payment
-- with no stamp, which is what makes the fee impossible to skip on any path (cron, retry, API).
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS partner_fee_stamped_at TIMESTAMPTZ;
-- The partner wallet the fee goes to, frozen at stamp time so a later change cannot redirect it.
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS partner_fee_wallet TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS partner_withdrawn_at TIMESTAMPTZ;

-- Batches: drafted by a payer, approved by a different member when over the threshold.
ALTER TABLE public.payout_batches ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'executed'
  CHECK (status IN ('pending_approval', 'approved', 'executed', 'rejected', 'cancelled'));
ALTER TABLE public.payout_batches ADD COLUMN IF NOT EXISTS created_by_user_id TEXT;
ALTER TABLE public.payout_batches ADD COLUMN IF NOT EXISTS approved_by_user_id TEXT;
ALTER TABLE public.payout_batches ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
-- Hash of the exact rows approved; execution re-hashes and refuses if anything changed since.
ALTER TABLE public.payout_batches ADD COLUMN IF NOT EXISTS rows_hash TEXT;

ALTER TABLE public.partner_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_earnings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_partner_members ON public.partner_members;
CREATE POLICY deny_all_partner_members ON public.partner_members FOR ALL USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS deny_all_partner_audit_log ON public.partner_audit_log;
CREATE POLICY deny_all_partner_audit_log ON public.partner_audit_log FOR ALL USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS deny_all_partner_earnings ON public.partner_earnings;
CREATE POLICY deny_all_partner_earnings ON public.partner_earnings FOR ALL USING (false) WITH CHECK (false);
REVOKE ALL ON public.partner_members, public.partner_audit_log, public.partner_earnings FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.partner_audit_log_id_seq FROM anon, authenticated;
