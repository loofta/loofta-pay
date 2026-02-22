-- Unique burner per claim (like send-payment): controlled by platform Solana key for pending username/email claims
alter table public.claims
  add column if not exists claim_burner_address text,
  add column if not exists claim_burner_encrypted_secret text;

comment on column public.claims.claim_burner_address is 'Solana pubkey of one-time burner for PENDING_* claims; quote/deposit use this so funds land here until recipient claims';
comment on column public.claims.claim_burner_encrypted_secret is 'Encrypted burner secret (SEND_PAYMENT_ENC_KEY); used to sweep USDC to recipient on claim';
