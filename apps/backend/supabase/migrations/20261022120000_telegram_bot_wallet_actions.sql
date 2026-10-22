-- Deposits, withdrawals and other wallet actions from the Telegram bot share telegram_bot_actions with
-- payments, so they get the same Confirm lock, daily-limit counting, repeat guard and "unconfirmed" handling.
-- recipient_handle holds 'wallet' for these rows; the destination lives in the new columns.
ALTER TABLE public.telegram_bot_actions
  ADD COLUMN IF NOT EXISTS kind                TEXT NOT NULL DEFAULT 'pay',
  ADD COLUMN IF NOT EXISTS destination_address TEXT,
  ADD COLUMN IF NOT EXISTS destination_chain   TEXT,
  ADD COLUMN IF NOT EXISTS destination_token   TEXT,
  ADD COLUMN IF NOT EXISTS quote_out           TEXT,     -- what the person was told they would receive
  ADD COLUMN IF NOT EXISTS order_id            TEXT,     -- near_intents_withdrawal_orders.id for cross-chain withdrawals
  ADD COLUMN IF NOT EXISTS tx_signature        TEXT;
ALTER TABLE public.telegram_bot_actions DROP CONSTRAINT IF EXISTS telegram_bot_actions_kind_check;
ALTER TABLE public.telegram_bot_actions
  ADD CONSTRAINT telegram_bot_actions_kind_check CHECK (kind IN ('pay', 'withdraw_sol', 'withdraw_near'));
CREATE INDEX IF NOT EXISTS telegram_bot_actions_kind_idx ON public.telegram_bot_actions (telegram_user_id, kind, created_at DESC);
