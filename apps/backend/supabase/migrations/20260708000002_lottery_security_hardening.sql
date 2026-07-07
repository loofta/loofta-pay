-- Security hardening for the lottery tables.
--
-- 1) The original policies were `FOR ALL USING (true) WITH CHECK (true)` with no role
--    restriction — that grants FULL read/write to the anon and authenticated roles (anyone
--    holding the public anon key), exposing encrypted wallet keys and letting statuses/refund
--    flags be tampered with. The backend uses the service-role key, which BYPASSES RLS
--    entirely, so these permissive policies protected nothing. Replace with explicit deny-all
--    (same pattern as 20260325130000_harden_rls_and_functions.sql).
DROP POLICY IF EXISTS "service_lottery_tickets_all" ON lottery_tickets;
DROP POLICY IF EXISTS "service_lottery_withdrawals_all" ON lottery_withdrawals;
DROP POLICY IF EXISTS "deny_all_lottery_tickets" ON lottery_tickets;
DROP POLICY IF EXISTS "deny_all_lottery_withdrawals" ON lottery_withdrawals;
CREATE POLICY "deny_all_lottery_tickets" ON lottery_tickets FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY "deny_all_lottery_withdrawals" ON lottery_withdrawals FOR ALL USING (false) WITH CHECK (false);

-- 2) A fee tx hash may be attached to at most ONE ticket. Without this, a user could pay the
--    fee once and confirm the same (real, valid) transaction on many tickets, then abandon
--    them all — each would become a refund candidate, draining the fee wallet.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lottery_tickets_fee_tx_hash
  ON lottery_tickets (fee_tx_hash)
  WHERE fee_tx_hash IS NOT NULL;
