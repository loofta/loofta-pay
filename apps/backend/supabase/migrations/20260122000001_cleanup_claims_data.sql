-- Cleanup Migration: Remove all claims data for Solana privacy revamp
-- ⚠️ WARNING: This deletes ALL claims data. Only run on local database!
-- 
-- Purpose: Clean slate for new Solana privacy-first architecture
-- - Removes old claims with recipient_address stored in database
-- - Prepares for new system using Privy user ID lookup only
-- 
-- Created: 2026-01-22 (using future date to avoid conflicts)
-- Related: Solana privacy architecture revamp

-- Delete all claim events (event logs for claims)
-- These cascade from claims, but explicit deletion for clarity
DELETE FROM public.claim_events;

-- Delete all claim intents (deposit addresses, quotes, status)
-- These cascade from claims, but explicit deletion for clarity
DELETE FROM public.claim_intents;

-- Delete all claims (payment requests)
-- This is the main cleanup - removes all payment link data
DELETE FROM public.claims;

-- Optional: Clear app_users if you want fresh users too
-- Uncomment the line below if you want to start with completely fresh users
-- DELETE FROM public.app_users;

-- Note: Table structures remain intact, only data is deleted
-- This allows you to start fresh with the new Solana privacy architecture
