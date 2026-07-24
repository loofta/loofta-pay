-- Tracks whether a ticket's cost was actually paid via a MagicBlock private transfer, so the
-- MagicBlock "purchase 1 lottery ticket privately" quest push can gate on this directly instead
-- of burner_sol_address presence (which is set for both private and public purchase routes, and
-- for admin_treasury-funded gift tickets that never had any private payment at all).
ALTER TABLE lottery_tickets
  ADD COLUMN IF NOT EXISTS funded_privately boolean NOT NULL DEFAULT false;
