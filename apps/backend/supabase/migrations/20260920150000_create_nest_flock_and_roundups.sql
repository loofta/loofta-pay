-- Round-ups ("crumbs"): opt-in per profile. Each payment the user SENDS through Loofta is
-- rounded up to the next roundup_unit dollars; the difference accumulates as pending crumbs
-- until the user feeds the nest with a normal (self-signed) deposit, at which point
-- roundups_swept_at advances. Nothing moves money automatically.
ALTER TABLE nest_profiles
  ADD COLUMN IF NOT EXISTS roundup_unit NUMERIC(6, 2) CHECK (roundup_unit IS NULL OR roundup_unit > 0),
  ADD COLUMN IF NOT EXISTS roundups_swept_at TIMESTAMPTZ,
  -- Flock visibility: only profiles that opted in can be followed / viewed. Off by default.
  ADD COLUMN IF NOT EXISTS flock_public BOOLEAN NOT NULL DEFAULT FALSE;

-- Flock: follows and one-kudos-per-day. Keyed by the REAL Privy user id (not the demo-suffixed
-- ledger id) so the social graph is the same person regardless of which ledger they're on;
-- the ledger is resolved per request when reading a followee's nest.
CREATE TABLE IF NOT EXISTS nest_flock_follows (
  follower_user_id  TEXT NOT NULL,
  followee_user_id  TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_user_id, followee_user_id),
  CHECK (follower_user_id <> followee_user_id)
);
CREATE INDEX IF NOT EXISTS nest_flock_follows_followee_idx ON nest_flock_follows(followee_user_id);

CREATE TABLE IF NOT EXISTS nest_flock_kudos (
  from_user_id  TEXT NOT NULL,
  to_user_id    TEXT NOT NULL,
  day           DATE NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (from_user_id, to_user_id, day),
  CHECK (from_user_id <> to_user_id)
);
CREATE INDEX IF NOT EXISTS nest_flock_kudos_to_idx ON nest_flock_kudos(to_user_id);

-- Security: all access goes through service-role API routes
ALTER TABLE public.nest_flock_follows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nest_flock_follows FROM anon, authenticated;
ALTER TABLE public.nest_flock_kudos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nest_flock_kudos FROM anon, authenticated;
