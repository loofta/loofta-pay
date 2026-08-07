-- =====================================================
-- ata_sponsorships: cap same-caller repeat sponsorships
--
-- guardAtaSponsorship() (apps/backend/src/common/ata-sponsorship-guard.ts) allows the SAME
-- authenticated caller to re-fund a (wallet, mint) it already sponsored before, unconditionally
-- forever -- added 2026-07-30 to stop legitimate repeat payments (e.g. to a destination whose ATA
-- auto-closed) from being blocked outright. That "always re-allow" turned into the mechanism for
-- a recurring drain (2026-08-06): the same authenticated attacker repeatedly re-created a small,
-- reused fleet of destination wallets, closing each one afterward to reclaim the rent, then paying
-- into it again days later to trigger a fresh sponsorship -- an unbounded create-close-repeat loop
-- against a single (wallet, mint), just gated behind one Privy login instead of none.
--
-- repeat_count tracks how many times a same-caller repeat has been allowed for this (wallet, mint)
-- so the guard can cap it (a handful of legitimate repeats are fine; unlimited is the drain).
-- =====================================================

ALTER TABLE public.ata_sponsorships
  ADD COLUMN IF NOT EXISTS repeat_count INTEGER NOT NULL DEFAULT 0;
