-- Lets a giveaway prize be paid out as gifted Megapot tickets instead of a flat USDC claim link.
-- Default 'usdc' preserves today's behavior for every existing/unset giveaway.
ALTER TABLE public.giveaways
  ADD COLUMN IF NOT EXISTS reward_type text NOT NULL DEFAULT 'usdc'
    CHECK (reward_type IN ('usdc', 'megapot_ticket'));
