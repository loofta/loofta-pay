# Payroll Attestation (NEAR)

Small NEAR contract for **on-chain payment attestation** per claim (payroll/claim payments). One record per `claim_id` (idempotent).

## What it stores (per payment)

- `claim_id` — claim identifier
- `amount` — amount paid
- `token_symbol` — e.g. USDC, USDT
- `token_chain` — chain of the token
- `execution_ref` — deposit address, quote id, or NEAR tx hash
- `recipient_id` — optional recipient
- `timestamp_nanos`

## Build

```bash
cd contracts/payroll-attestation
rustup target add wasm32-unknown-unknown
cargo build --target wasm32-unknown-unknown --release
```

WASM: `target/wasm32-unknown-unknown/release/payroll_attestation.wasm`.

## Deploy to NEAR (mainnet)

See **[DEPLOY_NEAR.md](DEPLOY_NEAR.md)** for a step-by-step checklist. Quick path: `./deploy.sh` (build), then `CONTRACT_ACCOUNT=... INIT_CALLER=... ./deploy.sh deploy`.

**Cost:** NEAR is cheap. One-time deploy is a few cents (fractions of NEAR). Storage is ~0.0001 NEAR per byte; each attestation is small. A few NEAR on the contract account is enough for thousands of records.

1. **Install NEAR CLI** (if needed): `npm install -g near-cli`

2. **Log in (mainnet):**
   ```bash
   NEAR_ENV=mainnet near login
   ```
   Follow the link to authorize your account.

3. **Create a contract account** (or use a subaccount of an existing one):
   - Option A: Create at [mynearwallet.com](https://mynearwallet.com) or [wallet.near.org](https://wallet.near.org) (e.g. `attestation.yourname.near`).
   - Option B: With CLI: `NEAR_ENV=mainnet near create-account attestation.yourname.near --masterAccount yourname.near --initialBalance 5`
   - Send ~2–5 NEAR to the new account for deployment + storage.

4. **Deploy the WASM:**
   ```bash
   cd contracts/payroll-attestation
   NEAR_ENV=mainnet near deploy attestation.yourname.near target/wasm32-unknown-unknown/release/payroll_attestation.wasm
   ```

5. **Initialize** (set the backend as the only allowed caller for `record_payment`):
   ```bash
   NEAR_ENV=mainnet near call attestation.yourname.near new '{"allowed_caller": "your-backend.near"}' --accountId yourname.near
   ```
   Replace `your-backend.near` with the NEAR account whose key is in `NEAR_ATTESTATION_NEAR_ACCOUNT_ID` / `NEAR_ATTESTATION_NEAR_PRIVATE_KEY`.

6. **Backend env** (in `.env.local` or env vars):
   ```bash
   NEAR_ATTESTATION_CONTRACT_ID=attestation.yourname.near
   NEAR_ATTESTATION_NEAR_ACCOUNT_ID=your-backend.near
   NEAR_ATTESTATION_NEAR_PRIVATE_KEY=ed25519:...
   NEAR_NETWORK_ID=mainnet
   ```

## Methods

- `record_payment(claim_id, amount, token_symbol, token_chain, execution_ref, recipient_id)` — record one attestation per claim (allowed caller only). Fails if `claim_id` already exists.
- `get_payment(claim_id)` — view attestation.
- `set_allowed_caller(account_id)` — owner only.
