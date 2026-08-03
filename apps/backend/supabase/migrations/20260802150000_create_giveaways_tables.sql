-- =====================================================
-- giveaways: Rewards > Giveaways feature
--
-- A project funds a giveaway burner, defines participation
-- tasks, and Loofta admin approves it before it opens for entries.
-- Winners are selected randomly (MagicBlock VRF), first-come-first-serve,
-- or manually by the creator, then paid out publicly or privately
-- from the burner (same pattern as `payments`/`claims`).
-- =====================================================

CREATE TABLE IF NOT EXISTS public.giveaways (
  -- Identity
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        TEXT NOT NULL, -- Privy user ID (did:privy:...)

  -- Display
  title             TEXT NOT NULL,
  description       TEXT,
  logo_url          TEXT,

  -- Prize structure
  winner_count      INTEGER NOT NULL CHECK (winner_count > 0),
  selection_mode    TEXT NOT NULL CHECK (selection_mode IN ('random', 'first_come', 'manual')),
  prize_amount_usd  NUMERIC(20, 6) NOT NULL CHECK (prize_amount_usd > 0), -- per winner
  entries_close_at  TIMESTAMPTZ NOT NULL,

  -- Eligibility (country/geo intentionally not modeled yet)
  eligibility       JSONB NOT NULL DEFAULT '{}'::jsonb, -- { min_followers?, min_account_age_days? }

  -- Burner escrow (encrypted — never store plaintext keys)
  burner_address          TEXT,
  burner_encrypted_secret TEXT,
  mint                    TEXT, -- SPL mint the burner is funded/paid in (USDC)
  is_devnet               BOOLEAN NOT NULL DEFAULT false,
  funding_required_usd    NUMERIC(20, 6),
  funding_confirmed_usd   NUMERIC(20, 6) NOT NULL DEFAULT 0,
  burner_reclaimed_at     TIMESTAMPTZ, -- set once the burner's leftover rent/dust has been swept back to the fee payer (GC cron backstop, see .claude/skills/solana-sponsor-safety)

  -- MagicBlock VRF draw (selection_mode = 'random')
  vrf_request_slot   BIGINT,
  vrf_randomness      TEXT, -- hex-encoded 32-byte randomness, null until fulfilled
  vrf_requested_at    TIMESTAMPTZ,
  vrf_fulfilled_at    TIMESTAMPTZ,
  entry_snapshot_hash TEXT, -- sha256 of the frozen eligible+verified entry list at close

  -- Admin approval
  admin_reviewed_by TEXT,
  admin_reviewed_at TIMESTAMPTZ,
  rejection_reason  TEXT,
  cancel_reason     TEXT,

  -- Status machine
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
    'DRAFT',               -- being composed by the creator
    'PENDING_APPROVAL',    -- submitted, awaiting Loofta admin review
    'REJECTED',            -- admin rejected
    'PENDING_FUNDING',     -- approved, burner minted, awaiting deposit
    'FUNDED',              -- funding_confirmed_usd >= funding_required_usd
    'OPEN',                -- accepting entries
    'ENTRIES_CLOSED',      -- past entries_close_at, entries frozen
    'DRAWING',             -- winner selection in progress (VRF requested, or manual pending)
    'WINNERS_SELECTED',    -- winners chosen, payout not yet started
    'PAYOUT_IN_PROGRESS',  -- sweeping funds to winners
    'COMPLETED',           -- all winners paid, buffer refunded
    'CANCELLED',           -- cancelled before completion
    'UNDERFUNDED_EXPIRED', -- funding never arrived within timeout
    'REFUNDED'             -- burner contents refunded to creator
  ))
);
CREATE INDEX IF NOT EXISTS giveaways_created_by_idx ON public.giveaways (created_by);
CREATE INDEX IF NOT EXISTS giveaways_status_idx ON public.giveaways (status);
CREATE INDEX IF NOT EXISTS giveaways_entries_close_at_idx ON public.giveaways (entries_close_at) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS giveaways_burner_address_idx ON public.giveaways (burner_address) WHERE burner_address IS NOT NULL;

