-- Agent access: an AI agent (MCP / CLI) logs in as a person with a device code, gets a revocable
-- session token with its own limits, and every payment it asks for is either inside those limits
-- or waits for the person's approval. Tokens are stored hashed; the plain token is shown once.

CREATE TABLE IF NOT EXISTS public.agent_sessions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id              TEXT NOT NULL,                       -- Privy user id the agent acts as
  label                TEXT NOT NULL DEFAULT 'Agent',
  token_hash           TEXT NOT NULL UNIQUE,                -- sha256 of the session token ('pending:<id>' until the agent first collects it)
  token_prefix         TEXT NOT NULL,                       -- first chars, so the person can recognise it
  scopes               TEXT[] NOT NULL DEFAULT ARRAY['read','pay'],   -- read, pay, withdraw
  per_payment_cap_usd  NUMERIC(12,2) NOT NULL DEFAULT 25 CHECK (per_payment_cap_usd > 0),
  daily_cap_usd        NUMERIC(12,2) NOT NULL DEFAULT 100 CHECK (daily_cap_usd > 0),
  auto_approve_usd     NUMERIC(12,2) NOT NULL DEFAULT 5 CHECK (auto_approve_usd >= 0),  -- 0 = every payment needs approval
  expires_at           TIMESTAMPTZ NOT NULL,
  revoked_at           TIMESTAMPTZ,
  last_used_at         TIMESTAMPTZ,
  created_from_ip      TEXT
);
CREATE INDEX IF NOT EXISTS agent_sessions_user_idx ON public.agent_sessions (user_id) WHERE revoked_at IS NULL;

-- The login: a short code shown in the agent's terminal, approved by the person in the app.
CREATE TABLE IF NOT EXISTS public.agent_device_codes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL,
  device_code_hash  TEXT NOT NULL UNIQUE,                   -- sha256 of the secret the agent polls with
  user_code         TEXT NOT NULL UNIQUE,                   -- XXXX-XXXX, what the person types in the app
  label             TEXT NOT NULL DEFAULT 'Agent',
  requested_scopes  TEXT[] NOT NULL DEFAULT ARRAY['read','pay'],
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','consumed')),
  user_id           TEXT,
  session_id        UUID REFERENCES public.agent_sessions(id) ON DELETE SET NULL,
  requester_ip      TEXT,
  requester_agent   TEXT,
  last_polled_at    TIMESTAMPTZ
);

-- Every payment an agent asks for. One row per request, recipients in payload.
CREATE TABLE IF NOT EXISTS public.agent_actions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL,
  session_id       UUID NOT NULL REFERENCES public.agent_sessions(id),
  user_id          TEXT NOT NULL,
  kind             TEXT NOT NULL DEFAULT 'pay' CHECK (kind IN ('pay')),
  idempotency_key  TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('needs_approval','processing','paid','partial','failed','denied','expired','unconfirmed')),
  amount_usd       NUMERIC(12,2) NOT NULL CHECK (amount_usd > 0),   -- total of the request, before fees
  is_private       BOOLEAN NOT NULL DEFAULT false,
  handles          TEXT[] NOT NULL DEFAULT '{}',
  payload          JSONB NOT NULL,                                  -- recipients, quote and, once run, per-recipient results
  error            TEXT,
  UNIQUE (session_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS agent_actions_user_idx ON public.agent_actions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_actions_spend_idx ON public.agent_actions (user_id, created_at) WHERE status IN ('paid','partial','processing','unconfirmed');

ALTER TABLE public.agent_sessions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_device_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_actions      ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_agent_sessions ON public.agent_sessions;
DROP POLICY IF EXISTS deny_all_agent_device_codes ON public.agent_device_codes;
DROP POLICY IF EXISTS deny_all_agent_actions ON public.agent_actions;
CREATE POLICY deny_all_agent_sessions     ON public.agent_sessions     FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY deny_all_agent_device_codes ON public.agent_device_codes FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY deny_all_agent_actions      ON public.agent_actions      FOR ALL USING (false) WITH CHECK (false);
REVOKE ALL ON public.agent_sessions, public.agent_device_codes, public.agent_actions FROM anon, authenticated;
