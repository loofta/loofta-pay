-- Gift a Megapot ticket (admin feature): a lightweight, standalone table for admin-issued
-- ticket gifts, styled after `payments`' recipient-by-email/handle + claim-link conventions but
-- fully decoupled from it — the real Megapot purchase (wallets, funding, buy) only happens when
-- the recipient claims (see LotteryService.claimGift), not at gift-creation time, so a gift can
-- never be "already resolved" by the time someone opens their email.
CREATE TABLE IF NOT EXISTS public.lottery_gifts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  gifted_by_admin_id    text NOT NULL,
  num_tickets           int NOT NULL CHECK (num_tickets BETWEEN 1 AND 100),
  note                  text,

  recipient_type        text NOT NULL CHECK (recipient_type IN ('email', 'twitter')),
  recipient_identifier  text NOT NULL,  -- normalized: lowercase email, or lowercase handle without '@'

  claim_token           text NOT NULL,
  status                text NOT NULL DEFAULT 'unclaimed'
                        CHECK (status IN ('unclaimed', 'claimed', 'cancelled', 'failed')),

  claimed_at            timestamptz,
  claimed_by_user_id    text,
  resulting_ticket_id   uuid REFERENCES lottery_tickets(id),
  failure_reason        text
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_lottery_gifts_claim_token ON public.lottery_gifts (claim_token);
CREATE INDEX IF NOT EXISTS idx_lottery_gifts_status ON public.lottery_gifts (status, created_at DESC);

ALTER TABLE public.lottery_gifts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_lottery_gifts ON public.lottery_gifts;
CREATE POLICY deny_all_lottery_gifts ON public.lottery_gifts FOR ALL USING (false) WITH CHECK (false);

DROP TRIGGER IF EXISTS trg_lottery_gifts_updated_at ON public.lottery_gifts;
CREATE TRIGGER trg_lottery_gifts_updated_at
BEFORE UPDATE ON public.lottery_gifts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- The one touch to the live purchase table: lets a claim-time-purchased gift ticket skip the
-- fee-tx-hash gate in LotteryService.tryStartBridge (Loofta never charges a fee on a gift).
ALTER TABLE public.lottery_tickets ADD COLUMN IF NOT EXISTS is_gift boolean NOT NULL DEFAULT false;
