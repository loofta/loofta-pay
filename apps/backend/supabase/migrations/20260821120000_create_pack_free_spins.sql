-- Admin-granted free Mystery Pack spins: a distinct entitlement record (like lottery_gifts is to
-- lottery_tickets) separate from its eventual consumption in pack_openings. A free spin still
-- rolls the real tier ladder and awards a real Megapot ticket funded from the treasury — it is
-- NOT the same thing as a demo/test open (pack_openings.is_test), which never buys a real ticket.
CREATE TABLE IF NOT EXISTS pack_free_spins (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            TEXT NOT NULL,
  granted_by_admin_id TEXT NOT NULL,
  note               TEXT,
  status             TEXT NOT NULL DEFAULT 'unclaimed' CHECK (status IN ('unclaimed', 'consumed', 'cancelled')),
  pack_opening_id    UUID REFERENCES pack_openings(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at        TIMESTAMPTZ
);

-- Looked up on every "does this user have a free spin" check (GET /packs/my-status) and when
-- claiming one (oldest-unclaimed-first) — see PackService.openPackWithFreeSpin.
CREATE INDEX IF NOT EXISTS pack_free_spins_user_status_idx ON pack_free_spins(user_id, status);

-- Lets the admin openings list (PackService.getAdminOpenings) show a "free spin" badge without a
-- join back to pack_free_spins.
ALTER TABLE pack_openings ADD COLUMN IF NOT EXISTS free_spin_id UUID REFERENCES pack_free_spins(id);

-- Security: all access goes through service-role API routes
ALTER TABLE public.pack_free_spins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pack_free_spins FROM anon, authenticated;
