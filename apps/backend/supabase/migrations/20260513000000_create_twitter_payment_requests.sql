-- twitter_payment_requests: ephemeral records created by the @looftabot Twitter bot
-- before the sender has authenticated. Once the sender logs in and funds, a real
-- payments row is created and this record is linked to it.

CREATE TABLE public.twitter_payment_requests (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  short_id        TEXT        UNIQUE NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sender_twitter  TEXT        NOT NULL,   -- normalised: lowercase, no leading @
  recipient_twitter TEXT      NOT NULL,   -- normalised: lowercase, no leading @
  amount_usd      NUMERIC(10,2) NOT NULL CHECK (amount_usd > 0),
  tweet_id        TEXT        UNIQUE,     -- source tweet; NULL for manually created
  tweet_url       TEXT,
  status          TEXT        NOT NULL DEFAULT 'pending_funding'
                              CHECK (status IN ('pending_funding','funded','expired','cancelled')),
  payment_id      UUID        REFERENCES public.payments(id),
  bot_reply_tweet_id TEXT,               -- bot's reply tweet ID (for threading follow-ups)
  is_devnet       BOOLEAN     NOT NULL DEFAULT FALSE,
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days')
);

CREATE INDEX twitter_payment_requests_short_id_idx ON public.twitter_payment_requests (short_id);
CREATE INDEX twitter_payment_requests_status_idx   ON public.twitter_payment_requests (status);
CREATE INDEX twitter_payment_requests_expires_idx  ON public.twitter_payment_requests (expires_at)
  WHERE status = 'pending_funding';
