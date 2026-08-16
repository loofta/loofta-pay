-- LOO-7: private Gacha rooms are bearer-invite rooms. The invite code is intentionally
-- nullable for public rooms and is never exposed by the public lobby/list endpoints.

ALTER TABLE gacha_rooms
  ADD COLUMN IF NOT EXISTS invite_code text;

-- LOO-6 already allowed the private toggle in the create form. Give any rooms
-- created before this migration a bearer code so they are not stranded without
-- a shareable link when the new access checks go live.
UPDATE gacha_rooms
SET invite_code = replace(gen_random_uuid()::text, '-', '')
WHERE is_private = true
  AND invite_code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gacha_rooms_invite_code_uq
  ON gacha_rooms (invite_code)
  WHERE invite_code IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gacha_rooms_invite_code_check') THEN
    ALTER TABLE gacha_rooms ADD CONSTRAINT gacha_rooms_invite_code_check
      CHECK (invite_code IS NULL OR char_length(invite_code) BETWEEN 32 AND 128);
  END IF;
END
$$;

-- Replace the LOO-6 four-argument function so every private room created by the current
-- backend gets a cryptographically random invite code. The old signature is removed rather
-- than left as a bypass that could create an unshareable private room during a rolling deploy.
DROP FUNCTION IF EXISTS gacha_create_waiting_room(text, text, text, boolean);

CREATE OR REPLACE FUNCTION gacha_create_waiting_room(
  p_config_key text,
  p_created_by_user_id text,
  p_room_name text DEFAULT NULL,
  p_is_private boolean DEFAULT false,
  p_invite_code text DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
  cfg gacha_room_configs%ROWTYPE;
  next_room_number bigint;
  created_room_id uuid;
  normalized_name text;
  normalized_invite_code text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('gacha-room-number:' || p_config_key, 0));

  SELECT * INTO cfg
  FROM gacha_room_configs
  WHERE config_key = p_config_key AND enabled = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown or disabled Gacha room config: %', p_config_key;
  END IF;

  normalized_name := NULLIF(btrim(p_room_name), '');
  IF normalized_name IS NOT NULL AND char_length(normalized_name) > 24 THEN
    RAISE EXCEPTION 'Gacha room name must be 24 characters or fewer';
  END IF;

  normalized_invite_code := NULLIF(btrim(p_invite_code), '');
  IF COALESCE(p_is_private, false) AND normalized_invite_code IS NULL THEN
    RAISE EXCEPTION 'Private Gacha rooms require an invite code';
  END IF;
  IF NOT COALESCE(p_is_private, false) THEN
    normalized_invite_code := NULL;
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
    is_private,
    created_by_user_id,
    invite_code
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
    p_created_by_user_id,
    normalized_invite_code
  )
  RETURNING id INTO created_room_id;

  RETURN created_room_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION gacha_create_waiting_room(text, text, text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION gacha_create_waiting_room(text, text, text, boolean, text) TO service_role;
