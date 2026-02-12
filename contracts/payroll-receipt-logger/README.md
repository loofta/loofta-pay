# Payroll Receipt Logger (NEAR)

Tiny NEAR contract for **on-chain audit** of payroll runs. Stores **hashes only** — no amounts on-chain.

## What it stores (per receipt)

- `payroll_id` — run identifier
- `batch_hash` — commitment to the batch (no amounts)
- `authorizer_id` — who authorized the payroll
- `nonce` — idempotency (prevents double-pay)
- `executor_id` — who executed (solver/backend)
- `status` — `success` | `partial` | `failed`
- `tx_refs_hash` — hash of execution tx refs
- `timestamp_nanos`

## Build

```bash
cd contracts/payroll-receipt-logger
cargo build --target wasm32-unknown-unknown --release
```

WASM will be in `target/wasm32-unknown-unknown/release/payroll_receipt_logger.wasm`.

## Deploy

1. Create a NEAR account for the contract.
2. Deploy the WASM.
3. Call `new(Some("your-backend-account.near"))` to init and set the only account that can call `record_receipt` (your payroll backend).

## Methods

- `record_receipt(payroll_id, batch_hash, authorizer_id, nonce, executor_id, status, tx_refs_hash)` — append receipt (allowed caller only).
- `get_receipt(payroll_id)` — view receipt.
- `is_nonce_used(authorizer_id, nonce)` — view nonce check.
- `set_allowed_caller(account_id)` — owner only.
