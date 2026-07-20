-- Fast lookup for "has this sender ever paid this recipient a public (non-private) payment
-- before" — backs the privacy nudge that warns a sender their recipient already knows their
-- wallet address. Partial + composite since only completed, non-private payments are relevant.
CREATE INDEX IF NOT EXISTS payments_sender_recipient_public_idx
  ON public.payments (sender_user_id, recipient_user_id)
  WHERE is_private = false AND status = 'SUCCESS';
