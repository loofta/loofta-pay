-- Drops the legacy claims/claim_intents/claim_events tables, superseded by payments/payment_intents
-- (migration 20260423200000_create_payments_tables_and_migrate_claims.sql).
--
-- Verified safe before applying (2026-08-04):
--   - claims: 336 rows total, all now terminal (SUCCESS/DELETED/CANCELLED/EXPIRED). The 215
--     remaining OPEN rows were expired via direct UPDATE before this migration was written; a
--     full backup of all 336 rows was taken first (see project memory).
--   - claim_intents: 0 rows, nothing writes to it.
--   - claim_events: 0 rows, nothing writes to it (its only writer, claims.service.ts's
--     updateStatus, was removed in the same change as this migration).
--   - No code references these tables anymore (claims.service.ts's fetchRawRow/updateRow,
--     solana-sponsor.service.ts's intent-binding fallback, and every frontend route that read
--     from them were all simplified to payments-only in the same change).
--
-- public_claims / claims_safe (added by 20260325123000_fix_supabase_security_lints.sql and
-- 20260428000000_fix_security_lints.sql as anon-safe read views) also depend on claims and are
-- never queried by any app code (grepped both apps/backend/src and apps/frontend/src) — dropped
-- alongside it.
--
-- Order matters: claim_intents and claim_events both FK-reference claims(id) ON DELETE CASCADE,
-- and the two views SELECT from claims — all dropped before claims itself for clarity even
-- though CASCADE would handle the FK-dependent tables either way.
drop table if exists public.claim_intents;
drop table if exists public.claim_events;
drop view if exists public.public_claims;
drop view if exists public.claims_safe;
drop table if exists public.claims;
