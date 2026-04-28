CREATE TABLE IF NOT EXISTS mainnet_waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  display_name text,
  email text,
  telegram_handle text,
  twitter_username text,
  preferred_comms text,
  age_range text,
  occupation text,
  payment_volume text,
  payment_type text,
  fiat_to_crypto boolean DEFAULT false,
  withdrawal_rails text[],
  earn_interest boolean DEFAULT false,
  privy_user_id text
);

CREATE INDEX IF NOT EXISTS mainnet_waitlist_email_idx ON mainnet_waitlist (email);
CREATE INDEX IF NOT EXISTS mainnet_waitlist_created_at_idx ON mainnet_waitlist (created_at DESC);
