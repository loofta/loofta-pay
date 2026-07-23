-- Groups sibling rows created by a single multi-send call. Previously the only correlation
-- between a batch's payment rows was the payment_ids array threaded through API responses —
-- this gives batch membership a durable DB-level identity, needed by the hub-funded private
-- fan-out (poll once, fan out to every row in the batch, pro-rate the one MagicBlock fee).
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS multi_send_batch_id UUID;

CREATE INDEX IF NOT EXISTS payments_multi_send_batch_id_idx
  ON public.payments (multi_send_batch_id)
  WHERE multi_send_batch_id IS NOT NULL;
