-- Recover a creator-owned waiting room even before its creator has paid for a seat.
-- An unseated creator may cancel only while the room is empty. Once any participant has paid,
-- the room remains available to its creator but cannot be cancelled out from under those funds.

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

  SELECT count(*) INTO participant_count
  FROM gacha_room_participants
  WHERE room_id = p_room_id;

  SELECT * INTO leaving_participant
  FROM gacha_room_participants
  WHERE room_id = p_room_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    IF locked_room.created_by_user_id IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION 'You do not have a seat in this room';
    END IF;

    IF participant_count > 0 THEN
      RAISE EXCEPTION 'This room has paid participants and can no longer be cancelled';
    END IF;

    UPDATE gacha_rooms
    SET status = 'cancelled', updated_at = now()
    WHERE id = p_room_id;

    RETURN jsonb_build_object(
      'roomId', p_room_id,
      'seatsFilled', 0,
      'seats', locked_room.seats,
      'roomCancelled', true,
      'entryRefunded', false
    );
  END IF;

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
