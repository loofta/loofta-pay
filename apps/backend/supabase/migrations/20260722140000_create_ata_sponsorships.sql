-- =====================================================
-- ata_sponsorships: anti-drain ledger for sponsor-paid ATA creation
--
-- Whenever our fee-payer sponsor pays the rent (~0.00204 SOL) to create a wallet's USDC
-- associated token account, that rent is only ours to lose once: the account's owner can
-- close it later and reclaim the rent for themselves. Without a record of "we already paid
-- for this wallet's ATA", nothing stops the same wallet from being sponsored again after the
-- owner closes it — create, close, repeat, for free, forever, at our expense.
--
-- One row per (wallet_address, mint) we have ever sponsored. Before sponsoring an ATA
-- creation, the backend inserts here first; a unique-violation means it was already paid for
-- once and must NOT be paid for again — see claims.service.ts guardAtaSponsorship().
-- =====================================================

CREATE TABLE IF NOT EXISTS public.ata_sponsorships (
  wallet_address  TEXT NOT NULL,
  mint            TEXT NOT NULL,
  first_sponsored_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  context         TEXT,  -- e.g. "claim:<id>" or "reclaim:<id>", for audit/debugging only

  PRIMARY KEY (wallet_address, mint)
);

-- Security: all access goes through service-role backend code
ALTER TABLE public.ata_sponsorships ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ata_sponsorships FROM anon, authenticated;
