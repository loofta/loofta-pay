-- Add stealth address and encrypted private key columns to claim_intents table
-- These are used for private payments to prevent address reuse and privacy leakage

ALTER TABLE public.claim_intents
ADD COLUMN IF NOT EXISTS stealth_address TEXT,
ADD COLUMN IF NOT EXISTS encrypted_private_key TEXT;

-- Create index on stealth_address for lookups
CREATE INDEX IF NOT EXISTS idx_claim_intents_stealth_address 
ON public.claim_intents(stealth_address) 
WHERE stealth_address IS NOT NULL;

-- Add comment explaining the columns
COMMENT ON COLUMN public.claim_intents.stealth_address IS 'Unique Solana address generated per private payment to prevent address reuse and privacy leakage';
COMMENT ON COLUMN public.claim_intents.encrypted_private_key IS 'Encrypted private key for stealth address, stored temporarily and cleared after Privacy Cash execution';
