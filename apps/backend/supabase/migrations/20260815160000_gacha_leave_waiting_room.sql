-- Let a paid participant leave a room only while it is still safely waiting for players.
-- The room row is locked so a final concurrent join cannot race this decision. Departures are
-- archived before deleting the live seat, preserving the payment audit trail and seat history.

CREATE TABLE IF NOT EXISTS gacha_room_departures (
  participant_id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES gacha_rooms(id),
  user_id text NOT NULL,
  seat_number int NOT NULL,
  payment_tx_hash text,
  left_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS gacha_room_departures_payment_tx_hash_uq
  ON gacha_room_departures (payment_tx_hash)
  WHERE payment_tx_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS gacha_room_departures_user_id_idx
  ON gacha_room_departures (user_id, left_at DESC);

ALTER TABLE gacha_room_departures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON gacha_room_departures FROM anon, authenticated;
CREATE POLICY "service_gacha_room_departures_all" ON gacha_room_departures
  FOR ALL USING (true) WITH CHECK (true);

-- Leaving can create a gap in seat numbers. The previous trigger used count(*) + 1, which would
-- collide with an occupied higher seat after such a gap. Continue to serialize on the room row,
-- but assign the first available seat number instead.
CREATE OR REPLACE FUNCTION enforce_gacha_room_seat_cap() RETURNS trigger AS $$
DECLARE
  room_seats int;
  current_count int;
  next_seat int;
BEGIN
  SELECT seats INTO room_seats FROM gacha_rooms WHERE id = NEW.room_id FOR UPDATE;
  IF room_seats IS NULL THEN
    RAISE EXCEPTION 'gacha_rooms % not found', NEW.room_id;
  END IF;

  SELECT count(*) INTO current_count FROM gacha_room_participants WHERE room_id = NEW.room_id;
  IF current_count >= room_seats THEN
    RAISE EXCEPTION 'gacha_room % is full (% / % seats)', NEW.room_id, current_count, room_seats;
  END IF;

  SELECT seats.candidate INTO next_seat
  FROM generate_series(1, room_seats) AS seats(candidate)
  WHERE NOT EXISTS (
    SELECT 1
    FROM gacha_room_participants
    WHERE room_id = NEW.room_id AND seat_number = seats.candidate
  )
  ORDER BY seats.candidate
  LIMIT 1;

  NEW.seat_number := next_seat;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE OR REPLACE FUNCTION gacha_leave_waiting_room(
  p_room_id uuid,
  p_user_id text
) RETURNS jsonb AS $$
DECLARE
  locked_room gacha_rooms%ROWTYPE;
  leaving_participant gacha_room_participants%ROWTYPE;
  participant_count int;
  room_cancelled boolean := false;
BEGIN
  SELECT * INTO locked_room
  FROM gacha_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gacha room not found';
  END IF;

  IF locked_room.status <> 'waiting' THEN
    RAISE EXCEPTION 'This room has already started and can no longer be left';
  END IF;

  SELECT * INTO leaving_participant
  FROM gacha_room_participants
  WHERE room_id = p_room_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You do not have a seat in this room';
  END IF;

  SELECT count(*) INTO participant_count
  FROM gacha_room_participants
  WHERE room_id = p_room_id;

  -- A full waiting room may be between the final seat commit and lifecycle advancement. Do not
  -- let a leave race that transition after every participant has funded the pack.
  IF participant_count >= locked_room.seats THEN
    RAISE EXCEPTION 'This room is full and has already started';
  END IF;

  INSERT INTO gacha_room_departures (
    participant_id,
    room_id,
    user_id,
    seat_number,
    payment_tx_hash
  ) VALUES (
    leaving_participant.id,
    leaving_participant.room_id,
    leaving_participant.user_id,
    leaving_participant.seat_number,
    leaving_participant.payment_tx_hash
  )
  ON CONFLICT (participant_id) DO NOTHING;

  DELETE FROM gacha_room_participants
  WHERE id = leaving_participant.id;

  participant_count := participant_count - 1;
  IF participant_count = 0 THEN
    UPDATE gacha_rooms
    SET status = 'cancelled', updated_at = now()
    WHERE id = p_room_id;
    room_cancelled := true;
  END IF;

  RETURN jsonb_build_object(
    'roomId', p_room_id,
    'seatsFilled', participant_count,
    'seats', locked_room.seats,
    'roomCancelled', room_cancelled,
    'entryRefunded', false
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION gacha_leave_waiting_room(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION gacha_leave_waiting_room(uuid, text) TO service_role;
