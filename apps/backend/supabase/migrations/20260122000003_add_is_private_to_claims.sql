-- Add is_private column to claims table
-- This field tracks whether a payment claim is a private payment using Privacy Cash
-- 
-- Migration: 20260122000003_add_is_private_to_claims
-- Created: 2026-01-22
-- Related: Private payment functionality with Privacy Cash

-- Add is_private column (idempotent - safe to run multiple times)
ALTER TABLE public.claims 
  ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT false;

-- Add index for querying private claims
CREATE INDEX IF NOT EXISTS claims_is_private_idx ON public.claims (is_private);

-- Add comment
COMMENT ON COLUMN public.claims.is_private IS 'If true, this is a private payment using Privacy Cash (payer and payee addresses are hidden)';
