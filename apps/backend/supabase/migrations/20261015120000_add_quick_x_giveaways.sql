-- Quick X giveaways: no manual "enter" step. Qualifying public X posts are found by search and
-- stored as giveaway_entries rows (user_id = 'x:<x_user_id>', since the author may not have a
-- Loofta account). The creator hand-picks favourites or draws at random with the normal VRF flow,
-- and winners are paid by X username like any other pay-by-handle payment.

ALTER TABLE public.giveaways
  ADD COLUMN IF NOT EXISTS giveaway_type TEXT NOT NULL DEFAULT 'standard'
    CHECK (giveaway_type IN ('standard', 'quick_post')),
  -- { required_mentions: string[], required_hashtags: string[], required_text?: string,
  --   announcement_url?: string, start_at: ISO string }
  ADD COLUMN IF NOT EXISTS quick_criteria JSONB,
  ADD COLUMN IF NOT EXISTS quick_last_synced_at TIMESTAMPTZ,
  -- 'all': VRF draws from every qualifying post. 'shortlist': only from posts the creator starred.
  -- Length of the contest. The clock starts when the giveaway actually goes OPEN (after approval
  -- and funding), not when it is created, so a slow approval cannot eat the contest.
  ADD COLUMN IF NOT EXISTS quick_duration_hours INT CHECK (quick_duration_hours BETWEEN 1 AND 72),
  ADD COLUMN IF NOT EXISTS quick_window_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS quick_draw_pool TEXT NOT NULL DEFAULT 'all'
    CHECK (quick_draw_pool IN ('all', 'shortlist'));

ALTER TABLE public.giveaway_entries
  ADD COLUMN IF NOT EXISTS post_id TEXT,
  ADD COLUMN IF NOT EXISTS post_url TEXT,
  ADD COLUMN IF NOT EXISTS post_text TEXT,
  ADD COLUMN IF NOT EXISTS post_created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS post_media JSONB,
  ADD COLUMN IF NOT EXISTS shortlisted BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS giveaways_quick_post_idx
  ON public.giveaways (status) WHERE giveaway_type = 'quick_post';

-- giveaways_safe is deliberately NOT recreated: the public controller reads giveaway_type /
-- quick_criteria through GiveawaysService.findOneOrThrow (raw row, no burner secret returned).
