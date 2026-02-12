-- Invite token for payroll contributors (for invite link + onboarding)
ALTER TABLE public.payroll_contributors
  ADD COLUMN IF NOT EXISTS invite_token TEXT,
  ADD COLUMN IF NOT EXISTS invite_sent_at TIMESTAMPTZ;

-- Unique token for lookup (one invite link per contributor)
CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_contributors_invite_token
  ON public.payroll_contributors(invite_token)
  WHERE invite_token IS NOT NULL;

COMMENT ON COLUMN public.payroll_contributors.invite_token IS 'Secret token for invite link; used in /payroll/invite/:token';
COMMENT ON COLUMN public.payroll_contributors.invite_sent_at IS 'When invite email/link was last sent';
