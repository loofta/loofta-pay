-- =====================================================
-- Optional webhook for API-created payment links (POST /payment-links). NULL for every
-- human-created claim — only set when the integrator passed webhook_url at creation time.
-- webhook_secret signs the outgoing POST (X-Loofta-Signature) so the receiving merchant server
-- can verify a "payment.succeeded" callback actually came from Loofta.
-- =====================================================

ALTER TABLE public.payments
ADD COLUMN IF NOT EXISTS webhook_url TEXT,
ADD COLUMN IF NOT EXISTS webhook_secret TEXT;
