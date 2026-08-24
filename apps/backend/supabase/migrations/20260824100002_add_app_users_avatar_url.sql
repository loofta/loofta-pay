-- Persists the X/Twitter profile picture URL for a linked account, captured alongside
-- twitter_username in save-twitter-username (Privy-verified, never client-supplied). Used to
-- replace letter-avatar fallbacks (gift claim page, profile page) with a real picture.
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS avatar_url text;
