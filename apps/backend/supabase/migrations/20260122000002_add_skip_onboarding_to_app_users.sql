-- Add skip_onboarding field to app_users table
-- This field tracks whether the user has opted out of the welcome onboarding modal
-- 
-- Migration: 20260122000002_add_skip_onboarding_to_app_users
-- Created: 2026-01-22
-- Related: Welcome onboarding modal preference

-- Add skip_onboarding column (idempotent - safe to run multiple times)
ALTER TABLE public.app_users 
  ADD COLUMN IF NOT EXISTS skip_onboarding BOOLEAN NOT NULL DEFAULT false;

-- Add comment
COMMENT ON COLUMN public.app_users.skip_onboarding IS 'If true, user has opted out of the welcome onboarding modal';
