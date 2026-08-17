-- LOO-9 hotfix: the original rematch RPC returns a column named `config_key`, which also
-- becomes a PL/pgSQL output variable. Qualify the room-number query so PostgreSQL does not
-- confuse that output variable with gacha_rooms.config_key at runtime.

CREATE OR REPLACE FUNCTION gacha_create_rematch_group(
  p_source_room_id uuid,
  p_requesting_user_id text,
  p_invite_code text DEFAULT NULL,
  p_claim_window_seconds int DEFAULT 60
) RETURNS TABLE (
  group_id uuid,
  next_room_id uuid,
  claim_deadline timestamptz,
  invite_code text,
  config_key text,
  name text,
  seats int,
  entry_usdc numeric,
  is_private boolean
) AS $$
DECLARE
  source_room gacha_rooms%ROWTYPE;
  existing_group gacha_rematch_groups%ROWTYPE;
  next_room gacha_rooms%ROWTYPE;
  created_group_id uuid;
  next_room_number bigint;
  normalized_invite_code text;
  normalized_name text;
  deadline timestamptz;
BEGIN
  IF p_claim_window_seconds IS NULL OR p_claim_window_seconds < 0 OR p_claim_window_seconds > 3600 THEN
    RAISE EXCEPTION 'Invalid rematch claim window';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('gacha-rematch:' || p_source_room_id::text, 0));

  SELECT * INTO source_room
  FROM gacha_rooms
  WHERE id = p_source_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source Gacha room not found';
  END IF;
  IF source_room.status <> 'settled' THEN
    RAISE EXCEPTION 'This room is not settled yet';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM gacha_room_participants
    WHERE room_id = p_source_room_id AND user_id = p_requesting_user_id
  ) THEN
    RAISE EXCEPTION 'Only a room participant can run it back';
  END IF;

  SELECT * INTO existing_group
  FROM gacha_rematch_groups
  WHERE source_room_id = p_source_room_id;

  IF FOUND THEN
    IF NOT EXISTS (
      SELECT 1 FROM gacha_rematch_members AS existing_member
      WHERE existing_member.group_id = existing_group.id
        AND existing_member.user_id = p_requesting_user_id
    ) THEN
      RAISE EXCEPTION 'You were not part of this rematch group';
    END IF;

    SELECT * INTO next_room FROM gacha_rooms WHERE id = existing_group.next_room_id;
    RETURN QUERY SELECT
      existing_group.id,
      next_room.id,
      existing_group.claim_deadline,
      next_room.invite_code,
      next_room.config_key,
      next_room.name,
      next_room.seats,
      next_room.entry_usdc,
      next_room.is_private;
    RETURN;
  END IF;

  normalized_invite_code := NULLIF(btrim(p_invite_code), '');
  IF source_room.is_private AND normalized_invite_code IS NULL THEN
    RAISE EXCEPTION 'Private rematch rooms require an invite code';
  END IF;
  IF NOT source_room.is_private THEN
    normalized_invite_code := NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('gacha-room-number:' || source_room.config_key, 0));
  SELECT COALESCE(max(numbered_room.room_number), 0) + 1 INTO next_room_number
  FROM gacha_rooms AS numbered_room
  WHERE numbered_room.config_key = source_room.config_key;

  normalized_name := left(COALESCE(NULLIF(btrim(source_room.name), ''), 'Run it back') || ' · again', 24);
  INSERT INTO gacha_rooms (
    config_key, pack_type, seats, entry_usdc, exclusion_count, status, room_number, name,
    is_private, created_by_user_id, invite_code
  ) VALUES (
    source_room.config_key, source_room.pack_type, source_room.seats, source_room.entry_usdc,
    source_room.exclusion_count, 'waiting', next_room_number, normalized_name,
    source_room.is_private, p_requesting_user_id, normalized_invite_code
  ) RETURNING * INTO next_room;

  deadline := now() + make_interval(secs => p_claim_window_seconds);
  INSERT INTO gacha_rematch_groups (source_room_id, next_room_id, claim_deadline)
  VALUES (p_source_room_id, next_room.id, deadline)
  RETURNING id INTO created_group_id;

  INSERT INTO gacha_rematch_members (group_id, source_participant_id, user_id)
  SELECT created_group_id, participant.id, participant.user_id
  FROM gacha_room_participants AS participant
  WHERE participant.room_id = p_source_room_id
    AND participant.user_id NOT LIKE 'bot-%';

  RETURN QUERY SELECT
    created_group_id,
    next_room.id,
    deadline,
    next_room.invite_code,
    next_room.config_key,
    next_room.name,
    next_room.seats,
    next_room.entry_usdc,
    next_room.is_private;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION gacha_create_rematch_group(uuid, text, text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION gacha_create_rematch_group(uuid, text, text, int) TO service_role;
