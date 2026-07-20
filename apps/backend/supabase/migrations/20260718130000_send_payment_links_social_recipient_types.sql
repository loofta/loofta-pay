-- Widen send_payment_links.recipient_type to allow Discord/GitHub/Telegram, matching the
-- social_accounts-backed platforms already supported by the claims module (createFromSocial).
ALTER TABLE public.send_payment_links DROP CONSTRAINT IF EXISTS send_payment_links_recipient_type_check;
ALTER TABLE public.send_payment_links ADD CONSTRAINT send_payment_links_recipient_type_check
  CHECK (recipient_type IN ('email', 'twitter', 'username', 'discord', 'github', 'telegram'));
