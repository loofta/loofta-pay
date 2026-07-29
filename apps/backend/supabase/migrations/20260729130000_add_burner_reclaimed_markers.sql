-- Rent-recovery markers for single-use burner wallets (2026-07-29 rent audit).
--
-- Every burner's USDC token account holds ~0.00203928 SOL of rent that only comes back via an
-- explicit closeAccount. The audit found withdrawal burners (59%), private-balance burners (39%)
-- and claim burners (11%) leaking that rent permanently. Inline closeAccount instructions now
-- recover it on the happy paths; these columns let the per-module GC crons (backstops) track
-- which terminal rows have already been reclaimed so they never re-scan the same burner.
--
-- lottery_tickets already has its own equivalent (burner_swept_at) — untouched here.

alter table public.lottery_withdrawals add column if not exists burner_reclaimed_at timestamptz;
alter table public.private_transfers   add column if not exists burner_reclaimed_at timestamptz;
alter table public.payments            add column if not exists burner_reclaimed_at timestamptz;

-- Partial indexes so each GC cron's "terminal + not yet reclaimed" scan stays cheap forever.
create index if not exists lottery_withdrawals_burner_unreclaimed_idx
  on public.lottery_withdrawals (created_at)
  where burner_reclaimed_at is null and status = 'complete' and withdrawal_burner_sol_address is not null;

create index if not exists private_transfers_burner_unreclaimed_idx
  on public.private_transfers (created_at)
  where burner_reclaimed_at is null and status = 'complete';

create index if not exists payments_burner_unreclaimed_idx
  on public.payments (created_at)
  where burner_reclaimed_at is null and burner_address is not null;
