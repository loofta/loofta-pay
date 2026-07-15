-- Distinguishes multi-send recipient rows (which only need to satisfy the batch-level $5
-- minimum enforced in BuildMultiSendDto) from standalone payment/claim links (which enforce a
-- $5 minimum per link in claims.service.ts buildPrivateTransferForPayer).
ALTER TABLE payments ADD COLUMN IF NOT EXISTS is_multi_send boolean DEFAULT false;
