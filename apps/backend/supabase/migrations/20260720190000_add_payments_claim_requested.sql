-- Every payment now requires an explicit claim — a recipient must choose how to claim
-- (to wallet / privately / external address) before any funds move out of the burner.
-- cronSweepPendingBurners previously auto-swept ANY funded burner with a resolved
-- recipient_address straight to the recipient's default wallet, with no way to tell "the
-- recipient already asked to claim, just retry it" apart from "nobody has touched this yet" —
-- for a registered recipient (recipient_address resolved at creation time), that meant the
-- cron silently completed the claim on the recipient's behalf, defeating the whole point.
--
-- claim_requested_at is stamped the moment a genuine claimAsRecipient attempt begins; the cron
-- now only retries claims where this is set. claim_requested_privately/_destination persist the
-- recipient's actual choice so a deferred retry (funds not yet landed, or a server restart)
-- resumes with the SAME choice instead of silently falling back to a plain public sweep.
ALTER TABLE public.payments
ADD COLUMN IF NOT EXISTS claim_requested_at timestamptz,
ADD COLUMN IF NOT EXISTS claim_requested_privately boolean,
ADD COLUMN IF NOT EXISTS claim_requested_destination text;
