-- giveaway_tasks: task_type catalog grew again (x_post added — a brand-new original X post with
-- required exact text, verified via Sorsa's /search-tweets against the entrant's own recent
-- posts). visit_link is kept in the allowed set even though the wizard no longer offers it as a
-- category, so any already-existing giveaway with one still inserts/reads fine.
ALTER TABLE public.giveaway_tasks DROP CONSTRAINT IF EXISTS giveaway_tasks_task_type_check;
ALTER TABLE public.giveaway_tasks ADD CONSTRAINT giveaway_tasks_task_type_check CHECK (task_type IN (
  'x_follow', 'x_retweet', 'x_like', 'x_comment', 'x_bookmark', 'x_post',
  'telegram_join', 'discord_join', 'visit_link', 'custom'
));
