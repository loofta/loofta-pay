-- =====================================================
-- payments: clean schema for Loofta payment links
--
-- NOTE: The legacy `claims` table is NOT touched.
-- Both tables coexist. New flows use `payments`,
-- old data stays in `claims` for backward compatibility.
-- =====================================================

CREATE TABLE IF NOT EXISTS public.payments (
  -- Identity
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Who created the payment link
  created_by      TEXT,  -- Privy user ID (did:privy:...) or NULL for anonymous

  -- Payment details
  amount          NUMERIC(20, 6) NOT NULL,  -- USD amount (numeric instead of text for proper math)
  direction       TEXT NOT NULL DEFAULT 'from_sender'
                  CHECK (direction IN ('from_sender', 'from_recipient')),

  -- Recipient resolution
  recipient_address   TEXT,      -- Final Solana wallet address (set on claim)
  recipient_username  TEXT,      -- @handle for display
  recipient_email     TEXT,      -- Email if created via email invite (for matching on login)

  -- Burner escrow (encrypted — never store plaintext keys)
  -- The burner is a one-time Solana keypair that holds funds until recipient claims.
  -- Only the encrypted secret is stored; decrypted at sweep time.
  burner_address          TEXT,  -- Solana pubkey (not sensitive, but can be encrypted too)
  burner_encrypted_secret TEXT,  -- AES-256-GCM encrypted private key (HKDF per-payment)

  -- Payment status
  status          TEXT NOT NULL DEFAULT 'OPEN'
                  CHECK (status IN (
                    'OPEN',                     -- Link created, no deposit yet
                    'PENDING_DEPOSIT',          -- Deposit address assigned, waiting for funds
                    'IN_FLIGHT',                -- Tx sent, waiting for on-chain confirmation
                    'FUNDED',                   -- Funds received in burner
                    'PRIVATE_TRANSFER_PENDING', -- Funds in burner, waiting for recipient to claim
                    'SUCCESS',                  -- Funds swept to recipient wallet
                    'REFUNDED',                 -- Refunded to sender
                    'EXPIRED',                  -- Link expired (no deposit)
                    'CANCELLED',                -- Cancelled by creator
                    'DELETED'                   -- Soft-deleted
                  )),

  -- Payment completion
  paid_at         TIMESTAMPTZ,           -- When payment was confirmed on-chain
  sender_tx_hash  TEXT,                  -- Solana tx signature from sender (for verification + admin debug)
  sweep_tx_hash   TEXT,                  -- Solana tx signature for burner→recipient sweep

  -- Payment metadata
  description     TEXT,                  -- Optional message / emoji / GIF from sender
  paid_with_chain TEXT DEFAULT 'solana', -- Always solana for now, future-proof

  -- Network
  is_devnet       BOOLEAN NOT NULL DEFAULT false,

  -- Legacy link: if migrated from claims table, store the original claim ID
  legacy_claim_id UUID
);
-- Indexes
CREATE INDEX IF NOT EXISTS payments_created_at_idx ON public.payments (created_at DESC);
CREATE INDEX IF NOT EXISTS payments_status_idx ON public.payments (status);
CREATE INDEX IF NOT EXISTS payments_created_by_idx ON public.payments (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_recipient_address_idx ON public.payments (recipient_address) WHERE recipient_address IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_burner_address_idx ON public.payments (burner_address) WHERE burner_address IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_inflight_idx ON public.payments (status, created_at DESC) WHERE status = 'IN_FLIGHT' AND sender_tx_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_pending_sweep_idx ON public.payments (status, created_at DESC) WHERE status = 'PRIVATE_TRANSFER_PENDING' AND burner_encrypted_secret IS NOT NULL;
-- updated_at trigger (reuse existing function from claims schema)
DROP TRIGGER IF EXISTS trg_payments_updated_at ON public.payments;
CREATE TRIGGER trg_payments_updated_at
BEFORE UPDATE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
-- RLS: enabled with explicit deny-all (server uses service role key which bypasses RLS)
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_payments ON public.payments;
CREATE POLICY deny_all_payments ON public.payments FOR ALL USING (false) WITH CHECK (false);
-- =====================================================
-- payments_safe: view that hides sensitive fields
-- =====================================================
DROP VIEW IF EXISTS public.payments_safe;
CREATE VIEW public.payments_safe AS
SELECT
  id,
  created_at,
  updated_at,
  created_by,
  amount,
  direction,
  recipient_username,
  status,
  paid_at,
  sender_tx_hash,
  sweep_tx_hash,
  description,
  paid_with_chain,
  is_devnet,
  legacy_claim_id
FROM public.payments;
ALTER VIEW public.payments_safe SET (security_invoker = true);
-- =====================================================
-- payment_intents: deposit/quote tracking per payment
-- =====================================================
CREATE TABLE IF NOT EXISTS public.payment_intents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id      UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  quote_id        TEXT,
  deposit_address TEXT,
  memo            TEXT,
  deadline        TIMESTAMPTZ,
  time_estimate   INTEGER,
  status          TEXT,
  from_chain      TEXT,
  to_chain        TEXT,
  paid_amount     TEXT,
  last_status_payload JSONB
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_deposit_addr_uidx
  ON public.payment_intents (deposit_address) WHERE deposit_address IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_intents_payment_id_idx
  ON public.payment_intents (payment_id);
DROP TRIGGER IF EXISTS trg_payment_intents_updated_at ON public.payment_intents;
CREATE TRIGGER trg_payment_intents_updated_at
BEFORE UPDATE ON public.payment_intents
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.payment_intents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_payment_intents ON public.payment_intents;
CREATE POLICY deny_all_payment_intents ON public.payment_intents FOR ALL USING (false) WITH CHECK (false);
-- =====================================================
-- payment_events: audit log for status transitions
-- =====================================================
DROP TABLE IF EXISTS public.payment_events CASCADE;
CREATE TABLE public.payment_events (
  id          BIGSERIAL PRIMARY KEY,
  payment_id  UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  type        TEXT NOT NULL,
  payload     JSONB
);
CREATE INDEX IF NOT EXISTS payment_events_payment_id_idx
  ON public.payment_events (payment_id, created_at DESC);
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_payment_events ON public.payment_events;
CREATE POLICY deny_all_payment_events ON public.payment_events FOR ALL USING (false) WITH CHECK (false);

-- =====================================================
-- DATA MIGRATION: claims → payments
--
-- Copies all existing claims into the payments table
-- using the same UUID so existing /c/:id links keep working.
-- =====================================================
INSERT INTO public.payments (
  id,
  created_at,
  updated_at,
  created_by,
  amount,
  direction,
  recipient_address,
  recipient_username,
  recipient_email,
  burner_address,
  burner_encrypted_secret,
  status,
  paid_at,
  sender_tx_hash,
  sweep_tx_hash,
  description,
  paid_with_chain,
  is_devnet,
  legacy_claim_id
)
SELECT
  id,
  created_at,
  updated_at,
  created_by,
  -- amount: claims stores TEXT; cast to NUMERIC, default 0 on non-numeric values
  CASE
    WHEN amount ~ '^[0-9]+(\.[0-9]*)?$' THEN amount::NUMERIC(20, 6)
    ELSE 0
  END,
  -- direction: all existing claims were created by the sender
  'from_sender',
  -- recipient_address: strip PENDING_* prefixes (those are stored as username/email instead)
  CASE
    WHEN recipient_address LIKE 'PENDING_EMAIL:%' THEN NULL
    WHEN recipient_address LIKE 'PENDING_USERNAME:%' THEN NULL
    ELSE NULLIF(TRIM(recipient_address), '')
  END,
  -- recipient_username: from column, or extracted from PENDING_USERNAME: prefix
  COALESCE(
    NULLIF(TRIM(recipient_username), ''),
    CASE
      WHEN recipient_address LIKE 'PENDING_USERNAME:%'
        THEN NULLIF(TRIM(SUBSTRING(recipient_address FROM LENGTH('PENDING_USERNAME:') + 1)), '')
      ELSE NULL
    END
  ),
  -- recipient_email: from notify_email_to, or extracted from PENDING_EMAIL: prefix
  COALESCE(
    NULLIF(TRIM(notify_email_to), ''),
    CASE
      WHEN recipient_address LIKE 'PENDING_EMAIL:%'
        THEN NULLIF(TRIM(SUBSTRING(recipient_address FROM LENGTH('PENDING_EMAIL:') + 1)), '')
      ELSE NULL
    END
  ),
  claim_burner_address,           -- → burner_address
  claim_burner_encrypted_secret,  -- → burner_encrypted_secret
  status,
  paid_at,
  sender_tx_hash,
  NULL,                           -- sweep_tx_hash (no equivalent in claims)
  description,
  paid_with_chain,
  COALESCE(is_devnet, false),
  id                              -- legacy_claim_id = original claim id
FROM public.claims
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- DATA MIGRATION: claim_intents → payment_intents
-- =====================================================
INSERT INTO public.payment_intents (
  id,
  payment_id,
  created_at,
  updated_at,
  quote_id,
  deposit_address,
  memo,
  deadline,
  time_estimate,
  status,
  from_chain,
  to_chain,
  paid_amount,
  last_status_payload
)
SELECT
  ci.id,
  ci.claim_id,   -- payment_id = claim_id (same UUID after migration above)
  ci.created_at,
  ci.updated_at,
  ci.quote_id,
  ci.deposit_address,
  ci.memo,
  ci.deadline,
  ci.time_estimate,
  ci.status,
  NULL,  -- from_chain (not present in legacy claim_intents)
  NULL,  -- to_chain (not present in legacy claim_intents)
  NULL,  -- paid_amount (not present in legacy claim_intents)
  ci.last_status_payload
FROM public.claim_intents ci
-- Only migrate intents whose claim was successfully migrated to payments
WHERE EXISTS (
  SELECT 1 FROM public.payments p WHERE p.id = ci.claim_id
)
ON CONFLICT DO NOTHING;

-- =====================================================
-- DATA MIGRATION: claim_events → payment_events
-- =====================================================
INSERT INTO public.payment_events (
  id,
  payment_id,
  created_at,
  type,
  payload
)
SELECT
  ce.id,
  ce.claim_id,
  ce.created_at,
  ce.type,
  ce.payload
FROM public.claim_events ce
WHERE EXISTS (
  SELECT 1 FROM public.payments p WHERE p.id = ce.claim_id
)
ON CONFLICT (id) DO NOTHING;

-- Reset the payment_events sequence to avoid future conflicts
SELECT setval(
  'public.payment_events_id_seq',
  COALESCE((SELECT MAX(id) FROM public.payment_events), 0) + 1
);
