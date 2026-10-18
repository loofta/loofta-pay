-- /logout in @looftapay_bot. Privy can only unlink a Telegram account if the user has at least one
-- other login method, so when unlike succeeds the bot forgets the user through Privy itself and
-- nothing is needed here. When Telegram is the user's only login method, Privy refuses the unlink
-- and the bot falls back to a local sign-out: this timestamp makes the bot stop acting for that
-- Telegram user until they sign back in on /app/auto-pay (see TelegramBotService.resolveLinkedUser).
ALTER TABLE public.telegram_bot_users
  ADD COLUMN IF NOT EXISTS signed_out_at TIMESTAMPTZ;
