-- Token prizes: the giveaway burner is still funded in USDC (`mint` stays the USDC mint,
-- so funding detection and the $5 platform fee are unchanged). `prize_mint` is the SPL token
-- Jupiter swaps the prize pool into once funding lands. Winners are paid that token.
-- Null prize_mint means a plain USDC (or Megapot) giveaway.

alter table public.giveaways
  add column if not exists prize_mint text,
  add column if not exists prize_token_symbol text,
  add column if not exists prize_token_name text,
  add column if not exists prize_token_logo text,
  add column if not exists prize_token_decimals integer,
  add column if not exists prize_token_program text,
  add column if not exists prize_token_base_units text,
  add column if not exists prize_swap_tx text;

-- Claim payments that deliver a non-USDC SPL token. solana_mint null keeps the USDC sweep.
alter table public.payments
  add column if not exists solana_mint text,
  add column if not exists token_decimals integer,
  add column if not exists token_amount text,
  add column if not exists token_base_units text,
  add column if not exists token_program text;

-- giveaways_safe is an explicit column list. Recreate it so public pages can show the token.
DROP VIEW IF EXISTS public.giveaways_safe;
CREATE VIEW public.giveaways_safe AS
SELECT
  id,
  created_at,
  updated_at,
  created_by,
  title,
  description,
  logo_url,
  project_name,
  short_id,
  winner_count,
  selection_mode,
  prize_amount_usd,
  reward_type,
  prize_mint,
  prize_token_symbol,
  prize_token_name,
  prize_token_logo,
  prize_token_decimals,
  prize_token_program,
  prize_token_base_units,
  entries_close_at,
  eligibility,
  burner_address,
  mint,
  is_devnet,
  funding_required_usd,
  funding_confirmed_usd,
  platform_fee_usd,
  burner_reclaimed_at,
  vrf_request_slot,
  vrf_randomness,
  vrf_requested_at,
  vrf_fulfilled_at,
  entry_snapshot_hash,
  admin_reviewed_by,
  admin_reviewed_at,
  rejection_reason,
  cancel_reason,
  is_official,
  status
FROM public.giveaways;
ALTER VIEW public.giveaways_safe SET (security_invoker = true);
