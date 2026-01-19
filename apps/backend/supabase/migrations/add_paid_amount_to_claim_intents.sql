-- Add paid_amount column to claim_intents table
-- This stores the actual amount that was paid (formatted, human-readable)
ALTER TABLE public.claim_intents 
ADD COLUMN IF NOT EXISTS paid_amount TEXT;

-- Add comment
COMMENT ON COLUMN public.claim_intents.paid_amount IS 'The actual amount paid (formatted, human-readable) e.g. "0.041995"';

