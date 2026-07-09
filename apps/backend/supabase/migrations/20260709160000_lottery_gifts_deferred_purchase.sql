-- Defer the actual Megapot purchase for sender_paid gifts to CLAIM time, matching the
-- admin_treasury design principle: no lottery_tickets row (and therefore no ball numbers, no
-- draw entry) should exist until the recipient actually claims. Previously sender_paid gifts
-- bought the ticket immediately at send time — that meant the ticket showed up with real numbers
-- in the sender's own history before anyone had claimed it, and entered a draw the recipient
-- might not open their email in time for.
--
-- The sender still pays immediately (their money, their commitment) — it lands in a holding
-- burner tracked here on lottery_gifts. The companion wallet + actual buyTickets() call only
-- happen at claim time (see LotteryService.purchaseGiftTickets), reusing this pre-funded burner
-- instead of generating + funding a fresh one from treasury.
ALTER TABLE public.lottery_gifts ADD COLUMN IF NOT EXISTS burner_sol_address text;
ALTER TABLE public.lottery_gifts ADD COLUMN IF NOT EXISTS burner_sol_key_enc text;
ALTER TABLE public.lottery_gifts ADD COLUMN IF NOT EXISTS fee_tx_hash text;
ALTER TABLE public.lottery_gifts ADD COLUMN IF NOT EXISTS sender_tx_hash text;

ALTER TABLE public.lottery_gifts DROP CONSTRAINT IF EXISTS lottery_gifts_status_check;
ALTER TABLE public.lottery_gifts ADD CONSTRAINT lottery_gifts_status_check
  CHECK (status IN ('pending_payment', 'unclaimed', 'claimed', 'cancelled', 'failed'));
