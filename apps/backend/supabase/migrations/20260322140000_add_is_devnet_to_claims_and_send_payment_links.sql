-- Flag payments created while the app targets Solana devnet/testnet (vs mainnet) for history filtering.
ALTER TABLE public.claims
  ADD COLUMN IF NOT EXISTS is_devnet BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.claims.is_devnet IS 'True when payment was created on devnet/testnet cluster; false for mainnet.';

CREATE INDEX IF NOT EXISTS idx_claims_created_by_is_devnet
  ON public.claims (created_by, is_devnet, created_at DESC);

ALTER TABLE public.send_payment_links
  ADD COLUMN IF NOT EXISTS is_devnet BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.send_payment_links.is_devnet IS 'True when link was created on devnet/testnet cluster; false for mainnet.';

CREATE INDEX IF NOT EXISTS idx_send_payment_links_sender_is_devnet
  ON public.send_payment_links (sender_user_id, is_devnet, created_at DESC);
