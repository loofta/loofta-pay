ALTER TABLE lottery_tickets
  ADD COLUMN IF NOT EXISTS bridge_expires_at timestamptz;
