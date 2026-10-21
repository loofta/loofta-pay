-- Custom (non-money) prizes, e.g. an event ticket. Nothing is escrowed: the creator pays only the
-- $5 listing fee and hands the prize to the winners themselves.
ALTER TABLE public.giveaways DROP CONSTRAINT IF EXISTS giveaways_reward_type_check;
ALTER TABLE public.giveaways
  ADD CONSTRAINT giveaways_reward_type_check CHECK (reward_type IN ('usdc', 'megapot_ticket', 'custom'));
ALTER TABLE public.giveaways ADD COLUMN IF NOT EXISTS custom_prize_text TEXT;

-- giveaways_safe is an explicit column list; expose the prize text on public pages.
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
  custom_prize_text,
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
