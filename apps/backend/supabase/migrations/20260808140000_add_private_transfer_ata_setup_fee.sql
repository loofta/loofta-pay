-- Private withdrawal: destination-token-account setup fee.
--
-- Leg 2 (burner -> destination, PrivateBalanceProcessorService) creates the destination's USDC
-- account when it has never held USDC, and its ~0.00204 SOL rent came out of the fee payer with
-- nothing recovering it — unlike the regular withdrawal path, which charges the user for it. On a
-- $1 private withdrawal Loofta collected ~$0.001 (its 10 bps) while paying ~$0.15 of rent.
--
-- The fee is quoted at build time (so it can be shown in the confirmation before signing) but
-- collected at sweep time, minutes later. Storing it here rather than re-quoting in the processor
-- guarantees the user is charged exactly what they were shown, regardless of SOL price movement
-- in between. NULL / 0 means no account creation was needed — the common case.
alter table public.private_transfers
  add column if not exists ata_setup_fee_usdc numeric(20,6);

comment on column public.private_transfers.ata_setup_fee_usdc is
  'USDC quoted at build time to cover the destination token account rent on leg 2, deducted from the delivered amount. NULL/0 when the destination already had a USDC account.';
