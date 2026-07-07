-- History queries are always "this user's tickets, newest first" — the existing single-column
-- (user_id) index still requires a sort on every dashboard/history fetch. A composite index
-- serves both the filter and the ORDER BY created_at DESC directly.
CREATE INDEX IF NOT EXISTS lottery_tickets_user_created_idx
  ON lottery_tickets (user_id, created_at DESC);
