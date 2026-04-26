-- =====================================================
-- DATA MIGRATION: legacy claims → payments
--
-- Targets the current payments schema (from_chain, to_chain,
-- to_token, sender_user_id, expires_at).
-- Safe to re-run — all inserts use ON CONFLICT DO NOTHING.
-- =====================================================

-- claims → payments
INSERT INTO public.payments (
  id,
  created_at,
  updated_at,
  created_by,
  sender_user_id,
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
  from_chain,
  from_token,
  to_chain,
  to_token,
  is_devnet,
  legacy_claim_id
)
SELECT
  id,
  created_at,
  updated_at,
  created_by,
  -- sender_user_id: same as created_by for sender-initiated claims
  created_by,
  -- amount: claims stored as TEXT; cast to NUMERIC, default 0 on non-numeric values
  CASE
    WHEN amount ~ '^[0-9]+(\.[0-9]*)?$' THEN amount::NUMERIC(20, 6)
    ELSE 0
  END,
  'from_sender',
  -- recipient_address: strip PENDING_* prefixes
  CASE
    WHEN recipient_address LIKE 'PENDING_EMAIL:%'    THEN NULL
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
  claim_burner_address,
  claim_burner_encrypted_secret,
  status,
  paid_at,
  sender_tx_hash,
  NULL,          -- sweep_tx_hash (no equivalent in claims)
  description,
  COALESCE(NULLIF(TRIM(paid_with_chain), ''), 'solana'),  -- → from_chain
  NULL,          -- from_token (unknown for legacy claims)
  'solana',      -- to_chain (all legacy claims settled on Solana)
  'USDC',        -- to_token
  COALESCE(is_devnet, false),
  id             -- legacy_claim_id = original claim id
FROM public.claims
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- claim_intents → payment_intents
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
  ci.claim_id,
  ci.created_at,
  ci.updated_at,
  ci.quote_id,
  ci.deposit_address,
  ci.memo,
  ci.deadline,
  ci.time_estimate,
  ci.status,
  NULL,
  NULL,
  NULL,
  ci.last_status_payload
FROM public.claim_intents ci
WHERE EXISTS (
  SELECT 1 FROM public.payments p WHERE p.id = ci.claim_id
)
ON CONFLICT DO NOTHING;

-- =====================================================
-- claim_events → payment_events
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

-- Reset sequence to avoid future ID conflicts
SELECT setval(
  'public.payment_events_id_seq',
  COALESCE((SELECT MAX(id) FROM public.payment_events), 0) + 1
);
