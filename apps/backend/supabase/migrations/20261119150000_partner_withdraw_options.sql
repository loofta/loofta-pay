-- Per-partner control over the recipient withdraw page.
-- show_history: recipients can see the payouts they already received from this partner.
-- disabled_withdraw_methods: cash-out routes the partner switched off. Empty = everything on (the default).
ALTER TABLE partners
  ADD COLUMN IF NOT EXISTS show_history BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS disabled_withdraw_methods TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE partners
  DROP CONSTRAINT IF EXISTS partners_disabled_withdraw_methods_check;
ALTER TABLE partners
  ADD CONSTRAINT partners_disabled_withdraw_methods_check
  CHECK (disabled_withdraw_methods <@ ARRAY['usdc','token','bank','p2p']::text[] AND cardinality(disabled_withdraw_methods) < 4);
