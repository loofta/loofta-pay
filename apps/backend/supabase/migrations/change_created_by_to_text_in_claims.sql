-- Change created_by column from UUID to TEXT to support Privy DIDs
-- This allows storing Privy user IDs (did:privy:...) directly

-- First, drop the foreign key constraint if it exists
ALTER TABLE public.claims 
  DROP CONSTRAINT IF EXISTS claims_created_by_fkey;

-- Change the column type from UUID to TEXT
ALTER TABLE public.claims 
  ALTER COLUMN created_by TYPE TEXT USING created_by::TEXT;

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_claims_created_by ON public.claims (created_by);

-- Add comment
COMMENT ON COLUMN public.claims.created_by IS 'Privy user ID (did:privy:...) of the user who created this payment link';
