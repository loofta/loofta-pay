-- Hosted MCP login (OAuth 2.1 with PKCE) for clients like Claude and ChatGPT: they register themselves,
-- send the person to the Loofta app to approve, then swap a one-time code for the same revocable session
-- token the CLI login produces. Codes are stored hashed, valid for minutes, and usable once.

CREATE TABLE IF NOT EXISTS public.agent_oauth_clients (
  client_id      TEXT PRIMARY KEY,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  client_name    TEXT NOT NULL DEFAULT 'Agent',
  redirect_uris  TEXT[] NOT NULL
);

CREATE TABLE IF NOT EXISTS public.agent_oauth_codes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  code_hash       TEXT NOT NULL UNIQUE,
  client_id       TEXT NOT NULL REFERENCES public.agent_oauth_clients(client_id) ON DELETE CASCADE,
  redirect_uri    TEXT NOT NULL,
  code_challenge  TEXT NOT NULL,              -- S256 only
  user_id         TEXT NOT NULL,
  session_id      UUID NOT NULL REFERENCES public.agent_sessions(id) ON DELETE CASCADE,
  used_at         TIMESTAMPTZ
);

ALTER TABLE public.agent_oauth_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_oauth_codes   ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_agent_oauth_clients ON public.agent_oauth_clients;
DROP POLICY IF EXISTS deny_all_agent_oauth_codes   ON public.agent_oauth_codes;
CREATE POLICY deny_all_agent_oauth_clients ON public.agent_oauth_clients FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY deny_all_agent_oauth_codes   ON public.agent_oauth_codes   FOR ALL USING (false) WITH CHECK (false);
REVOKE ALL ON public.agent_oauth_clients FROM anon, authenticated;
REVOKE ALL ON public.agent_oauth_codes   FROM anon, authenticated;
