-- Private payments from the Telegram bot: remember the chosen options on the pending action so the
-- Confirm tap executes exactly what the card showed.
ALTER TABLE public.telegram_bot_actions
  ADD COLUMN IF NOT EXISTS is_private            BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS private_split         INTEGER CHECK (private_split BETWEEN 1 AND 15),   -- NULL = random
  ADD COLUMN IF NOT EXISTS private_max_delay_ms  BIGINT  CHECK (private_max_delay_ms > 0);         -- NULL = default 10 min
