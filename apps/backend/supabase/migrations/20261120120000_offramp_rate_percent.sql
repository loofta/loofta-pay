-- Percent under the market rate the market maker keeps on a cash-out. NULL means the standard rate (0%, free for the
-- sender). 1 is fast delivery, chosen at checkout, and the sender can raise it later on an open order. Loofta takes none of it.
ALTER TABLE offramp_requests ADD COLUMN IF NOT EXISTS rate_percent NUMERIC(4,2);
