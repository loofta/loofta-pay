-- Connected MagicBlock wallet per user — write-once (enforced in the service layer, not here)
-- so a user can't re-paste a different wallet to double-validate the same quest.
CREATE TABLE IF NOT EXISTS magicblock_wallets (
  user_id     TEXT PRIMARY KEY,
  wallet      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per qualifying action (lottery ticket / private payment) pushed to MagicBlock.
-- UNIQUE(quest_type, source_id) is both the completion ledger (for repeatable-count display)
-- and the idempotency guard, so a retried confirm call can never double-push the same action.
CREATE TABLE IF NOT EXISTS magicblock_quest_pushes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,
  quest_type  TEXT NOT NULL CHECK (quest_type IN ('lottery_ticket', 'private_payment')),
  quest_id    INTEGER NOT NULL,
  source_id   TEXT NOT NULL,
  wallet      TEXT NOT NULL,
  success     BOOLEAN NOT NULL DEFAULT false,
  response    JSONB,
  pushed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (quest_type, source_id)
);

CREATE INDEX IF NOT EXISTS magicblock_quest_pushes_user_id_idx ON magicblock_quest_pushes (user_id);
CREATE INDEX IF NOT EXISTS magicblock_quest_pushes_user_quest_idx ON magicblock_quest_pushes (user_id, quest_type);

-- Security: all access goes through service-role API routes
ALTER TABLE public.magicblock_wallets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.magicblock_wallets FROM anon, authenticated;

ALTER TABLE public.magicblock_quest_pushes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.magicblock_quest_pushes FROM anon, authenticated;
