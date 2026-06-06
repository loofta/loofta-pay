-- User tier system: cache total mainnet volume per user for fast tier lookups
-- Tier bands: Noob $0-500 | Plus $500-1k | Pro $1k-5k | Platinum $5k-10k | Elite $10k-50k | Diamond $50k-100k | OG $100k+

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS total_volume_usd NUMERIC(20,2) NOT NULL DEFAULT 0;

-- Partial indexes for fast volume aggregation — only index mainnet SUCCESS rows
CREATE INDEX IF NOT EXISTS idx_payments_sender_volume
  ON payments(sender_user_id)
  WHERE status = 'SUCCESS' AND is_devnet = FALSE AND sender_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_recipient_volume
  ON payments(created_by)
  WHERE status = 'SUCCESS' AND is_devnet = FALSE;

-- Compute total mainnet volume for a user (sent + received, no double-count)
CREATE OR REPLACE FUNCTION compute_user_volume_usd(p_privy_user_id TEXT)
RETURNS NUMERIC AS $$
  SELECT COALESCE(SUM(amount), 0)
  FROM payments
  WHERE status = 'SUCCESS'
    AND is_devnet = FALSE
    AND (
      sender_user_id = p_privy_user_id
      OR (
        created_by = p_privy_user_id
        AND (sender_user_id IS NULL OR sender_user_id != p_privy_user_id)
      )
    )
$$ LANGUAGE SQL STABLE;

-- Trigger function: refresh total_volume_usd when a payment transitions to SUCCESS
CREATE OR REPLACE FUNCTION refresh_user_volume_on_payment()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'SUCCESS'
     AND (OLD.status IS NULL OR OLD.status != 'SUCCESS')
     AND NEW.is_devnet = FALSE
  THEN
    -- Refresh sender volume
    IF NEW.sender_user_id IS NOT NULL THEN
      UPDATE app_users
      SET total_volume_usd = compute_user_volume_usd(NEW.sender_user_id)
      WHERE privy_user_id = NEW.sender_user_id;
    END IF;
    -- Refresh recipient volume (created_by = payment creator = recipient)
    IF NEW.created_by IS NOT NULL
       AND (NEW.sender_user_id IS NULL OR NEW.created_by != NEW.sender_user_id)
    THEN
      UPDATE app_users
      SET total_volume_usd = compute_user_volume_usd(NEW.created_by)
      WHERE privy_user_id = NEW.created_by;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_refresh_user_volume ON payments;
CREATE TRIGGER trg_refresh_user_volume
  AFTER INSERT OR UPDATE OF status ON payments
  FOR EACH ROW EXECUTE FUNCTION refresh_user_volume_on_payment();

-- Backfill existing successful mainnet payments
UPDATE app_users u
SET total_volume_usd = compute_user_volume_usd(u.privy_user_id)
WHERE EXISTS (
  SELECT 1 FROM payments p
  WHERE p.status = 'SUCCESS'
    AND p.is_devnet = FALSE
    AND (p.sender_user_id = u.privy_user_id OR p.created_by = u.privy_user_id)
);
