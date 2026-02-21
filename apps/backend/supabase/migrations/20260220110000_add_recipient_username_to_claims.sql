-- Store recipient username when claim is created to an existing user (by @handle).
-- Used for display (e.g. "To @username" in history) instead of showing "Anonymous".
ALTER TABLE public.claims
ADD COLUMN IF NOT EXISTS recipient_username text;

COMMENT ON COLUMN public.claims.recipient_username IS 'Username of recipient when claim was created via create-from-username for an existing user; for display only.';
