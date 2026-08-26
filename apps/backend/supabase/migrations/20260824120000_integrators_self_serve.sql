-- =====================================================
-- Self-serve integrators: lets a logged-in Loofta user mint their own API key (scoped to
-- 'payment_links:create') instead of every integrator being hand-provisioned by an admin.
-- owner_user_id is the Privy user id; NULL for existing/future admin-provisioned trusted-partner
-- integrators (pay-human, twitter-payments) so those are entirely unaffected.
-- =====================================================

ALTER TABLE public.integrators
ADD COLUMN IF NOT EXISTS owner_user_id TEXT;

-- One self-serve integrator per user — provisioning is find-or-create, not append-only.
CREATE UNIQUE INDEX IF NOT EXISTS integrators_owner_user_id_idx
  ON public.integrators (owner_user_id) WHERE owner_user_id IS NOT NULL;