DROP TRIGGER IF EXISTS trg_giveaways_updated_at ON public.giveaways;
CREATE TRIGGER trg_giveaways_updated_at
BEFORE UPDATE ON public.giveaways
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.giveaways ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.giveaways FROM anon, authenticated;
DROP POLICY IF EXISTS deny_all_giveaways ON public.giveaways;
CREATE POLICY deny_all_giveaways ON public.giveaways FOR ALL USING (false) WITH CHECK (false);

-- =====================================================
-- giveaways_safe: view that hides the burner secret
-- =====================================================
DROP VIEW IF EXISTS public.giveaways_safe;
CREATE VIEW public.giveaways_safe AS
SELECT
  id,
  created_at,
  updated_at,
  created_by,
  title,
  description,
  logo_url,
  winner_count,
  selection_mode,
  prize_amount_usd,
  entries_close_at,
  eligibility,
  burner_address,
  mint,
  is_devnet,
  funding_required_usd,
  funding_confirmed_usd,
  burner_reclaimed_at,
  vrf_request_slot,
  vrf_randomness,
  vrf_requested_at,
  vrf_fulfilled_at,
  entry_snapshot_hash,
  admin_reviewed_by,
  admin_reviewed_at,
  rejection_reason,
  cancel_reason,
  status
FROM public.giveaways;
ALTER VIEW public.giveaways_safe SET (security_invoker = true);

-- =====================================================
-- giveaway_tasks: predefined participation task catalog per giveaway
-- =====================================================
CREATE TABLE IF NOT EXISTS public.giveaway_tasks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  giveaway_id       UUID NOT NULL REFERENCES public.giveaways(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  order_index       INTEGER NOT NULL DEFAULT 0,
  task_type         TEXT NOT NULL CHECK (task_type IN (
    'x_follow', 'x_retweet', 'x_like', 'x_comment', 'x_bookmark',
    'telegram_join', 'discord_join', 'visit_link', 'custom'
  )),
  config            JSONB NOT NULL DEFAULT '{}'::jsonb, -- target handle/tweet url/channel/external url, comment_requirement/instructions, require_proof
  verification_mode TEXT NOT NULL CHECK (verification_mode IN ('auto_api', 'self_report'))
);
CREATE INDEX IF NOT EXISTS giveaway_tasks_giveaway_id_idx ON public.giveaway_tasks (giveaway_id, order_index);

DROP TRIGGER IF EXISTS trg_giveaway_tasks_updated_at ON public.giveaway_tasks;
CREATE TRIGGER trg_giveaway_tasks_updated_at
BEFORE UPDATE ON public.giveaway_tasks
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.giveaway_tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.giveaway_tasks FROM anon, authenticated;
DROP POLICY IF EXISTS deny_all_giveaway_tasks ON public.giveaway_tasks;
CREATE POLICY deny_all_giveaway_tasks ON public.giveaway_tasks FOR ALL USING (false) WITH CHECK (false);

