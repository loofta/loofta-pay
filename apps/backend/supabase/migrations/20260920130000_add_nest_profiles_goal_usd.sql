-- "Hatching" goal: a user-named dollar target for the nest. Progress toward it (deposited so
-- far / goal) is what the dashboard celebrates — funding milestones, never P&L or trades.
ALTER TABLE nest_profiles
  ADD COLUMN IF NOT EXISTS goal_usd NUMERIC(18, 2) CHECK (goal_usd IS NULL OR goal_usd > 0);
