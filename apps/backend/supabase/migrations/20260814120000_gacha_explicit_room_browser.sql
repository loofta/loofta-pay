-- LOO-6: explicit Gacha room browser/create/join support.
--
-- Public rooms now have a stable display name and visibility flag. Room numbering and the
-- legacy Quick Play "find or create" path are implemented as database functions protected by a
-- per-config advisory transaction lock, so concurrent requests cannot both choose stale state
-- and create the same next room number. Participant capacity remains enforced independently by
-- enforce_gacha_room_seat_cap(), which row-locks the target room at the final seat insert.

ALTER TABLE gacha_rooms
  ADD COLUMN IF NOT EXISTS room_number bigint,
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_by_user_id text;

-- Backfill stable numbers/names for rooms created before the browser shipped. Numbering is scoped
-- to a config because the lobby only compares rooms of the same size/config.
WITH numbered AS (
  SELECT
    id,
    row_number() OVER (PARTITION BY config_key ORDER BY created_at, id) AS room_number
  FROM gacha_rooms
)
UPDATE gacha_rooms AS room
SET
  room_number = COALESCE(room.room_number, numbered.room_number),
  name = COALESCE(NULLIF(btrim(room.name), ''), 'Room #' || numbered.room_number)
FROM numbered
WHERE room.id = numbered.id
  AND (room.room_number IS NULL OR room.name IS NULL OR btrim(room.name) = '');

-- Keep direct inserts rollout-safe as the migration and application version are deployed. New
-- code uses the functions below, but this trigger also protects an older backend process that is
-- still draining requests while the migration is applied.
CREATE OR REPLACE FUNCTION ensure_gacha_room_identity() RETURNS trigger AS $$
BEGIN
  IF NEW.room_number IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('gacha-room-number:' || NEW.config_key, 0));
    SELECT COALESCE(max(room_number), 0) + 1 INTO NEW.room_number
    FROM gacha_rooms
    WHERE config_key = NEW.config_key;
  END IF;

  NEW.name := COALESCE(NULLIF(btrim(NEW.name), ''), 'Room #' || NEW.room_number);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS gacha_room_identity ON gacha_rooms;
CREATE TRIGGER gacha_room_identity
  BEFORE INSERT ON gacha_rooms
  FOR EACH ROW EXECUTE FUNCTION ensure_gacha_room_identity();

ALTER TABLE gacha_rooms
  ALTER COLUMN room_number SET NOT NULL,
  ALTER COLUMN name SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gacha_rooms_config_room_number_uq
  ON gacha_rooms (config_key, room_number);

CREATE INDEX IF NOT EXISTS gacha_rooms_public_waiting_idx
  ON gacha_rooms (config_key, created_at)
  WHERE status = 'waiting' AND is_private = false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gacha_rooms_name_check') THEN
    ALTER TABLE gacha_rooms ADD CONSTRAINT gacha_rooms_name_check
      CHECK (char_length(btrim(name)) BETWEEN 1 AND 24);
  END IF;
END
$$;

-- Creates one deliberately separate room. The lock is only held while allocating its display
-- number; unlike Quick Play, this function always inserts a new row because parallel public
-- rooms of the same config are a supported product feature.
CREATE OR REPLACE FUNCTION gacha_create_waiting_room(
  p_config_key text,
  p_created_by_user_id text,
  p_room_name text DEFAULT NULL,
  p_is_private boolean DEFAULT false
) RETURNS uuid AS $$
DECLARE
  cfg gacha_room_configs%ROWTYPE;
  next_room_number bigint;
  created_room_id uuid;
  normalized_name text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('gacha-room-number:' || p_config_key, 0));

  SELECT * INTO cfg
  FROM gacha_room_configs
  WHERE config_key = p_config_key AND enabled = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown or disabled Gacha room config: %', p_config_key;
  END IF;

  SELECT COALESCE(max(room_number), 0) + 1 INTO next_room_number
  FROM gacha_rooms
  WHERE config_key = p_config_key;

  normalized_name := NULLIF(btrim(p_room_name), '');
  IF normalized_name IS NOT NULL AND char_length(normalized_name) > 24 THEN
    RAISE EXCEPTION 'Gacha room name must be 24 characters or fewer';
  END IF;

  INSERT INTO gacha_rooms (
    config_key,
    pack_type,
    seats,
    entry_usdc,
    exclusion_count,
    status,
    room_number,
    name,
    is_private,
    created_by_user_id
  ) VALUES (
    cfg.config_key,
    cfg.pack_type,
    cfg.seats,
    cfg.entry_usdc,
    cfg.exclusion_count,
    'waiting',
    next_room_number,
    COALESCE(normalized_name, 'Room #' || next_room_number),
    COALESCE(p_is_private, false),
    p_created_by_user_id
  )
  RETURNING id INTO created_room_id;

  RETURN created_room_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Compatibility/Quick Play path. It shares the explicit-create numbering lock, so a Quick Play
-- scan cannot race an explicit create that is about to make a joinable public room. The fullest
-- public room is preferred so Quick Play uses the same "closest to starting" rule as the lobby.
CREATE OR REPLACE FUNCTION gacha_find_or_create_waiting_room(
  p_config_key text
) RETURNS uuid AS $$
DECLARE
  cfg gacha_room_configs%ROWTYPE;
  selected_room_id uuid;
  next_room_number bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('gacha-room-number:' || p_config_key, 0));

  SELECT * INTO cfg
  FROM gacha_room_configs
  WHERE config_key = p_config_key AND enabled = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown or disabled Gacha room config: %', p_config_key;
  END IF;

  SELECT room.id INTO selected_room_id
  FROM gacha_rooms AS room
  LEFT JOIN gacha_room_participants AS participant ON participant.room_id = room.id
  WHERE room.config_key = p_config_key
    AND room.status = 'waiting'
    AND room.is_private = false
  GROUP BY room.id, room.seats, room.created_at
  HAVING count(participant.id) < room.seats
  ORDER BY count(participant.id) DESC, room.created_at ASC
  LIMIT 1;

  IF selected_room_id IS NOT NULL THEN
    RETURN selected_room_id;
  END IF;

  SELECT COALESCE(max(room_number), 0) + 1 INTO next_room_number
  FROM gacha_rooms
  WHERE config_key = p_config_key;

  INSERT INTO gacha_rooms (
    config_key,
    pack_type,
    seats,
    entry_usdc,
    exclusion_count,
    status,
    room_number,
    name,
    is_private
  ) VALUES (
    cfg.config_key,
    cfg.pack_type,
    cfg.seats,
    cfg.entry_usdc,
    cfg.exclusion_count,
    'waiting',
    next_room_number,
    'Room #' || next_room_number,
    false
  )
  RETURNING id INTO selected_room_id;

  RETURN selected_room_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION gacha_create_waiting_room(text, text, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION gacha_find_or_create_waiting_room(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION gacha_create_waiting_room(text, text, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION gacha_find_or_create_waiting_room(text) TO service_role;
