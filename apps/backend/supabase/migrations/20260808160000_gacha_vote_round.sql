-- Pack Party flow: after the initial exclusion draw, survivors vote each round on "cut one
-- more?" (majority YES, ties count as YES, cuts one more random survivor via a fresh VRF draw).
-- vote_round tracks which round a room is currently on while status = 'voting'; null before
-- voting starts. The VRF bookkeeping columns already on gacha_rooms (vrf_requested_at/
-- vrf_randomness/vrf_request_slot/vrf_fulfilled_at) are reused and reset per round rather than
-- needing their own table — only one draw is ever in flight for a room at a time.
ALTER TABLE gacha_rooms ADD COLUMN IF NOT EXISTS vote_round int;
