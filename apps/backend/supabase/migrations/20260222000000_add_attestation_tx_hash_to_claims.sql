-- On-chain attestation: NEAR tx hash from payroll attestation contract when payment completes
ALTER TABLE public.claims
ADD COLUMN IF NOT EXISTS attestation_tx_hash text;

COMMENT ON COLUMN public.claims.attestation_tx_hash IS 'NEAR transaction hash from attestation contract record_payment (idempotent per claim)';
