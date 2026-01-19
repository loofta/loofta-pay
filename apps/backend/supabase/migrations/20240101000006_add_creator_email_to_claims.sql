-- Add creator_email column to claims table
-- This stores the email of the user who created the payment link
ALTER TABLE public.claims 
ADD COLUMN IF NOT EXISTS creator_email TEXT;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_claims_creator_email ON public.claims (creator_email);

-- Add comment
COMMENT ON COLUMN public.claims.creator_email IS 'Email address of the user who created this payment link';

