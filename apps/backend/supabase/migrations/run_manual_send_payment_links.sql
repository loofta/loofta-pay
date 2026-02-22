-- Run this in Supabase SQL Editor if the migration never applied (e.g. branch/migration sync issue).
-- Creates send_payment_links table. Requires public.set_updated_at() to exist (from claims schema).

CREATE TABLE IF NOT EXISTS public.send_payment_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  sender_user_id TEXT NOT NULL,
  amount TEXT NOT NULL,
  token TEXT NOT NULL DEFAULT 'USDC',
  chain TEXT NOT NULL DEFAULT 'solana',

  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('email', 'twitter')),
  recipient_identifier TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN (
    'OPEN',
    'FUNDED',
    'CLAIMED',
    'CANCELLED',
    'EXPIRED'
  )),

  burner_address TEXT,
  burner_encrypted_secret TEXT,
  deposit_tx_hash TEXT,
  claim_tx_hash TEXT,
  receiver_privy_user_id TEXT,

  message TEXT,
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_send_payment_links_sender ON public.send_payment_links(sender_user_id);
CREATE INDEX IF NOT EXISTS idx_send_payment_links_status ON public.send_payment_links(status);
CREATE INDEX IF NOT EXISTS idx_send_payment_links_created_at ON public.send_payment_links(created_at DESC);

ALTER TABLE public.send_payment_links ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_send_payment_links_updated_at ON public.send_payment_links;
CREATE TRIGGER trg_send_payment_links_updated_at
  BEFORE UPDATE ON public.send_payment_links
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Optional: add private (Privacy Cash) claim columns if you already had the table
ALTER TABLE public.send_payment_links
  ADD COLUMN IF NOT EXISTS private_claim_activity_id TEXT,
  ADD COLUMN IF NOT EXISTS private_claim_passphrase TEXT,
  ADD COLUMN IF NOT EXISTS private_claim_sender_address TEXT,
  ADD COLUMN IF NOT EXISTS private_claim_burner_address TEXT,
  ADD COLUMN IF NOT EXISTS private_claim_encrypted_receiver TEXT,
  ADD COLUMN IF NOT EXISTS private_claim_encrypted_sender TEXT;

-- Reload PostgREST schema so the API sees the new table
NOTIFY pgrst, 'reload schema';
