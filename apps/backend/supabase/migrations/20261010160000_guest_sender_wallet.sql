-- Signed-out sends (homepage / send form, no Privy session) are already inserted into
-- payments with created_by null. This records the Solana wallet that actually paid, so a
-- guest payment is attributable without an account. Set only after the settlement route
-- sees that wallet as a signer on the payment transaction.

ALTER TABLE public.payments
ADD COLUMN IF NOT EXISTS guest_sender_wallet TEXT;

COMMENT ON COLUMN public.payments.guest_sender_wallet IS
  'Solana address that funded a signed-out payment. Null for payments made from a Loofta account.';
