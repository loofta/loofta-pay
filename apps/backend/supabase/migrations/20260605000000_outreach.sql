-- Singleton row for agent configuration
CREATE TABLE IF NOT EXISTS outreach_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  product_pitch TEXT NOT NULL DEFAULT 'Loofta Pay — private payments on Solana. Get paid and pay others without exposing your whole wallet history.',
  message_tone TEXT NOT NULL DEFAULT 'casual, crypto-native, low-pressure, peer-to-peer (not salesy)',
  call_to_action TEXT NOT NULL DEFAULT 'ask if they''d want early access',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO outreach_config (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Prospect queue
CREATE TABLE IF NOT EXISTS outreach_prospects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  handle TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'individual' CHECK (type IN ('individual', 'team')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'drafting', 'drafted', 'approved', 'rejected', 'sent')),
  draft_message TEXT,
  final_message TEXT,
  qualified BOOLEAN,
  qualification_reason TEXT,
  sent_at TIMESTAMPTZ,
  sent_via TEXT CHECK (sent_via IN ('dm', 'reply'))
);

CREATE UNIQUE INDEX IF NOT EXISTS outreach_prospects_handle_idx ON outreach_prospects (lower(handle));
