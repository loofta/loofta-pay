-- @looftapay_bot: pay from Telegram chat. Reuses twitter_autopay_enrollments (limits, terms,
-- Privy signer grant), so enrollment no longer requires a linked X account.
ALTER TABLE public.twitter_autopay_enrollments ALTER COLUMN twitter_handle DROP NOT NULL;

-- Everyone who has pressed Start. Telegram only lets a bot message a user after this, and the
-- chat_id is what we DM payment notifications to.
CREATE TABLE IF NOT EXISTS public.telegram_bot_users (
  telegram_user_id BIGINT PRIMARY KEY,
  chat_id          BIGINT NOT NULL,
  username         TEXT,                          -- lowercased, no @
  first_name       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS telegram_bot_users_username_idx ON public.telegram_bot_users (username);

-- One row per "send" command: starts pending with a Confirm card, ends paid/failed/cancelled.
-- Paid and processing rows also feed the daily spend cap in TwitterAutopayService.assertWithinLimits.
CREATE TABLE IF NOT EXISTS public.telegram_bot_actions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at         TIMESTAMPTZ NOT NULL,
  telegram_user_id   BIGINT NOT NULL,
  privy_user_id      TEXT NOT NULL,
  chat_id            BIGINT NOT NULL,
  recipient_handle   TEXT NOT NULL,               -- lowercased, no @
  amount_usd         NUMERIC(12,2) NOT NULL CHECK (amount_usd > 0),
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','processing','paid','failed','cancelled','expired')),
  payment_id         TEXT,
  claim_link         TEXT,
  error              TEXT,
  paid_at            TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS telegram_bot_actions_spend_idx
ON public.telegram_bot_actions (privy_user_id, created_at) WHERE status IN ('paid','processing');
CREATE INDEX IF NOT EXISTS telegram_bot_actions_user_idx
ON public.telegram_bot_actions (telegram_user_id, created_at DESC);

-- Telegram retries a webhook until it gets a 200; this makes each update run once.
CREATE TABLE IF NOT EXISTS public.telegram_bot_updates (
  update_id  BIGINT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.telegram_bot_users   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_bot_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_bot_updates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_telegram_bot_users ON public.telegram_bot_users;
DROP POLICY IF EXISTS deny_all_telegram_bot_actions ON public.telegram_bot_actions;
DROP POLICY IF EXISTS deny_all_telegram_bot_updates ON public.telegram_bot_updates;
CREATE POLICY deny_all_telegram_bot_users   ON public.telegram_bot_users   FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY deny_all_telegram_bot_actions ON public.telegram_bot_actions FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY deny_all_telegram_bot_updates ON public.telegram_bot_updates FOR ALL USING (false) WITH CHECK (false);
REVOKE ALL ON public.telegram_bot_users, public.telegram_bot_actions, public.telegram_bot_updates FROM anon, authenticated;
