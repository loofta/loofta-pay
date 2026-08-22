-- One row per Megapot referral-fee claim (claimReferralFees() call), recorded after the backend
-- verifies the tx on-chain (ReferralFeesClaimed event) — see AdminLotteryController's
-- POST /admin/lottery/referral-fees/claim. Lets the admin panel show claimed vs unclaimed totals
-- over time instead of only the live unclaimed balance.
CREATE TABLE IF NOT EXISTS megapot_referral_fee_claims (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_hash         text NOT NULL UNIQUE,
  claimer_address text NOT NULL,
  amount_usdc     numeric(20,6) NOT NULL,
  block_number    bigint,
  claimed_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS megapot_referral_fee_claims_claimed_at_idx ON megapot_referral_fee_claims (claimed_at);

-- Security: all access goes through service-role API routes
ALTER TABLE public.megapot_referral_fee_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.megapot_referral_fee_claims FROM anon, authenticated;

-- Backfill: claims made before this table existed, pulled from on-chain history
-- (ReferralFeesClaimed / USDC Transfer logs on the Megapot Jackpot contract, Base mainnet) for
-- referrer wallet 0x50c236e3B93D3d69fe23F4D648A13901e6DdbC39. Sums to 99.367124 USDC.
INSERT INTO megapot_referral_fee_claims (tx_hash, claimer_address, amount_usdc, claimed_at) VALUES
  ('0x701464f53f9cab891d4fd26ab3e6c00d53f2241473955ae3b3f04ea0755b1c2d', '0x50c236e3B93D3d69fe23F4D648A13901e6DdbC39', 11.130339, '2026-07-09T23:14:57Z'),
  ('0xb5e824521ff4f6d25f38131407a147fd5a1ca73bb8c2ff179277b9191370cbe4', '0x50c236e3B93D3d69fe23F4D648A13901e6DdbC39', 8.707945,  '2026-07-11T19:33:53Z'),
  ('0x8bbb920029960834ead754b0db6f1ff32514708d65a1266ac880ca64c6ed29dd', '0x50c236e3B93D3d69fe23F4D648A13901e6DdbC39', 10.679576, '2026-07-16T13:44:29Z'),
  ('0x4eeff63011a0829085e2585d1b870995010c3832fcbd2bf02de1ff3fee90e6de', '0x50c236e3B93D3d69fe23F4D648A13901e6DdbC39', 12.415170, '2026-07-22T10:35:47Z'),
  ('0xed4165aae29ec628c164af896125107c28af71b5190598a5c62f8c782c5bd71e', '0x50c236e3B93D3d69fe23F4D648A13901e6DdbC39', 12.732967, '2026-07-26T10:55:25Z'),
  ('0x681293d63a1cc1a9685e92abed97fcb7553cc50f2bf35d34d43e3664304a3ce7', '0x50c236e3B93D3d69fe23F4D648A13901e6DdbC39', 15.310361, '2026-07-29T13:21:55Z'),
  ('0x493462aefe316ff3b9f0bb195f2d3238674b1e93197a79e7eb79db891c64de40', '0x50c236e3B93D3d69fe23F4D648A13901e6DdbC39', 13.118389, '2026-08-01T08:46:39Z'),
  ('0xae56b97f79e610533e1c69f2dc2406dd8f8149847209bec561b5abfe09391776', '0x50c236e3B93D3d69fe23F4D648A13901e6DdbC39', 3.203233,  '2026-08-01T22:30:59Z'),
  ('0x9b46815889a7bf52debb0559924f98d4bf7a8904958afde92755ad164857962b', '0x50c236e3B93D3d69fe23F4D648A13901e6DdbC39', 12.069144, '2026-08-06T16:30:41Z')
ON CONFLICT (tx_hash) DO NOTHING;
