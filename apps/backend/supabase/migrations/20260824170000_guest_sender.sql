-- =====================================================
-- Guest checkout: a payer with no Loofta/Privy account can still pay a checkout link, identified
-- by email instead of sender_user_id. Mirrors the existing PENDING_EMAIL: pattern already used
-- for unregistered *recipients* — this is the same idea for the *sender* side. If that email
-- later creates a real account, a future reconciliation pass (not built yet, same as the
-- existing recipient-side matching in payments/history) can backfill sender_user_id.
-- =====================================================

ALTER TABLE public.payments
ADD COLUMN IF NOT EXISTS guest_sender_email TEXT;
