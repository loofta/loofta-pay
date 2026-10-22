-- Getting money back from the Telegram bot: a payment sent as a claim link that the recipient never
-- claimed can be reclaimed by the sender for a $0.05 fee. reclaim_state is the lock that makes a
-- double tap impossible: NULL -> 'processing' is atomic, 'done' once the money is back.
ALTER TABLE public.telegram_bot_actions
  ADD COLUMN IF NOT EXISTS reclaim_state TEXT CHECK (reclaim_state IN ('processing','done')),
  ADD COLUMN IF NOT EXISTS reclaimed_at  TIMESTAMPTZ;
