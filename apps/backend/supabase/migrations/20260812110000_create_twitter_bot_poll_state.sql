-- twitter_bot_poll_state: persists the bot's mention-timeline "since_id" cursor across restarts.
-- Without this, the cursor only lives in the bot process's memory — every Railway redeploy/crash
-- loses it, and the bot re-fetches + re-parses a whole batch of recent mentions from scratch on
-- next boot. Harmless (tweet_id dedup on the create side prevents any double-reply/double-charge)
-- but noisy, and wastes Twitter API quota. Single-row table, keyed by bot handle so multiple bots
-- could theoretically share the schema without collision.
CREATE TABLE IF NOT EXISTS public.twitter_bot_poll_state (
  bot_handle          TEXT PRIMARY KEY,
  last_seen_tweet_id  TEXT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.twitter_bot_poll_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_twitter_bot_poll_state ON public.twitter_bot_poll_state;
CREATE POLICY deny_all_twitter_bot_poll_state ON public.twitter_bot_poll_state FOR ALL USING (false) WITH CHECK (false);
