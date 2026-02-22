-- Add 'DELETED' status to claims table (soft delete: payment hidden from client, not cancelled)
ALTER TABLE public.claims
DROP CONSTRAINT IF EXISTS claims_status_check;

ALTER TABLE public.claims
ADD CONSTRAINT claims_status_check
CHECK (status IN ('OPEN','PENDING_DEPOSIT','IN_FLIGHT','PRIVATE_TRANSFER_PENDING','SUCCESS','REFUNDED','EXPIRED','CANCELLED','DELETED'));
