-- Invoice flow: prepared (on deal) -> sent (on confirm delivery) -> paid (when payment done)
-- Make deal_payment_id nullable (invoice exists before payment)
ALTER TABLE public.deal_invoices
  ALTER COLUMN deal_payment_id DROP NOT NULL;

-- Allow status: prepared, sent, paid (and keep generated for backfill)
ALTER TABLE public.deal_invoices DROP CONSTRAINT IF EXISTS deal_invoices_status_check;
ALTER TABLE public.deal_invoices
  ADD CONSTRAINT deal_invoices_status_check
  CHECK (status IN ('prepared', 'generated', 'sent', 'paid'));

-- Default new invoices to prepared
ALTER TABLE public.deal_invoices ALTER COLUMN status SET DEFAULT 'prepared';

-- FK: when payment is deleted, unlink invoice (SET NULL)
ALTER TABLE public.deal_invoices DROP CONSTRAINT IF EXISTS deal_invoices_deal_payment_id_fkey;
ALTER TABLE public.deal_invoices
  ADD CONSTRAINT deal_invoices_deal_payment_id_fkey
  FOREIGN KEY (deal_payment_id) REFERENCES public.deal_payments(id) ON DELETE SET NULL;

-- Invoice number for display (optional)
ALTER TABLE public.deal_invoices
  ADD COLUMN IF NOT EXISTS invoice_number TEXT;
CREATE INDEX IF NOT EXISTS idx_deal_invoices_invoice_number ON public.deal_invoices(invoice_number) WHERE invoice_number IS NOT NULL;

COMMENT ON COLUMN public.deal_invoices.deal_payment_id IS 'Set when org accepts delivery and creates payment; null until then.';
COMMENT ON COLUMN public.deal_invoices.status IS 'prepared=created with deal; sent=freelancer confirmed delivery; paid=payment completed and attested.';

-- On-chain attestation when invoice is marked paid (receipt logger)
ALTER TABLE public.deal_invoices ADD COLUMN IF NOT EXISTS receipt_on_chain_tx_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_deal_invoices_receipt_tx ON public.deal_invoices(receipt_on_chain_tx_hash) WHERE receipt_on_chain_tx_hash IS NOT NULL;
