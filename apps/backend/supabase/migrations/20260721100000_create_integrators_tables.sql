-- =====================================================
-- integrators: third parties / agents authorized to create payments via
-- POST /integrators/v1/pay-human and POST /x402/pay-human, without impersonating
-- a first-party Loofta (Privy) user. Modeled on twitter-payments' BotGuard/TWITTER_BOT_SECRET,
-- generalized for multiple tenants: a shared static secret has no per-caller identity, scope,
-- rate limit, or revocation — this replaces that with a real row per integrator.
-- =====================================================

CREATE TABLE IF NOT EXISTS public.integrators (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  name               TEXT NOT NULL,
  contact_email      TEXT,

  scopes             TEXT[] NOT NULL DEFAULT ARRAY['pay-human']::TEXT[],
  rate_limit_per_min INT NOT NULL DEFAULT 60,

  -- New integrators default to devnet; mainnet is an explicit grant, not an assumption.
  is_devnet_only     BOOLEAN NOT NULL DEFAULT true,

  status             TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'revoked', 'suspended')),

  created_by_admin   TEXT  -- who provisioned this (internal ops identity), not client-facing
);
CREATE INDEX IF NOT EXISTS integrators_status_idx ON public.integrators (status);

DROP TRIGGER IF EXISTS trg_integrators_updated_at ON public.integrators;
CREATE TRIGGER trg_integrators_updated_at
BEFORE UPDATE ON public.integrators
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.integrators ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_integrators ON public.integrators;
CREATE POLICY deny_all_integrators ON public.integrators FOR ALL USING (false) WITH CHECK (false);

-- =====================================================
-- integrator_api_keys: child table rather than one key column on integrators —
-- lets a key be rotated (mint a new one, revoke the old one after a grace window)
-- without a hard cutover, and without ever storing the raw key (only its hash).
-- =====================================================

CREATE TABLE IF NOT EXISTS public.integrator_api_keys (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integrator_id  UUID NOT NULL REFERENCES public.integrators(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at     TIMESTAMPTZ,

  -- HMAC-SHA256(key, pepper) — never the raw key. Pepper is a server-side env var
  -- (INTEGRATOR_KEY_PEPPER), so a DB leak alone doesn't allow offline brute-forcing.
  key_hash       TEXT NOT NULL UNIQUE,
  -- First ~12 chars of the raw key (e.g. "lft_live_a1b2"), plaintext, for display/support only —
  -- never enough of the key to reconstruct or guess the rest.
  key_prefix     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS integrator_api_keys_integrator_id_idx ON public.integrator_api_keys (integrator_id);
CREATE UNIQUE INDEX IF NOT EXISTS integrator_api_keys_key_hash_idx ON public.integrator_api_keys (key_hash);
-- Fast "does an active key exist for this hash" lookup on every authenticated request.
CREATE INDEX IF NOT EXISTS integrator_api_keys_active_idx ON public.integrator_api_keys (key_hash) WHERE revoked_at IS NULL;

ALTER TABLE public.integrator_api_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_integrator_api_keys ON public.integrator_api_keys;
CREATE POLICY deny_all_integrator_api_keys ON public.integrator_api_keys FOR ALL USING (false) WITH CHECK (false);

-- =====================================================
-- Attribution: which integrator created a given payment/event, for per-integrator
-- rate limiting, audit, and support ("show me everything integrator X did").
-- Nullable — first-party (Loofta frontend) and x402-anonymous payments have no integrator.
-- =====================================================

ALTER TABLE public.payments
ADD COLUMN IF NOT EXISTS integrator_id UUID REFERENCES public.integrators(id);
CREATE INDEX IF NOT EXISTS payments_integrator_id_idx ON public.payments (integrator_id) WHERE integrator_id IS NOT NULL;

ALTER TABLE public.payment_events
ADD COLUMN IF NOT EXISTS integrator_id UUID REFERENCES public.integrators(id);
CREATE INDEX IF NOT EXISTS payment_events_integrator_id_idx ON public.payment_events (integrator_id) WHERE integrator_id IS NOT NULL;
