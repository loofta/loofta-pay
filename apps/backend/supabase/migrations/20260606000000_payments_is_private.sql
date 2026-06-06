ALTER TABLE payments ADD COLUMN IF NOT EXISTS is_private boolean DEFAULT true;
