-- Prevents the batch-completion check (fired both from checkLifiWithdrawal when a bridge leg
-- completes, and from the separate magicblockRetries sweep) from racing itself and sending two
-- MagicBlock transfers from the same shared burner — the first send succeeds, the second's
-- simulation fails with "insufficient funds" once the burner is already drained.
ALTER TABLE lottery_withdrawals ADD COLUMN IF NOT EXISTS magicblock_claimed_at timestamptz;
