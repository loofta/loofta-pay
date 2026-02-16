# Payment audit (operators)

## payment_events table

The backend writes an audit log of claim/payment flow into `payment_events` (no PII). Use it to answer “what happened, when, why” for a claim or for failures.

| Column         | Description                                      |
|----------------|--------------------------------------------------|
| claim_id       | Claim UUID (nullable for non-claim events)       |
| event_type     | See below                                        |
| ref_or_hash    | Quote id, deposit address, or NEAR tx hash       |
| success        | true/false                                       |
| error_message  | Short reason when success = false                 |
| created_at     | Timestamp                                        |

### Event types

- `claim_created` — Claim was created.
- `deposit_issued` — Quote/deposit address was issued for the claim.
- `quote_failed` — Quote request failed (ref_or_hash may be null).
- `payment_detected` — Claim status set to SUCCESS (payment completed).
- `execution_failed` — Claim status set to REFUNDED.
- `attestation_submitted` — On-chain attestation recorded (ref_or_hash = NEAR tx hash or ref).
- `attestation_failed` — Attestation contract call failed or not configured.

### Example queries (Supabase SQL or client)

```sql
-- Events for a specific claim
SELECT event_type, success, ref_or_hash, error_message, created_at
FROM payment_events
WHERE claim_id = 'your-claim-uuid'
ORDER BY created_at;

-- Recent failures
SELECT claim_id, event_type, error_message, created_at
FROM payment_events
WHERE success = false
ORDER BY created_at DESC
LIMIT 50;

-- Claims that got attestation
SELECT DISTINCT claim_id FROM payment_events WHERE event_type = 'attestation_submitted' AND success = true;
```

## Attestation (NEAR)

When `NEAR_ATTESTATION_*` env vars are set, the backend records each successful payment on the NEAR contract (`record_payment`). The NEAR transaction hash is stored on the claim as `attestation_tx_hash`. If the first attempt fails, a cron retries every 10 minutes for SUCCESS claims that have no `attestation_tx_hash`. See `contracts/payroll-attestation/README.md` (payroll attestation) and `DEPLOY_NEAR.md` for deployment.
