-- BalanceModal's 1-hour auto-cancel (patchDeposit(dep.id, { status: "cancelled" })) has always
-- violated this constraint since it only allowed ('pending','complete','failed') — every
-- auto-cancel attempt silently failed with a 500, leaving stale deposits stuck at 'pending' forever.
alter table public.user_deposits drop constraint if exists user_deposits_status_check;
alter table public.user_deposits add constraint user_deposits_status_check
  check (status in ('pending','complete','failed','cancelled'));
