-- Nonce used when computing attestation commitment (SHA256 preimage). Stored for verification.
-- Preimage: claim_id || "\n" || execution_ref || "\n" || amount || "\n" || token_symbol || "\n" || token_chain || "\n" || recipient_id || "\n" || nonce_hex
ALTER TABLE public.claims
  ADD COLUMN IF NOT EXISTS attestation_nonce text;

COMMENT ON COLUMN public.claims.attestation_nonce IS 'Hex-encoded 32-byte nonce used in attestation commitment; needed to verify on-chain commitment against off-chain data';
