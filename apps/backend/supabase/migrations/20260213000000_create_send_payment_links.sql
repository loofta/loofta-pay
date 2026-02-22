-- Send payment links: sender commits funds; recipient identified by email or Twitter; claim via Privy login
-- Migration: 20260213000000_create_send_payment_links

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
    'OPEN',      -- created, not yet funded
    'FUNDED',    -- deposit received
    'CLAIMED',   -- recipient claimed
    'CANCELLED', -- sender reclaimed or cancelled
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
