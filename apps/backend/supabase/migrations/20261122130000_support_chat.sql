-- Withdraw-page support chat. One thread per signed-in user. Messages come from the person, the bot, or a Loofta
-- agent answering from Telegram. Everything goes through service-role API routes.
CREATE TABLE IF NOT EXISTS support_threads (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL UNIQUE,
  email       TEXT,
  org_id      TEXT,
  -- 'human' while an agent is on the conversation: the person's messages go straight to Telegram.
  mode        TEXT NOT NULL DEFAULT 'bot' CHECK (mode IN ('bot', 'human')),
  human_until TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS support_messages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id           UUID NOT NULL REFERENCES support_threads(id) ON DELETE CASCADE,
  sender              TEXT NOT NULL CHECK (sender IN ('user', 'bot', 'agent')),
  body                TEXT NOT NULL,
  telegram_message_id BIGINT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS support_messages_thread_idx ON support_messages (thread_id, created_at);
CREATE INDEX IF NOT EXISTS support_messages_tg_idx ON support_messages (telegram_message_id) WHERE telegram_message_id IS NOT NULL;

ALTER TABLE public.support_threads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_threads FROM anon, authenticated;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_messages FROM anon, authenticated;
