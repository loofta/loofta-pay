-- A payment request can ask to be paid out to a payment app (Venmo, Cash App, UPI, ...).
-- The requester picks the app and enters their username when creating the request; the claim page
-- reads these two columns to offer a one-tap "Claim and cash out to <app>" (fast, 1% under market).
-- Nothing here moves money by itself: the cash-out still needs the owner's own wallet signature.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS requested_payout_method text,
  ADD COLUMN IF NOT EXISTS requested_payout_detail text;
