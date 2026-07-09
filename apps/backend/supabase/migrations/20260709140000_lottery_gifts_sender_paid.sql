-- Support user-initiated (self-service) gifting alongside the existing admin-issued flow.
-- Admin gifts are funded from Loofta's treasury at claim time (no ticket exists until claimed);
-- sender-paid gifts are bought immediately by the sending user — same signed private-transfer
-- flow as buying for themselves — and claiming just reassigns the already-existing ticket's
-- ownership. `gifted_by_admin_id` is renamed since it's no longer admin-only.
ALTER TABLE public.lottery_gifts RENAME COLUMN gifted_by_admin_id TO created_by_user_id;

ALTER TABLE public.lottery_gifts ADD COLUMN IF NOT EXISTS funding_mode text NOT NULL DEFAULT 'admin_treasury'
  CHECK (funding_mode IN ('admin_treasury', 'sender_paid'));
