-- One funding transaction can fund at most one ordinary payment.
--
-- 2026-11-20: an attacker attached the same transaction hash to several payments (two parallel requests both
-- passed the application-level "is this hash unused" check). The app now claims each hash atomically in Redis,
-- and this index is the backstop that makes the database refuse it no matter which code path writes the row.
--
-- Rows that legitimately share one transaction are excluded, so they keep working:
--   * is_multi_send: one transaction pays several recipients
--   * partner_id:    a partner batch is funded by a single transaction
--   * CANCELLED:     dead rows (this also lets the index build over the already-cancelled forged duplicates)
--
-- Before applying, this must return no rows. If it does, those payments share a hash and need cancelling or
-- clearing first, otherwise CREATE UNIQUE INDEX fails:
--
--   SELECT sender_tx_hash, count(*), array_agg(id)
--   FROM public.payments
--   WHERE sender_tx_hash IS NOT NULL
--     AND is_multi_send IS NOT TRUE
--     AND partner_id IS NULL
--     AND status <> 'CANCELLED'
--   GROUP BY sender_tx_hash
--   HAVING count(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS payments_sender_tx_hash_unique
  ON public.payments (sender_tx_hash)
  WHERE sender_tx_hash IS NOT NULL
    AND is_multi_send IS NOT TRUE
    AND partner_id IS NULL
    AND status <> 'CANCELLED';
