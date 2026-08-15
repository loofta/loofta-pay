-- LOO-6 hardening: make the one-waiting-room-per-user/config rule atomic.
--
-- The API still performs a fast pre-check for a friendly error, but this function-level lock is
-- authoritative. Two create requests for the same user/config cannot both observe "no room" and
-- insert separate waiting rooms. The lock is deliberately scoped to user + config so unrelated
-- users and different room sizes continue in parallel.

-- LOO-7 adds a fifth invite-code argument to this RPC. Keep this migration composable with
-- either migration order: harden the signature that already exists instead of silently leaving
-- an older, unguarded overload behind during a rolling deploy.
DO $migration$
BEGIN
  IF to_regprocedure('public.gacha_create_waiting_room(text,text,text,boolean,text)') IS NOT NULL THEN
    EXECUTE $five$
      CREATE OR REPLACE FUNCTION gacha_create_waiting_room(
        p_config_key text,
        p_created_by_user_id text,
        p_room_name text DEFAULT NULL,
        p_is_private boolean DEFAULT false,
        p_invite_code text DEFAULT NULL
      ) RETURNS uuid AS $fn$
      DECLARE
        cfg gacha_room_configs%ROWTYPE;
        next_room_number bigint;
        created_room_id uuid;
        normalized_name text;
        normalized_invite_code text;
      BEGIN
        PERFORM pg_advisory_xact_lock(hashtextextended(
          'gacha-create-user:' || p_config_key || ':' || p_created_by_user_id,
          0
        ));
        PERFORM pg_advisory_xact_lock(hashtextextended('gacha-room-number:' || p_config_key, 0));

        SELECT * INTO cfg
        FROM gacha_room_configs
        WHERE config_key = p_config_key AND enabled = true;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Unknown or disabled Gacha room config: %', p_config_key;
        END IF;

        IF EXISTS (
          SELECT 1
          FROM gacha_rooms AS room
          WHERE room.config_key = p_config_key
            AND room.status = 'waiting'
            AND (
              room.created_by_user_id = p_created_by_user_id
              OR EXISTS (
                SELECT 1
                FROM gacha_room_participants AS participant
                WHERE participant.room_id = room.id
                  AND participant.user_id = p_created_by_user_id
              )
            )
        ) THEN
          RAISE EXCEPTION 'You already have a waiting room for this size';
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
      $fn$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
    $five$;
    -- A mixed deploy may still have the old overload around. Remove it so callers cannot bypass
    -- the invite-aware implementation (and its atomic duplicate guard).
    EXECUTE 'DROP FUNCTION IF EXISTS gacha_create_waiting_room(text, text, text, boolean)';
  ELSE
    EXECUTE $four$
      CREATE OR REPLACE FUNCTION gacha_create_waiting_room(
        p_config_key text,
        p_created_by_user_id text,
        p_room_name text DEFAULT NULL,
        p_is_private boolean DEFAULT false
      ) RETURNS uuid AS $fn$
      DECLARE
        cfg gacha_room_configs%ROWTYPE;
        next_room_number bigint;
        created_room_id uuid;
        normalized_name text;
      BEGIN
        PERFORM pg_advisory_xact_lock(hashtextextended(
          'gacha-create-user:' || p_config_key || ':' || p_created_by_user_id,
          0
        ));
        PERFORM pg_advisory_xact_lock(hashtextextended('gacha-room-number:' || p_config_key, 0));

        SELECT * INTO cfg
        FROM gacha_room_configs
        WHERE config_key = p_config_key AND enabled = true;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Unknown or disabled Gacha room config: %', p_config_key;
        END IF;

        IF EXISTS (
          SELECT 1
          FROM gacha_rooms AS room
          WHERE room.config_key = p_config_key
            AND room.status = 'waiting'
            AND (
              room.created_by_user_id = p_created_by_user_id
              OR EXISTS (
                SELECT 1
                FROM gacha_room_participants AS participant
                WHERE participant.room_id = room.id
                  AND participant.user_id = p_created_by_user_id
              )
            )
        ) THEN
          RAISE EXCEPTION 'You already have a waiting room for this size';
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
      $fn$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
    $four$;
  END IF;
END;
$migration$;

DO $privileges$
BEGIN
  IF to_regprocedure('public.gacha_create_waiting_room(text,text,text,boolean,text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION gacha_create_waiting_room(text, text, text, boolean, text) FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION gacha_create_waiting_room(text, text, text, boolean, text) TO service_role';
  END IF;
  IF to_regprocedure('public.gacha_create_waiting_room(text,text,text,boolean)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION gacha_create_waiting_room(text, text, text, boolean) FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION gacha_create_waiting_room(text, text, text, boolean) TO service_role';
  END IF;
END;
$privileges$;
