-- Add require_private_payments column to app_users table
-- This field allows users to enforce that all payments to their username link must use Privacy Cash
-- 
-- Migration: 20260127000001_add_require_private_payments_to_app_users
-- Created: 2026-01-27
-- Related: Privacy payment preferences and user settings

-- Add require_private_payments column (idempotent - safe to run multiple times)
ALTER TABLE public.app_users 
  ADD COLUMN IF NOT EXISTS require_private_payments BOOLEAN NOT NULL DEFAULT false;

-- Create index for privacy preference lookups (idempotent)
CREATE INDEX IF NOT EXISTS idx_app_users_require_private_payments ON public.app_users(require_private_payments);

-- Add comment
COMMENT ON COLUMN public.app_users.require_private_payments IS 
  'If true, all payments to this user via username link must use Privacy Cash (private payments only). Recipient will be charged fees: 0.35% + $0.74';
