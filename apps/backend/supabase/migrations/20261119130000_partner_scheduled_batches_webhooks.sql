-- Scheduled partner batches and batch-level webhook events.
--
-- A batch can carry a run time. At that time Loofta prepares it (creates the payouts and asks the
-- company wallet's signers to approve the funding). Money still only moves when the signers sign.
ALTER TABLE public.payout_batches ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;
ALTER TABLE public.payout_batches ADD COLUMN IF NOT EXISTS scheduled_run_at TIMESTAMPTZ;
ALTER TABLE public.payout_batches ADD COLUMN IF NOT EXISTS scheduled_error TEXT;
CREATE INDEX IF NOT EXISTS payout_batches_scheduled_due_idx
  ON public.payout_batches (scheduled_for)
  WHERE status = 'approved' AND scheduled_for IS NOT NULL AND scheduled_run_at IS NULL;

-- Batch events (batch.approved, batch.ready_to_fund, ...) have no single payment, so the outbox
-- row may now be keyed by the batch instead.
ALTER TABLE public.payout_webhook_events ALTER COLUMN payment_id DROP NOT NULL;
ALTER TABLE public.payout_webhook_events ADD COLUMN IF NOT EXISTS batch_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS payout_webhook_events_batch_event_uniq
  ON public.payout_webhook_events (batch_id, event_type)
  WHERE payment_id IS NULL;
