-- 20260914090000_create_nest_tables.sql was hand-edited after it had already been pushed, so
-- `supabase db push` silently skipped the added columns (it tracks applied migrations by
-- timestamp, not content). This is the real incremental migration for those two columns.

ALTER TABLE nest_profiles
  ADD COLUMN IF NOT EXISTS display_name TEXT;

ALTER TABLE nest_deposits
  ADD COLUMN IF NOT EXISTS network TEXT NOT NULL DEFAULT 'mainnet' CHECK (network IN ('mainnet', 'devnet'));
