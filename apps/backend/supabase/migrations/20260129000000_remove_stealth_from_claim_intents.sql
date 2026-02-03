-- Remove stealth address and encrypted private key from claim_intents
-- Private cross-chain now uses user's embedded Solana wallet; no backend stealth/treasury wallets

DROP INDEX IF EXISTS idx_claim_intents_stealth_address;

ALTER TABLE public.claim_intents
DROP COLUMN IF EXISTS stealth_address,
DROP COLUMN IF EXISTS encrypted_private_key;
