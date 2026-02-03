-- Add description column to claims table
-- This field allows users to add emojis, GIFs, and messages to payment requests (Revolut-style)
-- 
-- Migration: 20260127000000_add_description_to_claims
-- Created: 2026-01-27
-- Related: Payment link description feature

-- Add description column (idempotent - safe to run multiple times)
ALTER TABLE public.claims 
  ADD COLUMN IF NOT EXISTS description TEXT NULL;

-- Add index for querying claims by description (if needed for search)
CREATE INDEX IF NOT EXISTS claims_description_idx ON public.claims (description) WHERE description IS NOT NULL;

-- Add comment
COMMENT ON COLUMN public.claims.description IS 'User-provided description/message for the payment request. Supports emojis and can include GIF URLs.';
