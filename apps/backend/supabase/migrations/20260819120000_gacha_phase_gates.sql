-- Phase gates: make the gacha room state machine client-aware (root-cause fix for the
-- "UI moves too fast / screens get skipped" problem).
--
-- The server used to advance opening -> excluding -> voting the instant its own work finished
-- (pack open confirmed, VRF fulfilled), while clients were still watching ~90s of synced
-- cinematics (ready gate, 3D rip, card reveal, exclusion roulette). Frontend kill-switches then
-- force-closed whatever cinematic was still playing the moment a vote became pending or the room
-- settled — the jarring cuts players reported.
--
-- The room now pauses at two phase gates until every REAL seated participant acknowledges they
-- finished watching, or a server-anchored deadline passes — whichever comes first, the same
-- "everyone ready OR timeout" posture the ready-gate already uses:
--
--   opening   + pending_gate='card'     -> excluding   (exclusion result committed + broadcast)
--   excluding + pending_gate='roulette' -> voting      (round 1's 30s clock starts only HERE)
--   voting    + pending_gate='roulette' -> next round / settling (vote-cut reveal, per epoch)
--
-- Acks live in Postgres (not process memory) because a backend restart mid-gate must neither
-- lose them nor double-release the gate. They are idempotent (PK conflict = already acked) and
-- keyed by (gate, gate_epoch) so an ack for one vote-cut reveal can never leak into the next
-- round's gate. The conditional UPDATE that clears pending_gate is the atomic release claim, so
-- a last-ack racing a deadline cron tick can never release twice. Bots are excluded from the
-- required count (they have no socket and nothing to watch — a pure-bot room releases on the
-- first release check); spectators never gate a room.

ALTER TABLE gacha_rooms
  ADD COLUMN IF NOT EXISTS pending_gate text,
  ADD COLUMN IF NOT EXISTS gate_epoch int,
  ADD COLUMN IF NOT EXISTS phase_deadline timestamptz;

ALTER TABLE gacha_rooms
  DROP CONSTRAINT IF EXISTS gacha_rooms_pending_gate_check;
ALTER TABLE gacha_rooms
  ADD CONSTRAINT gacha_rooms_pending_gate_check CHECK (pending_gate IN ('card', 'roulette'));

-- Cron sweep lookup: only gated rooms.
CREATE INDEX IF NOT EXISTS gacha_rooms_pending_gate_idx
  ON gacha_rooms (pending_gate)
  WHERE pending_gate IS NOT NULL;

CREATE TABLE IF NOT EXISTS gacha_phase_acks (
  room_id uuid NOT NULL REFERENCES gacha_rooms(id) ON DELETE CASCADE,
  gate text NOT NULL CHECK (gate IN ('card', 'roulette')),
  gate_epoch int NOT NULL,
  seat_number int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, gate, gate_epoch, seat_number)
);

ALTER TABLE gacha_phase_acks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON gacha_phase_acks FROM anon, authenticated;

DROP POLICY IF EXISTS service_gacha_phase_acks_all ON gacha_phase_acks;
CREATE POLICY service_gacha_phase_acks_all ON gacha_phase_acks
  FOR ALL USING (true) WITH CHECK (true);
