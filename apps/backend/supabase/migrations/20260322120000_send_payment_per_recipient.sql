-- PER / username: extend recipient types and store resolved Loofta recipient Solana pubkey (for MagicBlock deposit transfers)
ALTER TABLE public.send_payment_links DROP CONSTRAINT IF EXISTS send_payment_links_recipient_type_check;
ALTER TABLE public.send_payment_links ADD CONSTRAINT send_payment_links_recipient_type_check
  CHECK (recipient_type IN ('email', 'twitter', 'username'));

ALTER TABLE public.send_payment_links ADD COLUMN IF NOT EXISTS recipient_solana_pubkey TEXT;

COMMENT ON COLUMN public.send_payment_links.recipient_solana_pubkey IS 'Resolved recipient embedded wallet (devnet/mainnet) for PER transfer_deposit; null if recipient not registered';