-- =====================================================
-- giveaway_entries: one row per participant per giveaway
-- =====================================================
CREATE TABLE IF NOT EXISTS public.giveaway_entries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  giveaway_id       UUID NOT NULL REFERENCES public.giveaways(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id           TEXT NOT NULL, -- Privy user ID
  entered_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  entry_index       BIGINT NOT NULL, -- monotonic per giveaway, used for first-come ordering

  -- X identity at entry time (numeric id, not handle, since handles change) + an eligibility
  -- snapshot for audit — re-checking eligibility later must be able to explain a past decision.
  x_user_id             TEXT NOT NULL,
  x_handle              TEXT NOT NULL,
  eligibility_snapshot  JSONB NOT NULL DEFAULT '{}'::jsonb, -- { followers_count, account_created_at }

  status            TEXT NOT NULL DEFAULT 'entered' CHECK (status IN (
    'entered', 'disqualified', 'winner', 'not_selected'
  )),

  payout_choice     TEXT CHECK (payout_choice IN ('public', 'private')),
  payout_destination TEXT, -- Solana wallet address the winner wants paid out to
  payout_status     TEXT CHECK (payout_status IN (
    'not_applicable', 'pending', 'in_progress', 'succeeded', 'failed'
  )),
  payout_tx_hash    TEXT,
  payout_amount_usd NUMERIC(20, 6)
);
CREATE UNIQUE INDEX IF NOT EXISTS giveaway_entries_giveaway_user_uidx
  ON public.giveaway_entries (giveaway_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS giveaway_entries_giveaway_entry_index_uidx
  ON public.giveaway_entries (giveaway_id, entry_index);
CREATE INDEX IF NOT EXISTS giveaway_entries_giveaway_id_idx ON public.giveaway_entries (giveaway_id);
CREATE INDEX IF NOT EXISTS giveaway_entries_user_id_idx ON public.giveaway_entries (user_id);
CREATE INDEX IF NOT EXISTS giveaway_entries_pending_payout_idx
  ON public.giveaway_entries (giveaway_id, payout_status) WHERE payout_status IN ('pending', 'failed');

DROP TRIGGER IF EXISTS trg_giveaway_entries_updated_at ON public.giveaway_entries;
CREATE TRIGGER trg_giveaway_entries_updated_at
BEFORE UPDATE ON public.giveaway_entries
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.giveaway_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.giveaway_entries FROM anon, authenticated;
DROP POLICY IF EXISTS deny_all_giveaway_entries ON public.giveaway_entries;
CREATE POLICY deny_all_giveaway_entries ON public.giveaway_entries FOR ALL USING (false) WITH CHECK (false);

-- =====================================================
-- giveaway_task_completions: per-entry, per-task completion + verification
-- =====================================================
CREATE TABLE IF NOT EXISTS public.giveaway_task_completions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  giveaway_entry_id   UUID NOT NULL REFERENCES public.giveaway_entries(id) ON DELETE CASCADE,
  giveaway_task_id    UUID NOT NULL REFERENCES public.giveaway_tasks(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  submission_data     JSONB, -- self-report proof: link/text/screenshot url
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN (
    'pending', 'auto_verified', 'verified', 'rejected', 'api_error'
  )),
  verification_detail JSONB,
  reviewed_by         TEXT, -- admin/creator Privy user ID, null if auto-verified
  reviewed_at         TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS giveaway_task_completions_entry_task_uidx
  ON public.giveaway_task_completions (giveaway_entry_id, giveaway_task_id);
CREATE INDEX IF NOT EXISTS giveaway_task_completions_pending_idx
  ON public.giveaway_task_completions (verification_status) WHERE verification_status IN ('pending', 'api_error');

DROP TRIGGER IF EXISTS trg_giveaway_task_completions_updated_at ON public.giveaway_task_completions;
CREATE TRIGGER trg_giveaway_task_completions_updated_at
BEFORE UPDATE ON public.giveaway_task_completions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.giveaway_task_completions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.giveaway_task_completions FROM anon, authenticated;
DROP POLICY IF EXISTS deny_all_giveaway_task_completions ON public.giveaway_task_completions;
CREATE POLICY deny_all_giveaway_task_completions ON public.giveaway_task_completions FOR ALL USING (false) WITH CHECK (false);

-- =====================================================
-- giveaway_events: audit log for status transitions
-- =====================================================
CREATE TABLE IF NOT EXISTS public.giveaway_events (
  id          BIGSERIAL PRIMARY KEY,
  giveaway_id UUID NOT NULL REFERENCES public.giveaways(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  type        TEXT NOT NULL,
  payload     JSONB
);
CREATE INDEX IF NOT EXISTS giveaway_events_giveaway_id_idx
  ON public.giveaway_events (giveaway_id, created_at DESC);

ALTER TABLE public.giveaway_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.giveaway_events FROM anon, authenticated;
DROP POLICY IF EXISTS deny_all_giveaway_events ON public.giveaway_events;
CREATE POLICY deny_all_giveaway_events ON public.giveaway_events FOR ALL USING (false) WITH CHECK (false);
