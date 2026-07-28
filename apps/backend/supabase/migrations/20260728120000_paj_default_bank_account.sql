-- PAJ Cash: default bank account (abstracted wallet address) + Loofta fee tracking on
-- both Naira exit paths ("claim in Naira" direct sweep, and the existing manual off-ramp).

alter table public.paj_cash_bank_accounts
  add column if not exists wallet_address text,
  add column if not exists is_default boolean not null default false;

-- Enforces a single default bank account per user at the DB level.
create unique index if not exists paj_cash_bank_accounts_one_default_per_user
  on public.paj_cash_bank_accounts (user_id) where is_default;

alter table public.paj_cash_orders
  add column if not exists loofta_fee_usdc numeric(20,6);

-- Records that a claim was routed to Naira instead of a wallet, and which bank account /
-- Loofta fee applied — this path bypasses PAJ order creation entirely (direct on-chain
-- sweep to the bank account's abstracted wallet_address), so nothing else records it.
alter table public.payments
  add column if not exists naira_claim_bank_account_id uuid references public.paj_cash_bank_accounts(id),
  add column if not exists naira_claim_fee_usdc numeric(20,6);
