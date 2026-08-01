-- Gacha Pooled Packs: real Pokemon card packs (via Collectorcrypt's Gacha API) opened as a
-- pooled group event instead of solo, mirroring Mystery Pack's tables (pack_tiers/pack_openings)
-- but with a room/seats/bidding layer on top. See PLAN doc "Gacha Pooled Packs" for the full
-- design; this migration only covers the data model.

-- gacha_room_configs: admin-editable room presets, same shape/spirit as pack_tiers. Both seeded
-- configs total exactly $50 (one pokemon_50 pack) — no platform fee/margin built in at launch.
CREATE TABLE IF NOT EXISTS gacha_room_configs (
  config_key text PRIMARY KEY,
  pack_type text NOT NULL DEFAULT 'pokemon_50',
  seats int NOT NULL,
  entry_usdc numeric(20, 6) NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  display_order int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO gacha_room_configs (config_key, pack_type, seats, entry_usdc, enabled, display_order) VALUES
  ('small-5',  'pokemon_50', 5,  10.000000, true, 1),  -- 5 seats x $10 = $50
  ('large-10', 'pokemon_50', 10, 5.000000,  true, 2)   -- 10 seats x $5 = $50
ON CONFLICT (config_key) DO NOTHING;

-- gacha_rooms: one row per room instance. seats/entry_usdc/pack_type are COPIED from the config
-- at creation time (not read live from gacha_room_configs) so an admin edit never retroactively
-- changes an in-flight room's economics.
CREATE TABLE IF NOT EXISTS gacha_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key text NOT NULL REFERENCES gacha_room_configs(config_key),

  pack_type text NOT NULL,
  seats int NOT NULL,
  entry_usdc numeric(20, 6) NOT NULL,

  -- 'waiting' -> 'purchasing' -> 'opening' -> 'bidding' -> 'settling' -> 'settled'
  -- side paths: 'cancelled' (never filled / refunded), 'failed' (needs manual admin remediation)
  status text NOT NULL DEFAULT 'waiting',

  collectorcrypt_memo text,
  purchase_tx_sig text,
  open_tx_sig text,

  nft_metadata jsonb,
  rarity text,

  buyback_amount_usdc numeric(20, 6),
  bid_window_ends_at timestamptz,
  winning_bid_id uuid,          -- FK added below, after gacha_bids exists (circular reference)
  buyback_tx_sig text,          -- set only on the no-winning-bid auto-buyback settlement path
  nft_transfer_tx_sig text,     -- set only on the winning-bid settlement path (NFT -> winner wallet)

  -- Settlement state machine: which bid is CURRENTLY being given its grace window to pay (see
  -- gacha.service.ts advanceToNextBidCandidate) — null once settled or if no bid ever paid.
  pending_bid_id uuid,          -- FK added below, after gacha_bids exists
  pending_bid_deadline timestamptz,

  failure_reason text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  opened_at timestamptz,
  settled_at timestamptz
);

CREATE INDEX IF NOT EXISTS gacha_rooms_status_idx ON gacha_rooms (status);
CREATE INDEX IF NOT EXISTS gacha_rooms_created_at_idx ON gacha_rooms (created_at);

-- gacha_room_participants: one row per seat. payment_tx_hash is the on-chain entry payment,
-- verified server-side (amount + sender + a room-id memo, since — unlike Mystery Pack — many
-- rooms share the one treasury address at once) before the row is ever written; the partial
-- unique index is the replay-protection backstop, same pattern as pack_openings_payment_tx_hash_uq.
CREATE TABLE IF NOT EXISTS gacha_room_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES gacha_rooms(id),
  user_id text NOT NULL,
  seat_number int NOT NULL,

  payment_tx_hash text,

  payout_usdc numeric(20, 6),
  payout_is_private boolean,
  payout_tx_sig text,

  joined_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (room_id, user_id)
);

CREATE INDEX IF NOT EXISTS gacha_room_participants_room_id_idx ON gacha_room_participants (room_id);
CREATE INDEX IF NOT EXISTS gacha_room_participants_user_id_idx ON gacha_room_participants (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS gacha_room_participants_payment_tx_hash_uq
  ON gacha_room_participants (payment_tx_hash) WHERE payment_tx_hash IS NOT NULL;

-- gacha_bids: room-participants-only English auction on the revealed card, starting at the
-- Collectorcrypt buyback price. Pledge model, not escrow — only the WINNING bid is ever actually
-- charged (see gacha.service.ts settlement: a two-step build-tx/sign/verify charge with a grace
-- window, same pattern as every other payment flow in this codebase), so outbid/expired bids
-- never moved any money and need no refund path.
CREATE TABLE IF NOT EXISTS gacha_bids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES gacha_rooms(id),
  user_id text NOT NULL,
  amount_usdc numeric(20, 6) NOT NULL,

  -- 'active' | 'outbid' | 'won' | 'expired_unpaid' (won the auction but never paid within the
  -- grace window — settlement falls back to the next-highest bid, or to auto-buyback if none)
  status text NOT NULL DEFAULT 'active',
  payment_tx_hash text,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gacha_bids_room_id_idx ON gacha_bids (room_id);

ALTER TABLE gacha_rooms
  ADD CONSTRAINT gacha_rooms_winning_bid_id_fkey FOREIGN KEY (winning_bid_id) REFERENCES gacha_bids(id);
ALTER TABLE gacha_rooms
  ADD CONSTRAINT gacha_rooms_pending_bid_id_fkey FOREIGN KEY (pending_bid_id) REFERENCES gacha_bids(id);

-- Seat-cap race guard: the SELECT ... FOR UPDATE row-locks the room, so two concurrent inserts
-- targeting the same room_id serialize on that lock instead of both reading a stale count and
-- both passing the check — the seat that fills a room can never be double-sold.
CREATE OR REPLACE FUNCTION enforce_gacha_room_seat_cap() RETURNS trigger AS $$
DECLARE
  room_seats int;
  current_count int;
BEGIN
  SELECT seats INTO room_seats FROM gacha_rooms WHERE id = NEW.room_id FOR UPDATE;
  IF room_seats IS NULL THEN
    RAISE EXCEPTION 'gacha_rooms % not found', NEW.room_id;
  END IF;

  SELECT count(*) INTO current_count FROM gacha_room_participants WHERE room_id = NEW.room_id;
  IF current_count >= room_seats THEN
    RAISE EXCEPTION 'gacha_room % is full (% / % seats)', NEW.room_id, current_count, room_seats;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS gacha_room_participants_seat_cap ON gacha_room_participants;
CREATE TRIGGER gacha_room_participants_seat_cap
  BEFORE INSERT ON gacha_room_participants
  FOR EACH ROW EXECUTE FUNCTION enforce_gacha_room_seat_cap();

-- Security: all access goes through service-role API routes.
ALTER TABLE gacha_room_configs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON gacha_room_configs FROM anon, authenticated;
CREATE POLICY "service_gacha_room_configs_all" ON gacha_room_configs FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE gacha_rooms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON gacha_rooms FROM anon, authenticated;
CREATE POLICY "service_gacha_rooms_all" ON gacha_rooms FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE gacha_room_participants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON gacha_room_participants FROM anon, authenticated;
CREATE POLICY "service_gacha_room_participants_all" ON gacha_room_participants FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE gacha_bids ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON gacha_bids FROM anon, authenticated;
CREATE POLICY "service_gacha_bids_all" ON gacha_bids FOR ALL USING (true) WITH CHECK (true);
