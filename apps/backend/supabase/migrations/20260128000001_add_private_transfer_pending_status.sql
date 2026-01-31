-- Add 'private_transfer_pending' status to claims table
-- This status is for private cross-chain payments waiting for Privacy Cash execution
ALTER TABLE public.claims
DROP CONSTRAINT IF EXISTS claims_status_check;

ALTER TABLE public.claims
ADD CONSTRAINT claims_status_check 
CHECK (status IN ('OPEN','PENDING_DEPOSIT','IN_FLIGHT','PRIVATE_TRANSFER_PENDING','SUCCESS','REFUNDED','EXPIRED','CANCELLED'));
