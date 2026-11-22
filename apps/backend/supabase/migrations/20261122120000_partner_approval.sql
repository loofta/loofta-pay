-- Partners are reviewed by hand. A new company starts as 'pending' and can do nothing until an admin approves it.
-- Companies that already exist keep their current status (no UPDATE here), so nothing live is switched off.
ALTER TABLE public.partners DROP CONSTRAINT IF EXISTS partners_status_check;
ALTER TABLE public.partners
  ADD CONSTRAINT partners_status_check CHECK (status IN ('pending', 'active', 'rejected', 'suspended'));
ALTER TABLE public.partners ALTER COLUMN status SET DEFAULT 'pending';

ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS use_case    TEXT,
  ADD COLUMN IF NOT EXISTS review_note TEXT,
  ADD COLUMN IF NOT EXISTS applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT;

CREATE INDEX IF NOT EXISTS partners_status_applied_idx ON public.partners (status, applied_at DESC);
