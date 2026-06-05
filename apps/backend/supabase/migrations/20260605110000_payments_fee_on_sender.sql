ALTER TABLE payments ADD COLUMN IF NOT EXISTS fee_on_sender boolean DEFAULT true;
