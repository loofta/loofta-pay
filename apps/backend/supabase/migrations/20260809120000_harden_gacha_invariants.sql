-- Gacha correctness/security hardening.
--
-- 1. A durable claim token makes payout transfer acquisition atomic, so concurrent auto-claim
--    requests cannot both send treasury funds.
-- 2. Database constraints backstop the room/config invariants the exclusion game and u16
--    on-chain bitmasks require.
-- 3. Seat/payment uniqueness and mascot immutability are enforced even if a future caller
--    bypasses the current application code.

ALTER TABLE gacha_room_participants
  ADD COLUMN IF NOT EXISTS payout_claim_token uuid,
  ADD COLUMN IF NOT EXISTS payout_claim_started_at timestamptz;

ALTER TABLE gacha_rooms
  ADD COLUMN IF NOT EXISTS onchain_vote_round int;

CREATE INDEX IF NOT EXISTS gacha_room_participants_pending_claim_idx
  ON gacha_room_participants (payout_claim_started_at)
  WHERE payout_claim_token IS NOT NULL AND payout_tx_sig IS NULL;

-- Repair any duplicate seat numbers created before the atomic seat-assignment trigger shipped.
-- No money/identity data changes; this only re-numbers each room deterministically by join time.
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY room_id ORDER BY joined_at, id) AS seat_number
  FROM gacha_room_participants
)
UPDATE gacha_room_participants AS participant
SET seat_number = ranked.seat_number
FROM ranked
WHERE participant.id = ranked.id
  AND participant.seat_number IS DISTINCT FROM ranked.seat_number;

CREATE UNIQUE INDEX IF NOT EXISTS gacha_room_participants_room_seat_uq
  ON gacha_room_participants (room_id, seat_number);

-- Preserve the oldest audit record if historical retry races wrote the same signature twice.
WITH duplicate_bid_payments AS (
  SELECT id, row_number() OVER (PARTITION BY payment_tx_hash ORDER BY created_at, id) AS occurrence
  FROM gacha_bids
  WHERE payment_tx_hash IS NOT NULL
)
UPDATE gacha_bids AS bid
SET payment_tx_hash = NULL
FROM duplicate_bid_payments AS duplicate
WHERE bid.id = duplicate.id AND duplicate.occurrence > 1;

CREATE UNIQUE INDEX IF NOT EXISTS gacha_bids_payment_tx_hash_uq
  ON gacha_bids (payment_tx_hash)
  WHERE payment_tx_hash IS NOT NULL;

-- If a room fills after a user signs but before their participant insert lands, the verified
-- entry transfer is returned exactly once. The payment hash is the idempotency key.
CREATE TABLE IF NOT EXISTS gacha_entry_refunds (
  payment_tx_hash text PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES gacha_rooms(id),
  user_id text NOT NULL,
  amount_usdc numeric(20, 6) NOT NULL CHECK (amount_usdc > 0),
  status text NOT NULL CHECK (status IN ('processing', 'refunded', 'failed')),
  refund_tx_sig text,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE gacha_entry_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON gacha_entry_refunds FROM anon, authenticated;
CREATE POLICY "service_gacha_entry_refunds_all" ON gacha_entry_refunds
  FOR ALL USING (true) WITH CHECK (true);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gacha_room_configs_game_values_check') THEN
    ALTER TABLE gacha_room_configs ADD CONSTRAINT gacha_room_configs_game_values_check
      CHECK (seats BETWEEN 2 AND 16 AND entry_usdc > 0 AND exclusion_count BETWEEN 1 AND seats - 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gacha_rooms_game_values_check') THEN
    ALTER TABLE gacha_rooms ADD CONSTRAINT gacha_rooms_game_values_check
      CHECK (seats BETWEEN 2 AND 16 AND entry_usdc > 0 AND exclusion_count BETWEEN 1 AND seats - 1);
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION enforce_gacha_locked_mascot_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.mascot_locked_at IS NOT NULL AND (
    NEW.mascot_key IS DISTINCT FROM OLD.mascot_key OR
    NEW.mascot_locked_at IS DISTINCT FROM OLD.mascot_locked_at
  ) THEN
    RAISE EXCEPTION 'A locked Gacha mascot cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS gacha_locked_mascot_immutable ON gacha_room_participants;
CREATE TRIGGER gacha_locked_mascot_immutable
  BEFORE UPDATE ON gacha_room_participants
  FOR EACH ROW EXECUTE FUNCTION enforce_gacha_locked_mascot_immutable();
