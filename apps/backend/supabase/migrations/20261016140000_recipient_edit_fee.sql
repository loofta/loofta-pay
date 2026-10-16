-- Each sender "wrong recipient" correction costs 0.50 USDC. The fee accrues here and is taken
-- out of the payment into the Loofta fee wallet when the burner is swept to the recipient.
alter table public.payments
  add column if not exists recipient_edit_fee_usdc numeric(20,6) not null default 0;
