-- Persists whether a user signed up via the Seeker/Mobile Wallet Adapter (wallet_client_type
-- 'seed_vault' or connector_type 'solana_mobile_wallet_adapter' on their Privy SIWS wallet
-- account), so this is a real queryable column instead of only being inferred from the
-- generated skr-xxxxxx username at signup time (see UsersService.ensureAppUser).
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS is_seeker_wallet boolean NOT NULL DEFAULT false;

-- Backfill existing Seeker-only signups, identifiable by the loo-skr-xxxxxx username fallback
-- ensureAppUser generates for wallet-only accounts with no email/Twitter (see looHandle logic).
UPDATE public.app_users
  SET is_seeker_wallet = true
  WHERE loo_username LIKE 'loo-skr-%';
