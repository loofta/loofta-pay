-- On-chain receipt logger: batch commitment + authorization + receipt tx ref.
-- No amounts stored on-chain; only batch_hash (and receipt_on_chain_tx_hash after posting).

ALTER TABLE public.payroll_runs
  ADD COLUMN IF NOT EXISTS batch_hash TEXT,
  ADD COLUMN IF NOT EXISTS authorizer_id TEXT,
  ADD COLUMN IF NOT EXISTS authorization_nonce BIGINT,
  ADD COLUMN IF NOT EXISTS asset_id TEXT,
  ADD COLUMN IF NOT EXISTS receipt_on_chain_tx_hash TEXT;

COMMENT ON COLUMN public.payroll_runs.batch_hash IS 'Commitment to batch (hash of entries). Stored on-chain as receipt; no amounts.';
COMMENT ON COLUMN public.payroll_runs.authorizer_id IS 'NEAR account or key id that authorized this run (for receipt logger).';
COMMENT ON COLUMN public.payroll_runs.authorization_nonce IS 'Nonce used for this run (idempotency on-chain).';
COMMENT ON COLUMN public.payroll_runs.asset_id IS 'Asset identifier (e.g. USDC on base) for the run.';
COMMENT ON COLUMN public.payroll_runs.receipt_on_chain_tx_hash IS 'NEAR tx hash after posting receipt to Receipt Logger contract.';

CREATE INDEX IF NOT EXISTS idx_payroll_runs_batch_hash ON public.payroll_runs(batch_hash) WHERE batch_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payroll_runs_receipt_tx ON public.payroll_runs(receipt_on_chain_tx_hash) WHERE receipt_on_chain_tx_hash IS NOT NULL;
