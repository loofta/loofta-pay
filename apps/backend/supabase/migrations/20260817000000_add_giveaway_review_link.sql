-- Password-protected public review link — lets a creator hand task review to someone without a
-- Loofta account (a mod, a teammate). review_link_token is the unguessable part of the shared URL;
-- review_link_password_hash is an HMAC (never the raw password) checked at auth time. Regenerating
-- the link (GiveawaysService.generateReviewLink) overwrites all three, which invalidates the old
-- link/password immediately — there is deliberately only ever one live link per giveaway. RLS on
-- giveaways already denies all direct anon/authenticated access (see
-- 20260802150000_create_giveaways_tables.sql); only the backend's service-role client reads these,
-- and only the token (never the hash) ever reaches a client.
ALTER TABLE public.giveaways
  ADD COLUMN IF NOT EXISTS review_link_token TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS review_link_password_hash TEXT,
  ADD COLUMN IF NOT EXISTS review_link_created_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS giveaways_review_link_token_idx
  ON public.giveaways (review_link_token)
  WHERE review_link_token IS NOT NULL;
