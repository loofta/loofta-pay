# Privacy: commitment-based attestation (implemented)

The contract stores **no plaintext** amount, token, or recipient on-chain. Only:

- **claim_id** — idempotency and linking to off-chain records
- **execution_ref** — link to execution (e.g. quote_id, deposit_address)
- **commitment** — 32-byte SHA256 hash of a canonical preimage (see below)
- **timestamp_nanos** — block timestamp when attested

So on-chain **privacy is minimal but real**: amount, token_symbol, token_chain, and recipient_id are not visible; only a commitment is stored.

## Canonical preimage (must match backend)

Preimage is a single string, newline-delimited, in this order:

```
claim_id
execution_ref
amount
token_symbol
token_chain
recipient_id   (empty string if null)
nonce_hex      (64 hex chars, 32-byte random from backend)
```

Then **commitment = SHA256(preimage)**. The backend generates the nonce, computes the commitment, calls `record_payment(claim_id, execution_ref, commitment)`, and stores the nonce in the DB (`attestation_nonce`) so that anyone with the off-chain data can verify: recompute the preimage and hash; it must equal the on-chain commitment.

## Verification

Given a claim’s off-chain data (amount, token, recipient, etc.) and `attestation_nonce` from the DB:

1. Build preimage: `claim_id + "\n" + execution_ref + "\n" + amount + "\n" + token_symbol + "\n" + token_chain + "\n" + (recipient_id || "") + "\n" + nonce_hex`.
2. Compute `SHA256(preimage)`.
3. Read from chain `get_payment(claim_id)` → returns `commitment` (and execution_ref, timestamp).
4. Check that the computed hash equals the on-chain `commitment`.

## Why claim_id (not invoice_id)?

- The backend and DB are **claim-centric**: one claim → one payment → one attestation.
- Invoices (`deal_invoices`) are a separate flow. If you need attestation keyed by invoice later, add an optional `invoice_id` field or a separate method.

## Relation to NEAR Intents

This contract is **not** the NEAR Intents verifier. It is a **receipt logger**: after a payment is executed (e.g. via intents or any other path), the backend attests “this claim was paid” by recording a commitment on-chain. The Intents verifier handles cross-chain settlement and token-delta checks; this contract only records that a given claim_id was attested with a given commitment, for audit and reconciliation.

---

## Future improvements (optional)

- **Off-chain signed attestations + on-chain anchor**: sign attestations off-chain; store only a Merkle root or batch commitment on-chain periodically.
- **Zero-knowledge proofs**: attest “a payment satisfying policy X was made” without revealing any of the data (long-term, more complex).
