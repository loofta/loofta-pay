-- A cancelled batch can be removed from the list. Soft delete: the row stays for the audit trail.
ALTER TABLE public.payout_batches DROP CONSTRAINT IF EXISTS payout_batches_status_check;
ALTER TABLE public.payout_batches
  ADD CONSTRAINT payout_batches_status_check
  CHECK (status IN ('pending_approval', 'approved', 'awaiting_funding', 'executed', 'rejected', 'cancelled', 'deleted'));
