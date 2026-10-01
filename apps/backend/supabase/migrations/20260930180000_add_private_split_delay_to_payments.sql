-- The sender's chosen MagicBlock privacy split/delay (PrivacyTimingControls on the Send form,
-- home-v3, GuestCheckoutPay) previously only ever traveled as ?split=&delayMs= on the redirect
-- URL to /c/[id] — never persisted. That meant: a recipient's own view of the claim, a guest
-- sender revisiting their own link without the query params, or any UI copy stating "up to X
-- minutes" had no way to know the real chosen delay and either showed a stale hardcoded ~10
-- minute default or lost the value entirely. Storing it on the row itself fixes both.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS private_split integer,
  ADD COLUMN IF NOT EXISTS private_max_delay_ms integer;
