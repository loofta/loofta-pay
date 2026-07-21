-- 'instagram' is now a writable platform (see save-social-handle route) but the original CHECK
-- from 20260718120000_create_social_accounts.sql only allowed discord/github/telegram — every
-- Instagram upsert would violate this constraint. Widen it.
ALTER TABLE public.social_accounts DROP CONSTRAINT IF EXISTS social_accounts_platform_check;
ALTER TABLE public.social_accounts ADD CONSTRAINT social_accounts_platform_check
  CHECK (platform IN ('discord', 'github', 'telegram', 'instagram'));

-- Nothing enforced (platform, handle) uniqueness — every write path (save-social-handle,
-- telegram-relay/complete, telegram-relay/attach-verified) only ever upserted on (user_id,
-- platform), so the same handle (most exploitably Telegram, which bypasses Privy's own
-- linked-account uniqueness entirely) could be attached to more than one Loofta account. This is
-- the actual source of truth for that guarantee — the application-level pre-check added alongside
-- this migration is only a friendlier error message; a race between two concurrent link attempts
-- can only be stopped here.
-- NOTE: if any duplicate (platform, handle) rows already exist in production, this migration will
-- fail to apply — those rows must be deduplicated (keep the more recent one) before retrying.
DROP INDEX IF EXISTS social_accounts_platform_handle_idx;
CREATE UNIQUE INDEX IF NOT EXISTS social_accounts_platform_handle_unique ON public.social_accounts (platform, handle);
