-- Add loo_username (permanent backup) and twitter_username (stored handle) to app_users.
-- loo_username: always starts with "loo-", auto-generated, never changes.
-- twitter_username: the user's Twitter/X handle when they have one linked.
-- username: remains the active payment link (user can switch between loo and twitter).

ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS loo_username text,
  ADD COLUMN IF NOT EXISTS twitter_username text;

-- Unique index on loo_username (nullable — not all rows filled immediately)
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_loo_username
  ON public.app_users(loo_username)
  WHERE loo_username IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_app_users_twitter_username
  ON public.app_users(twitter_username)
  WHERE twitter_username IS NOT NULL;

-- Backfill loo_username for existing users:
-- Users whose username already starts with "loo-" → that IS their loo_username.
-- Users with a plain username (e.g. "looftaxyz") → generate "loo-{username[0..15]}",
--   appending a counter if there's a uniqueness conflict.
DO $$
DECLARE
  rec   RECORD;
  base  text;
  candidate text;
  counter int;
BEGIN
  FOR rec IN
    SELECT id, username FROM public.app_users
    WHERE username IS NOT NULL AND loo_username IS NULL
    ORDER BY created_at ASC
  LOOP
    IF rec.username LIKE 'loo-%' THEN
      -- Already a loo-username; use it directly
      candidate := rec.username;
    ELSE
      base := 'loo-' || left(rec.username, 16);
      candidate := base;
      counter := 2;
      -- Check against BOTH loo_username and username columns so the generated value
      -- is safe to use as an active username without hitting the unique constraint.
      -- Candidate format: loo-{handle_truncated}{counter} always ≤ 20 chars total
      -- (4 for "loo-" + up to 16 suffix chars including the counter digits).
      WHILE EXISTS (
        SELECT 1 FROM public.app_users
        WHERE id <> rec.id
          AND (loo_username = candidate OR username = candidate)
      ) LOOP
        -- Truncate handle portion to leave room for counter digits so suffix ≤ 16 chars
        candidate := 'loo-' || left(rec.username, 16 - length(counter::text)) || counter::text;
        counter := counter + 1;
      END LOOP;
    END IF;

    UPDATE public.app_users
    SET loo_username = candidate
    WHERE id = rec.id;
  END LOOP;
END;
$$;

COMMENT ON COLUMN public.app_users.loo_username IS
  'Permanent backup username always starting with loo-. Guaranteed unique. Never changes.';
COMMENT ON COLUMN public.app_users.twitter_username IS
  'Twitter/X handle (without @) stored when user links their Twitter account. Kept even after Twitter is unlinked so we can restore it.';

-- Backfill twitter_username for existing users whose active username is not a loo- username.
-- Assumption: if a user set a non-loo username during onboarding, it came from their Twitter handle.
-- Safe to run multiple times (WHERE twitter_username IS NULL guard).
UPDATE public.app_users
SET twitter_username = username
WHERE username IS NOT NULL
  AND username NOT LIKE 'loo-%'
  AND twitter_username IS NULL;
