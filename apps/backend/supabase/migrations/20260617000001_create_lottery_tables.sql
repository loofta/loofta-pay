-- Lottery tickets: one row per purchase event (fresh companion wallet per ticket)
CREATE TABLE IF NOT EXISTS lottery_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,

  -- Companion wallet on Base (server-managed EOA, fresh per purchase)
  companion_address text NOT NULL,
  companion_key_enc text NOT NULL,

  -- Solana burner (receives MagicBlock private transfer, then bridges to Base)
  burner_sol_address text,
  burner_sol_key_enc text,

  -- NEAR Intents bridge quote (Solana burner → Base companion)
  bridge_deposit_address text,
  bridge_memo text,
  bridge_quote_id text,
  bridge_status text DEFAULT 'pending',

  -- Purchase details
  num_tickets int NOT NULL DEFAULT 1,
  cost_usdc numeric(20,6) NOT NULL,
  ticket_nft_ids jsonb DEFAULT '[]',

  -- Megapot round
  round_id text,
  draw_time timestamptz,

  -- Lifecycle: pending_send → sent → bridging → buying → active → won | lost | failed
  status text NOT NULL DEFAULT 'pending_send',

  -- MagicBlock sender tx
  sender_tx_hash text,

  -- Result
  win_amount_usdc numeric(20,6),
  win_tier int,
  claim_tx_hash text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Lottery withdrawals: one row per withdrawal request
CREATE TABLE IF NOT EXISTS lottery_withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  ticket_id uuid NOT NULL REFERENCES lottery_tickets(id),

  route text NOT NULL,             -- 'base' | 'solana_private'
  destination_address text NOT NULL,
  amount_usdc numeric(20,6) NOT NULL,

  -- Base withdrawal
  base_tx_hash text,

  -- Solana private withdrawal (NEAR Intents → fresh burner → MagicBlock)
  bridge_deposit_address text,
  bridge_status text,
  withdrawal_burner_sol_address text,
  withdrawal_burner_sol_key_enc text,
  magicblock_tx_hash text,

  status text NOT NULL DEFAULT 'pending',
  error_message text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lottery_tickets_user_id_idx ON lottery_tickets (user_id);
CREATE INDEX IF NOT EXISTS lottery_tickets_status_idx ON lottery_tickets (status);
CREATE INDEX IF NOT EXISTS lottery_tickets_companion_idx ON lottery_tickets (companion_address);
CREATE INDEX IF NOT EXISTS lottery_tickets_bridge_idx ON lottery_tickets (bridge_deposit_address) WHERE bridge_deposit_address IS NOT NULL;
CREATE INDEX IF NOT EXISTS lottery_withdrawals_user_id_idx ON lottery_withdrawals (user_id);
CREATE INDEX IF NOT EXISTS lottery_withdrawals_ticket_id_idx ON lottery_withdrawals (ticket_id);
CREATE INDEX IF NOT EXISTS lottery_withdrawals_status_idx ON lottery_withdrawals (status);

ALTER TABLE lottery_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE lottery_withdrawals ENABLE ROW LEVEL SECURITY;

-- Service role manages all operations server-side
CREATE POLICY "service_lottery_tickets_all" ON lottery_tickets FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_lottery_withdrawals_all" ON lottery_withdrawals FOR ALL USING (true) WITH CHECK (true);
