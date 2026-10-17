-- Pay up to 5 people in one message: every recipient is its own row (own payment, own status,
-- own link), tied together by a batch id so one Confirm tap runs them all.
ALTER TABLE public.telegram_bot_actions ADD COLUMN IF NOT EXISTS batch_id UUID;
CREATE INDEX IF NOT EXISTS telegram_bot_actions_batch_idx ON public.telegram_bot_actions (batch_id) WHERE batch_id IS NOT NULL;
