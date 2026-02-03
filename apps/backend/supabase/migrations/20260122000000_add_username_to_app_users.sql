-- Add username field to app_users table
-- Username must be unique and is set during user onboarding
-- 
-- Migration: 20260122000000_add_username_to_app_users
-- Created: 2026-01-22
-- Related: Solana privacy architecture revamp

-- Add username column (idempotent - safe to run multiple times)
ALTER TABLE public.app_users 
  ADD COLUMN IF NOT EXISTS username TEXT;

-- Add unique constraint (idempotent)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conrelid = 'public.app_users'::regclass 
    AND contype = 'u' 
    AND conname = 'app_users_username_key'
  ) THEN
    ALTER TABLE public.app_users 
      ADD CONSTRAINT app_users_username_key UNIQUE (username);
  END IF;
END $$;

-- Create index for username lookups (idempotent)
CREATE INDEX IF NOT EXISTS idx_app_users_username ON public.app_users(username);

-- Add comment
COMMENT ON COLUMN public.app_users.username IS 'Unique username chosen by user during onboarding';
