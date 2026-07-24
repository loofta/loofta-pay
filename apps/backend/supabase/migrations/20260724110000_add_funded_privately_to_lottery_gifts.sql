-- Mirrors lottery_tickets.funded_privately: tracks whether a sender-paid gift's upfront payment
-- was an actual MagicBlock private transfer, now that gifting supports a public route too.
-- DEFAULT true backfills existing rows (every sender_paid gift until now was private); every
-- insert going forward sets this explicitly (initiateGiftedPurchase via route, admin gifts to
-- false since no sender payment is ever involved there).
ALTER TABLE lottery_gifts
  ADD COLUMN IF NOT EXISTS funded_privately boolean NOT NULL DEFAULT true;
