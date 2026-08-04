CREATE TABLE IF NOT EXISTS email_unsubscribes (
  email           TEXT PRIMARY KEY,
  unsubscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source          TEXT
);

-- Security: all access goes through service-role API routes
ALTER TABLE public.email_unsubscribes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_unsubscribes FROM anon, authenticated;
