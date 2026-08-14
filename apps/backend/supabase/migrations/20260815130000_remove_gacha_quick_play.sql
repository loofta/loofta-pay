-- LOO-6 product decision: every player explicitly chooses or creates a room before paying.
-- Retire the database function that powered the legacy silent Quick Play matcher. The API route
-- and frontend caller are removed in the same release; dropping the function prevents a future
-- caller from accidentally restoring automatic placement behind the user's back.
DROP FUNCTION IF EXISTS gacha_find_or_create_waiting_room(text);
