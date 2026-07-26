-- Mystery Pack feature: $2 pack opens that award 1-100 Megapot lottery tickets.
--
-- pack_tiers holds the full published odds table (see PackService.DEFAULT_TIERS for the
-- canonical seed values) plus an `enabled` flag. Disabling a tier does NOT change the other
-- tiers' weights or the odds shown in the UI — a disabled tier's roll simply falls back to the
-- next-lower enabled tier at draw time (see PackService.rollTier). This lets 50/100-ticket tiers
-- stay silently off at launch and be flipped on later with a single UPDATE, with zero visible
-- change to users and no other math to touch.
CREATE TABLE IF NOT EXISTS pack_tiers (
  tier_key text PRIMARY KEY,           -- '1' | '2' | '5' | '10' | '50' | '100'
  tickets_awarded int NOT NULL,
  weight numeric(12, 10) NOT NULL,     -- true probability (e.g. 0.6 = 60%, 1/22 = 0.04545454545...) — never sent to the client
  rarity text NOT NULL,                -- 'common' | 'uncommon' | 'rare' | 'epic'
  enabled boolean NOT NULL DEFAULT true,
  display_order int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO pack_tiers (tier_key, tickets_awarded, weight, rarity, enabled, display_order) VALUES
  ('1',   1,   0.4300000000,          'common',   true,  1),   -- 43%     — half the $2 back in ticket value
  ('2',   2,   0.5000000000,          'common',   true,  2),   -- 50%     — even
  ('5',   5,   0.0555555556,          'uncommon', true,  3),   -- 1 in 18  — 2.5x
  ('10',  10,  0.0117647059,          'uncommon', true,  4),   -- 1 in 85  — 5x
  ('50',  50,  0.0025000000,          'rare',     false, 5),   -- 1 in 400  — 25x
  ('100', 100, 0.0006250000,          'epic',     false, 6)    -- 1 in 1,600 — 50x
ON CONFLICT (tier_key) DO NOTHING;

-- pack_openings: one row per pack-open event. payment_tx_hash is the on-chain USDC transfer to
-- the treasury wallet that PackService.verifyPackPaymentOnChain checked before this row was
-- ever written — the partial unique index below is the replay-protection backstop (a race
-- between two concurrent requests reusing the same tx hash fails on whichever insert loses,
-- not just on an earlier read-then-check). lottery_ticket_id is filled in once packs actually
-- purchase real lottery tickets automatically (still design pending) — until then it stays null.
CREATE TABLE IF NOT EXISTS pack_openings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,

  tier_key text NOT NULL REFERENCES pack_tiers(tier_key),
  tickets_awarded int NOT NULL,
  rarity text NOT NULL,

  cost_usdc numeric(20, 6) NOT NULL DEFAULT 0,
  is_test boolean NOT NULL DEFAULT false,
  payment_tx_hash text,

  -- Populated once pack opens actually purchase real lottery tickets (see lottery_tickets).
  lottery_ticket_id uuid REFERENCES lottery_tickets(id),

  status text NOT NULL DEFAULT 'opened', -- 'opened' | 'charged' | 'fulfilled' | 'failed'

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pack_openings_user_id_idx ON pack_openings (user_id);
CREATE INDEX IF NOT EXISTS pack_openings_created_at_idx ON pack_openings (created_at);
CREATE UNIQUE INDEX IF NOT EXISTS pack_openings_payment_tx_hash_uq ON pack_openings (payment_tx_hash) WHERE payment_tx_hash IS NOT NULL;

-- Security: all access goes through service-role API routes.
ALTER TABLE public.pack_tiers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pack_tiers FROM anon, authenticated;
CREATE POLICY "service_pack_tiers_all" ON pack_tiers FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.pack_openings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pack_openings FROM anon, authenticated;
CREATE POLICY "service_pack_openings_all" ON pack_openings FOR ALL USING (true) WITH CHECK (true);
