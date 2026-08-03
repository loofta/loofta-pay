-- Fixes a real race: seat_number was computed application-side as count(*)+1, with a
-- time-of-check-to-time-of-use gap before the insert actually landed. Two near-simultaneous
-- joins (a real join racing a bot join, or two bots) could both read the same count and both
-- insert the same seat_number — confirmed happening in practice with a 10-seat room filled via
-- the dev bot-fill tool (visible as two participants rendering identical PokerTable avatar
-- colors, since color is assigned by seat_number).
--
-- Fix: the seat-cap trigger already row-locks the room (SELECT ... FOR UPDATE) before checking
-- the seat count — extend it to ALSO assign NEW.seat_number under that same lock, so two
-- concurrent inserts can never compute the same number. Whatever seat_number the caller passes
-- in is now ignored entirely; the trigger is the only source of truth.
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

  NEW.seat_number := current_count + 1;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
