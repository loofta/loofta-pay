-- =====================================================
-- private_transfers: burner-relay private deposit/withdrawal
--
-- Private Deposit:    external/other-chain funds -> burner -> user's Loofta wallet
--                      (leg2 = burner sends to user via MagicBlock private transfer)
-- Private Withdrawal: user's Loofta wallet -> burner -> destination address/chain
--                      (leg1 = user sends to burner via MagicBlock private transfer,
--                       leg2 = burner sends to destination, direct SPL or Near Intents)
--
-- The burner is a one-time Solana keypair, same pattern as payments.burner_address /
-- payments.burner_encrypted_secret — only the encrypted secret is stored, decrypted
-- server-side at sweep time via SendPaymentEncryptionService (SEND_PAYMENT_ENC_KEY, KMS-wrapped).
-- =====================================================

CREATE TABLE IF NOT EXISTS public.private_transfers (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Who this belongs to
  user_id                  TEXT NOT NULL,  -- Privy user ID (did:privy:...)

  direction                TEXT NOT NULL
                            CHECK (direction IN ('deposit', 'withdrawal')),

  status                   TEXT NOT NULL
                            CHECK (status IN (
                              -- deposit states
                              'awaiting_funds',
                              'delivering_privately',
                              -- withdrawal states
                              'awaiting_signature',
                              'delivering_to_burner',
                              -- shared states
                              'bridging',
                              'complete',
                              'failed'
                            )),

  -- Burner escrow (encrypted — never store plaintext keys)
  burner_address           TEXT NOT NULL,  -- Solana pubkey
  burner_encrypted_secret  TEXT NOT NULL,  -- AES-256-GCM encrypted private key (HKDF per-transfer)

  -- Deposit: source token the user is funding from. Withdrawal: destination token.
  -- NULL means USDC on Solana direct (no Near Intents leg involved).
  source_or_dest_token     JSONB,          -- { symbol, chain }

  amount_requested_usdc    NUMERIC(20, 6) NOT NULL,
  cluster                  TEXT NOT NULL DEFAULT 'mainnet'
                            CHECK (cluster IN ('mainnet', 'devnet')),

  -- Near Intents cross-chain leg (deposit: inbound to burner; withdrawal: outbound from burner)
  near_deposit_address     TEXT,
  near_memo                TEXT,

  -- Withdrawal only: user's private-transfer signature sending funds to the burner
  leg1_tx_signature        TEXT,
  -- Burner's outbound signature: deposit's private transfer to the user, or withdrawal's
  -- sweep to the destination (direct SPL transfer or Near Intents deposit tx)
  leg2_tx_signature        TEXT,

  -- Withdrawal only: user-entered final destination address
  destination_address      TEXT,

  error_message             TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS private_transfers_user_id_idx ON public.private_transfers (user_id);
CREATE INDEX IF NOT EXISTS private_transfers_status_idx ON public.private_transfers (status);

-- updated_at trigger (reuse existing function from claims/payments schema)
DROP TRIGGER IF EXISTS trg_private_transfers_updated_at ON public.private_transfers;
CREATE TRIGGER trg_private_transfers_updated_at
BEFORE UPDATE ON public.private_transfers
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Security: all access goes through service-role API routes
ALTER TABLE public.private_transfers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.private_transfers FROM anon, authenticated;
