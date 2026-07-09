-- Unify recipient targeting to match the existing "Send" UX: one field that accepts an email,
-- a Loofta username, or an X/Twitter handle — no explicit type picker. 'twitter' is renamed to
-- the broader 'handle', resolved against BOTH twitter and username identities at claim time
-- (see LotteryService.claimGift) since the sender doesn't (and shouldn't have to) know which one
-- the recipient will end up matching.
ALTER TABLE public.lottery_gifts DROP CONSTRAINT IF EXISTS lottery_gifts_recipient_type_check;
UPDATE public.lottery_gifts SET recipient_type = 'handle' WHERE recipient_type = 'twitter';
ALTER TABLE public.lottery_gifts ADD CONSTRAINT lottery_gifts_recipient_type_check
  CHECK (recipient_type IN ('email', 'handle'));
