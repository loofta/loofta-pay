-- LOO-15: when the room creator is the only paid participant in a waiting room, let them
-- cancel it and return the payment metadata to the backend so the existing idempotent
-- gacha_entry_refunds payout path can refund the entry. The RPC itself never claims that funds
-- moved: entryRefunded remains false until the backend successfully sends/records the refund.

CREATE OR REPLACE FUNCTION gacha_leave_waiting_room(
  p_room_id uuid,
  p_user_id text
) RETURNS jsonb AS $$
DECLARE
  locked_room gacha_rooms%ROWTYPE;
  leaving_participant gacha_room_participants%ROWTYPE;
  participant_count int;
  departure_count int;
  prior_departure gacha_room_departures%ROWTYPE;
  room_cancelled boolean := false;
  entry_refund_required boolean := false;
  refund_payment_tx_hash text := null;
BEGIN
  SELECT * INTO locked_room
  FROM gacha_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gacha room not found';
  END IF;

  -- If the backend crashed after the atomic leave but before completing the transfer, return the
  -- same payment metadata on retry. refundFailedJoin uses payment_tx_hash as its idempotency key,
  -- so this can resume a failed refund without ever paying twice.
  IF locked_room.status = 'cancelled' AND locked_room.created_by_user_id = p_user_id THEN
    SELECT count(*) INTO departure_count
    FROM gacha_room_departures
    WHERE room_id = p_room_id;

    SELECT * INTO prior_departure
    FROM gacha_room_departures
    WHERE room_id = p_room_id AND user_id = p_user_id
    ORDER BY left_at ASC
    LIMIT 1;

    IF FOUND AND departure_count = 1 AND prior_departure.payment_tx_hash IS NOT NULL THEN
      RETURN jsonb_build_object(
        'roomId', p_room_id,
        'seatsFilled', 0,
        'seats', locked_room.seats,
        'roomCancelled', true,
        'entryRefunded', false,
        'entryRefundRequired', true,
        'refundPaymentTxHash', prior_departure.payment_tx_hash,
        'refundAmountUsdc', locked_room.entry_usdc
      );
    END IF;
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
      'entryRefunded', false,
      'entryRefundRequired', false
    );
  END IF;

  -- A full waiting room may be between the final seat commit and lifecycle advancement. Do not
  -- let a leave race that transition after every participant has funded the pack.
  IF participant_count >= locked_room.seats THEN
    RAISE EXCEPTION 'This room is full and has already started';
  END IF;

  -- LOO-15 is intentionally narrow: only the creator's own paid seat, with no other paid seats,
  -- qualifies for an entry refund. Existing non-final participant leave behavior is unchanged.
  entry_refund_required := locked_room.created_by_user_id = p_user_id
    AND participant_count = 1
    AND leaving_participant.payment_tx_hash IS NOT NULL;
  IF entry_refund_required THEN
    refund_payment_tx_hash := leaving_participant.payment_tx_hash;
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
    'entryRefunded', false,
    'entryRefundRequired', entry_refund_required,
    'refundPaymentTxHash', refund_payment_tx_hash,
    'refundAmountUsdc', CASE WHEN entry_refund_required THEN locked_room.entry_usdc ELSE null END
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION gacha_leave_waiting_room(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION gacha_leave_waiting_room(uuid, text) TO service_role;
