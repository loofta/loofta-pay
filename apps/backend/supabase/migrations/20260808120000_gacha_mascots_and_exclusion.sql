-- Gacha exclusion game: replaces the bid auction with a MagicBlock-VRF exclusion draw that runs
-- right after the room fills (before the pack is purchased). Survivors split the buyback payout;
-- excluded participants get payout_usdc = 0. The bid-auction tables/columns are left untouched —
-- the new state machine (waiting -> excluding -> purchasing -> opening -> settled) never reaches
-- 'bidding'/'settling', but nothing bid-related is dropped.

-- exclusion_count: admin-editable, copied onto the room at creation like seats/entry_usdc so an
-- admin edit never retroactively changes an in-flight room's odds. ~20% of seats excluded.
ALTER TABLE gacha_room_configs ADD COLUMN IF NOT EXISTS exclusion_count int NOT NULL DEFAULT 1;

UPDATE gacha_room_configs SET exclusion_count = 1 WHERE config_key = 'small-5';
UPDATE gacha_room_configs SET exclusion_count = 2 WHERE config_key = 'large-10';

ALTER TABLE gacha_rooms ADD COLUMN IF NOT EXISTS exclusion_count int NOT NULL DEFAULT 1;

-- VRF request/poll bookkeeping for the exclusion draw — same shape as giveaways.vrf_* columns
-- (giveaway-draw.service.ts), one draw per room, PDA seed = sha256(room id).
ALTER TABLE gacha_rooms ADD COLUMN IF NOT EXISTS vrf_request_slot bigint;
ALTER TABLE gacha_rooms ADD COLUMN IF NOT EXISTS vrf_randomness text;
ALTER TABLE gacha_rooms ADD COLUMN IF NOT EXISTS vrf_requested_at timestamptz;
ALTER TABLE gacha_rooms ADD COLUMN IF NOT EXISTS vrf_fulfilled_at timestamptz;

-- Mascot lock-in: one of the 20 branded mascots (apps/frontend/public/images/mascots/), picked
-- and locked while the room is still 'waiting'. mascot_key stays NULL until locked; once locked
-- it's immutable (enforced in gacha.service.ts, not here). Persisted (not in-memory like the
-- existing emoji picker) so a mid-room backend restart never loses it, and so settled rooms keep
-- a durable "who survived" record.
ALTER TABLE gacha_room_participants ADD COLUMN IF NOT EXISTS mascot_key text;
ALTER TABLE gacha_room_participants ADD COLUMN IF NOT EXISTS mascot_locked_at timestamptz;
ALTER TABLE gacha_room_participants ADD COLUMN IF NOT EXISTS excluded boolean NOT NULL DEFAULT false;

ALTER TABLE gacha_room_participants DROP CONSTRAINT IF EXISTS gacha_room_participants_mascot_key_check;
ALTER TABLE gacha_room_participants ADD CONSTRAINT gacha_room_participants_mascot_key_check
  CHECK (mascot_key IS NULL OR mascot_key IN (
    'axolotl', 'bear', 'bunny', 'cat', 'chick', 'crab', 'dog', 'duck', 'fox', 'goat',
    'hamster', 'octopus', 'owl', 'penguin', 'pig', 'raccoon', 'shark', 'sloth', 'snail', 'turtle'
  ));
