-- giveaway_task_completions.submitted_at: the moment an entrant actually submitted/attempted a
-- task, distinct from updated_at (which also moves when a human reviews it later). Needed so
-- first-come-first-serve ranking reflects when someone finished their tasks, not when a creator
-- happened to get around to approving a self-report submission — a self-report task can sit
-- reviewed hours or days after it was actually submitted, and updated_at would silently attribute
-- that review lag to the entrant.
ALTER TABLE public.giveaway_task_completions ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;

COMMENT ON COLUMN public.giveaway_task_completions.submitted_at IS
  'When the entrant actually submitted/attempted this task (set by submitTaskCompletion), independent of updated_at which also moves on a later human review.';
