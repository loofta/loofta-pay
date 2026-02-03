-- Add payment information columns to claims table
-- This tracks what token/chain was used to pay the claim

ALTER TABLE public.claims 
ADD COLUMN IF NOT EXISTS paid_with_token text,
ADD COLUMN IF NOT EXISTS paid_with_chain text;

COMMENT ON COLUMN public.claims.paid_with_token IS 'Token symbol used to pay this claim (e.g., "USDC", "ETH")';
COMMENT ON COLUMN public.claims.paid_with_chain IS 'Blockchain chain used to pay this claim (e.g., "arb", "solana")';
