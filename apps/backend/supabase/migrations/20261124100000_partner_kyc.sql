-- Optional identity check (zkMe) for people a partner pays. Off by default and on request only: a partner
-- switches it on, then asks for a check for specific recipients that must pass before they can withdraw.
-- Nothing here blocks a withdrawal yet; these are the fields the withdraw flow will read.
ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS kyc_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.partner_recipients
  ADD COLUMN IF NOT EXISTS kyc_status       TEXT NOT NULL DEFAULT 'not_requested',
  ADD COLUMN IF NOT EXISTS kyc_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS kyc_checked_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS kyc_passed_at    TIMESTAMPTZ,
  -- Price per person at the moment the check was requested, so a later price change never rewrites history.
  ADD COLUMN IF NOT EXISTS kyc_fee_usd      NUMERIC(10,2);

ALTER TABLE public.partner_recipients DROP CONSTRAINT IF EXISTS partner_recipients_kyc_status_check;
ALTER TABLE public.partner_recipients
  ADD CONSTRAINT partner_recipients_kyc_status_check
  CHECK (kyc_status IN ('not_requested', 'requested', 'in_progress', 'passed', 'failed'));

CREATE INDEX IF NOT EXISTS partner_recipients_kyc_idx ON public.partner_recipients (partner_id, kyc_status) WHERE kyc_status <> 'not_requested';
