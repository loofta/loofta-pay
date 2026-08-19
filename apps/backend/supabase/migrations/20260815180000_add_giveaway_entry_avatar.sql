-- Captures the entrant's X profile picture at entry time, piggybacking on the X API call
-- giveaway-entries.service.ts already makes for every entrant (resolveXProfile, used for
-- eligibility checks) — no extra API call or cost. Powers the entrant avatar stack on the public
-- giveaways list. RLS on giveaway_entries already denies all direct anon/authenticated access
-- (see 20260802150000_create_giveaways_tables.sql); only the backend's service-role client reads
-- this, and only ever exposes it as an image URL, never alongside the entrant's identity while a
-- giveaway is still open.
ALTER TABLE public.giveaway_entries
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;
