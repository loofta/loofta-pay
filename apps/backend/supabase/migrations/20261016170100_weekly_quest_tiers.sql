-- Weekly quest v2: awards happen once the week has ended, and the number of free entries scales with
-- volume (one per full multiple of the target), capped per user. Also tracks whether the user has seen
-- the "you received X entries" toast.
ALTER TABLE weekly_quest_settings ADD COLUMN IF NOT EXISTS max_tickets_per_winner INT NOT NULL DEFAULT 5 CHECK (max_tickets_per_winner BETWEEN 1 AND 50);
ALTER TABLE weekly_quest_awards ADD COLUMN IF NOT EXISTS seen_at TIMESTAMPTZ;
ALTER TABLE weekly_quest_awards DROP CONSTRAINT IF EXISTS weekly_quest_awards_tickets_check;
