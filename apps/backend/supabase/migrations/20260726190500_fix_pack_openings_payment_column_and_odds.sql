-- Re-applies changes that were made to 20260726140000_create_pack_tables.sql AFTER it may have
-- already been pushed once. Supabase's migration tracking is keyed by version/filename, not
-- content — editing an already-applied migration file is silently skipped on a later `db push`.
-- This is a brand-new version, so it's guaranteed to actually run.

ALTER TABLE pack_openings ADD COLUMN IF NOT EXISTS payment_tx_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS pack_openings_payment_tx_hash_uq
  ON pack_openings (payment_tx_hash) WHERE payment_tx_hash IS NOT NULL;

-- Force-correct the odds table to the latest published numbers (43% / 50% / 1-in-18 / 1-in-85 /
-- 1-in-400 / 1-in-1,600) in case the original migration's INSERT ... ON CONFLICT DO NOTHING
-- already ran once with the earlier placeholder values — UPDATE (not INSERT) so it corrects
-- existing rows regardless of what they currently hold. `enabled` is untouched on purpose: if
-- you've already flipped a tier on/off via the admin toggle, this must not revert that.
UPDATE pack_tiers SET weight = 0.4300000000, tickets_awarded = 1,   rarity = 'common'   WHERE tier_key = '1';
UPDATE pack_tiers SET weight = 0.5000000000, tickets_awarded = 2,   rarity = 'common'   WHERE tier_key = '2';
UPDATE pack_tiers SET weight = 0.0555555556, tickets_awarded = 5,   rarity = 'uncommon' WHERE tier_key = '5';
UPDATE pack_tiers SET weight = 0.0117647059, tickets_awarded = 10,  rarity = 'uncommon' WHERE tier_key = '10';
UPDATE pack_tiers SET weight = 0.0025000000, tickets_awarded = 50,  rarity = 'rare'     WHERE tier_key = '50';
UPDATE pack_tiers SET weight = 0.0006250000, tickets_awarded = 100, rarity = 'epic'     WHERE tier_key = '100';
