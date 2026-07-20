CREATE TABLE IF NOT EXISTS social_accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL,
  platform      TEXT NOT NULL CHECK (platform IN ('discord', 'github', 'telegram')),
  handle        TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, platform)
);

CREATE INDEX IF NOT EXISTS social_accounts_user_id_idx ON social_accounts (user_id);
CREATE INDEX IF NOT EXISTS social_accounts_platform_handle_idx ON social_accounts (platform, handle);

DROP TRIGGER IF EXISTS trg_social_accounts_updated_at ON public.social_accounts;
CREATE TRIGGER trg_social_accounts_updated_at
  BEFORE UPDATE ON public.social_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Security: all access goes through service-role API routes
ALTER TABLE public.social_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_accounts FROM anon, authenticated;
