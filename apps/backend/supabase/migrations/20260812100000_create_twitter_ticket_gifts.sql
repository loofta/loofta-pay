-- twitter_ticket_gifts: bot-created records for "@looftapay gift N tickets to @handle" tweets,
-- mirroring twitter_payment_requests' shape but for Megapot ticket gifts instead of USDC
-- payments. The actual gift/purchase machinery is unchanged — this just tracks which tweet
-- triggered which lottery_gifts row, for the bot's own dedup/rate-limiting/reply-link needs.
CREATE TABLE IF NOT EXISTS public.twitter_ticket_gifts (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  short_id          TEXT        UNIQUE NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sender_twitter    TEXT        NOT NULL,   -- normalised: lowercase, no leading @
  recipient_twitter TEXT        NOT NULL,   -- normalised: lowercase, no leading @
  num_tickets       INT         NOT NULL CHECK (num_tickets BETWEEN 1 AND 100),
  tweet_id          TEXT        UNIQUE,     -- source tweet; NULL for manually created
  tweet_url         TEXT,
  is_devnet         BOOLEAN     NOT NULL DEFAULT FALSE,
  integrator_id     UUID        REFERENCES public.integrators(id),
  gift_id           UUID        REFERENCES public.lottery_gifts(id),
  -- Whether the recipient was already a registered Loofta user at gift time (tickets bought
  -- instantly, no claim needed) vs. a claim-link gift (bot replies with the existing
  -- pay.loofta.xyz/gift/:shortId claim page instead of a /tw/:short_id confirmation).
  delivered_instantly BOOLEAN   NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS twitter_ticket_gifts_short_id_idx ON public.twitter_ticket_gifts (short_id);
CREATE INDEX IF NOT EXISTS twitter_ticket_gifts_created_at_idx ON public.twitter_ticket_gifts (created_at DESC) WHERE tweet_id IS NOT NULL;

ALTER TABLE public.twitter_ticket_gifts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_twitter_ticket_gifts ON public.twitter_ticket_gifts;
CREATE POLICY deny_all_twitter_ticket_gifts ON public.twitter_ticket_gifts FOR ALL USING (false) WITH CHECK (false);
