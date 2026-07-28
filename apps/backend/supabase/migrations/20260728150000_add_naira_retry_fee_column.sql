-- Fixes a real incident: cronSweepPendingBurners / scheduleBackgroundSweepRetry resume a stuck
-- burner sweep using claim_requested_destination, but "claim in Naira" never stamped its
-- resolved PAJ abstracted wallet_address there (only raw destinationAddress was recorded) —
-- so a retried Naira claim fell back to the recipient's own wallet instead of their bank
-- account (claim 3d05bc19, 2026-07-28). claim_requested_destination now gets the resolved
-- sweep destination for every path; this column carries the fee that goes with it so a retried
-- sweep still takes Loofta's cut instead of silently waiving it.
alter table public.payments
  add column if not exists claim_requested_naira_fee_usdc numeric(20,6);
