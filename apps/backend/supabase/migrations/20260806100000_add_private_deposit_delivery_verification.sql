-- Private deposit delivery verification (2026-08-06 incident).
--
-- tryDeliverBurnerBalance() (private-balance-processor.service.ts) was marking a deposit
-- 'complete' as soon as the burner -> MagicBlock transaction confirmed on-chain. Confirmed via
-- direct on-chain inspection that this transaction only deposits into MagicBlock's own queued
-- delivery system (its logs: "Instruction: DepositAndDelegateShuttleEphemeralAtaWithMergeAndPrivateTransfer",
-- "queue=..."), NOT the user's wallet directly — the actual delivery lands 1-10 minutes later via
-- one or more separate "ExecuteReadyQueuedTransfer" instructions MagicBlock's own relay submits.
-- So the app could tell a user "funds have landed in your balance" minutes before they actually had.
--
-- These columns let the cron defer 'complete' until it observes the user's wallet balance actually
-- increase by the expected amount, instead of trusting the first on-chain hop alone.

alter table public.private_transfers add column if not exists delivery_hop1_confirmed_at timestamptz;
alter table public.private_transfers add column if not exists delivery_expected_usdc numeric(20, 6);
alter table public.private_transfers add column if not exists delivery_baseline_usdc numeric(20, 6);
