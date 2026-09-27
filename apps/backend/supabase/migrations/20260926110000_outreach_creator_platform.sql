-- New prospect category: platforms and agencies that run creator / clipping / KOL
-- campaigns and pay many creators per campaign. Partnership pitch: pay creators
-- with a link, they claim with email or X handle and cash out to wallet or local bank.
ALTER TABLE outreach_prospects
  DROP CONSTRAINT IF EXISTS outreach_prospects_type_check;

ALTER TABLE outreach_prospects
  ADD CONSTRAINT outreach_prospects_type_check
  CHECK (type IN ('creator', 'KOL', 'freelancer', 'web3_project', 'giveaway_project', 'creator_platform'));

ALTER TABLE outreach_config
  ADD COLUMN IF NOT EXISTS creator_platform_pitch TEXT NOT NULL DEFAULT 'Hey, Lisa here from Loofta Pay. Saw you pay creators and clippers per campaign. We built payout links: you send the payment, they claim it with just their email or X handle, and they can cash out to a wallet or their local bank (Naira works today), no wallet setup needed on their side. Free to try and I''ll waive the fee for you. Worth a chat?';

-- Seed prospects (handles taken from each platform's own site, see
-- docs/outreach/CLIPPING_CREATOR_PLATFORM_PROSPECTS.md). Status stays 'new', nothing is sent.
INSERT INTO outreach_prospects (handle, bio, type) VALUES
  ('ClipStake_X',      'ClipStake: brand marketplace with pay-per-view short-form creator campaigns. 5,000+ creators across YouTube, TikTok, IG and X. Payout method not published.', 'creator_platform'),
  ('creator_wire',     'Creator Wire: creator campaign management for web3 teams. Vetted X creators, campaigns, deliverables, USDC payouts onchain.', 'creator_platform'),
  ('ReelluClips',      'Reellu: clipping marketplace paying USDC on Solana to Phantom wallets, 180+ countries, per-1k-view campaigns.', 'creator_platform'),
  ('p2pkols',          'P2P KOLs: crypto KOL marketplace, 1,000+ verified KOLs, escrow, pays out via a merchant partner, 20% platform fee.', 'creator_platform'),
  ('ClipAffiliates',   'ClipAffiliates: clipping marketplace, $1-5 CPM, PayPal or crypto payouts, 9% fee on brand deposits and on clipper payouts.', 'creator_platform'),
  ('clippingexe',      'Clipping.net: managed clipping campaigns, pays via PayPal or USDC/USDT on Ethereum, 100K view payout threshold.', 'creator_platform'),
  ('luminaclippers',   'Lumina Clippers / Crypto Clippers: managed clipping agency, 62,900+ verified creators claimed, crypto clients like OKX, Polkadot, Magic Eden. Pays a very large clipper base.', 'creator_platform'),
  ('clippingagencyx',  'Clipping Agency: crypto and web3 clipping agency, 10B+ views claimed, distributed clipper network.', 'creator_platform'),
  ('TheCliptic',       'Cliptic: crypto clipping agency for web3 brands.', 'creator_platform'),
  ('LuvKaizenAgency',  'Luv Kaizen: managed pay-per-view crypto clipping campaigns.', 'creator_platform')
ON CONFLICT DO NOTHING;
