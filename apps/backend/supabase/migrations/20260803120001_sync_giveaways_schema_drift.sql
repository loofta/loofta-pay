-- =====================================================
-- Sync fix: 20260802150000_create_giveaways_tables.sql was edited several times
-- after it had already been applied to the live database (task types, entry
-- columns, burner_reclaimed_at were all added post-hoc to that file). Those
-- edits never reached the live schema. This is a forward-only migration that
-- brings the live tables in line with the current state of that file, instead
-- of editing an already-applied migration again.
-- =====================================================

-- giveaways: burner_reclaimed_at added post-hoc
ALTER TABLE public.giveaways ADD COLUMN IF NOT EXISTS burner_reclaimed_at TIMESTAMPTZ;

ALTER TABLE public.giveaways DROP CONSTRAINT IF EXISTS giveaways_status_check;
ALTER TABLE public.giveaways ADD CONSTRAINT giveaways_status_check CHECK (status IN (
  'DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'PENDING_FUNDING', 'FUNDED', 'OPEN',
  'ENTRIES_CLOSED', 'DRAWING', 'WINNERS_SELECTED', 'PAYOUT_IN_PROGRESS',
  'COMPLETED', 'CANCELLED', 'UNDERFUNDED_EXPIRED', 'REFUNDED'
));

-- giveaways_safe: recreate to include burner_reclaimed_at (harmless no-op if already current)
DROP VIEW IF EXISTS public.giveaways_safe;
CREATE VIEW public.giveaways_safe AS
SELECT
  id, created_at, updated_at, created_by,
  title, description, logo_url,
  winner_count, selection_mode, prize_amount_usd, entries_close_at,
  eligibility,
  burner_address, mint, is_devnet, funding_required_usd, funding_confirmed_usd, burner_reclaimed_at,
  vrf_request_slot, vrf_randomness, vrf_requested_at, vrf_fulfilled_at, entry_snapshot_hash,
  admin_reviewed_by, admin_reviewed_at, rejection_reason, cancel_reason,
  status
FROM public.giveaways;
ALTER VIEW public.giveaways_safe SET (security_invoker = true);

-- giveaway_tasks: task_type catalog grew (x_bookmark/visit_link/custom replaced waitlist_join/create_account)
ALTER TABLE public.giveaway_tasks DROP CONSTRAINT IF EXISTS giveaway_tasks_task_type_check;
ALTER TABLE public.giveaway_tasks ADD CONSTRAINT giveaway_tasks_task_type_check CHECK (task_type IN (
  'x_follow', 'x_retweet', 'x_like', 'x_comment', 'x_bookmark',
  'telegram_join', 'discord_join', 'visit_link', 'custom'
));

-- giveaway_entries: X-identity + payout_destination columns added post-hoc
ALTER TABLE public.giveaway_entries ADD COLUMN IF NOT EXISTS x_user_id TEXT NOT NULL DEFAULT '';
ALTER TABLE public.giveaway_entries ADD COLUMN IF NOT EXISTS x_handle TEXT NOT NULL DEFAULT '';
ALTER TABLE public.giveaway_entries ALTER COLUMN x_user_id DROP DEFAULT;
ALTER TABLE public.giveaway_entries ALTER COLUMN x_handle DROP DEFAULT;
ALTER TABLE public.giveaway_entries ADD COLUMN IF NOT EXISTS eligibility_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.giveaway_entries ADD COLUMN IF NOT EXISTS payout_destination TEXT;
