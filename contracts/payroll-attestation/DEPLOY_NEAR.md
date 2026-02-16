# Deploy Payroll Attestation to NEAR — checklist

## Before you start

- [ ] You have a NEAR account (e.g. from [mynearwallet.com](https://mynearwallet.com) or [wallet.near.org](https://wallet.near.org)).
- [ ] You have ~2–5 NEAR on that account (or a subaccount) for deployment and storage.
- [ ] You have (or will create) a separate NEAR account for the **backend** that will call `record_payment` (this account’s key goes in `NEAR_ATTESTATION_NEAR_PRIVATE_KEY`).

### Testnet deploy (recommended first)

Use testnet to verify deploy + init before spending mainnet NEAR. You need 2 NEAR on `yourname.testnet` (e.g. from [nearfaucet.io](https://www.nearfaucet.io/)).

```bash
# 1) Login to testnet
NEAR_ENV=testnet near login

# 2) Create contract subaccount (fresh = no state)
NEAR_ENV=testnet near create-account payroll-attestation.lisabey.testnet --masterAccount lisabey.testnet --initialBalance 2

# 3) From repo: contracts/payroll-attestation
cargo build --target wasm32-unknown-unknown --release
NEAR_ENV=testnet CONTRACT_ACCOUNT=payroll-attestation.lisabey.testnet INIT_CALLER=lisabey.testnet bash deploy.sh deploy-only
```
(If you get "permission denied" on `./deploy.sh`, use `bash deploy.sh` instead.)

Use `lisabey.testnet` as `INIT_CALLER` so the backend can use the same account’s key (from `~/.near-credentials/testnet/lisabey.testnet.json`). Backend env for testnet:

```env
NEAR_ATTESTATION_CONTRACT_ID=payroll-attestation.lisabey.testnet
NEAR_ATTESTATION_NEAR_ACCOUNT_ID=lisabey.testnet
NEAR_ATTESTATION_NEAR_PRIVATE_KEY=ed25519:...   # from ~/.near-credentials/testnet/lisabey.testnet.json
NEAR_NETWORK_ID=testnet
```

Once this works, repeat on mainnet with your mainnet accounts and set `NEAR_NETWORK_ID=mainnet`.

### No mainnet NEAR? Use testnet (free)

- Use **testnet** and get free NEAR from the [testnet faucet](https://www.nearfaucet.io/) or [near.org faucet](https://near.org/faucet/).
- Deploy with `NEAR_ENV=testnet` and use testnet account IDs (e.g. `yourname.testnet`).
- In backend env set `NEAR_NETWORK_ID=testnet` and the testnet contract/backend account IDs.

### If `new` fails with PrepareError(Deserialization): reset the contract account

The account may have **leftover state** from earlier deploys. Delete it and recreate the same name (balance returns to the master account), then deploy and init once:

```bash
# 1) Delete subaccount (sends its NEAR to lisabey.testnet)
NEAR_ENV=testnet near delete-account payroll-attestation.lisabey.testnet lisabey.testnet

# 2) Recreate (use some of the NEAR you got back)
NEAR_ENV=testnet near create-account payroll-attestation.lisabey.testnet --masterAccount lisabey.testnet --initialBalance 2

# 3) Deploy and init (from contracts/payroll-attestation)
NEAR_ENV=testnet CONTRACT_ACCOUNT=payroll-attestation.lisabey.testnet INIT_CALLER=lisabey.testnet bash deploy.sh deploy-only
```

After step 2 the account has **no contract and no storage**, so the first deploy and first `new` run on a clean slate.

### Recycle an existing account (no extra NEAR)

If the contract account (e.g. `payroll-attestation.lisabey.near`) has leftover state and you don’t want to fund a new account:

1. **Delete** the subaccount and send its balance back to your main account:  
   `NEAR_ENV=mainnet near delete payroll-attestation.lisabey.near lisabey.near`  
   (Replace `lisabey.near` with the account that should receive the NEAR.)
2. **Recreate** the same subaccount (now empty, no state) with the balance you got back:  
   `NEAR_ENV=mainnet near create-account payroll-attestation.lisabey.near --masterAccount lisabey.near --initialBalance 1.5`
3. Deploy WASM and call `new` as in steps 4–5 below.

## 0. Avoid deprecated RPC (429 / rate limit)

The default NEAR.org RPC is deprecated and rate-limited. Use a different RPC once:

```bash
# Testnet
near config edit-connection testnet --key rpc_url --value https://rpc.testnet.fastnear.com
# Mainnet (when you deploy there)
near config edit-connection mainnet --key rpc_url --value https://free.rpc.fastnear.com
```

Or set before deploy: `export NODE_URL=https://rpc.testnet.fastnear.com` (testnet). The deploy script sets `NODE_URL` automatically when you run it.

## 1. Install tools

```bash
# Rust + wasm target
rustup target add wasm32-unknown-unknown

# NEAR CLI (optional; you can use Wallet + manual deploy if you prefer)
npm install -g near-cli
```

## 2. Build (use cargo near to avoid PrepareError::Deserialization)

**Rust 1.87+** is not compatible with the NEAR VM (cargo near will error). This project has **rust-toolchain.toml** set to **1.86.0**. Use cargo-near:

```bash
cargo install cargo-near
cd contracts/payroll-attestation
cargo near build
```

If you see "1.87.0 or newer ... not compatible", run `rustup override set 1.86` in the contract dir, then `cargo near build` again. Deploy the WASM from **`target/near/payroll_attestation/payroll_attestation.wasm`** (the deploy script uses it automatically). Do **not** deploy the file from `target/wasm32-unknown-unknown/release/` — it can cause `CompilationError(PrepareError(Deserialization))` on init.

If you don’t use cargo-near, you can try pinning Rust to 1.80: `rustup default 1.80` then `cargo build --target wasm32-unknown-unknown --release` (see [r/nearprotocol](https://www.reddit.com/r/nearprotocol/comments/)).

## 3. Create contract account

- Create a **new** account or subaccount that has **never** had a contract (e.g. `payroll-attestation.yourname.near`). If you reuse an account that already had a different contract, calling `new` can fail with `PrepareError::Deserialization` because old state remains in storage.
- Fund it with **2–5 NEAR** (deploy + future storage).
- To create a subaccount from CLI (from parent that has enough NEAR):  
  `NEAR_ENV=mainnet near create-account payroll-attestation.yourname.near --masterAccount yourname.near --initialBalance 2`

## 4. Deploy WASM

**Option A — CLI**

```bash
NEAR_ENV=mainnet near login
NEAR_ENV=mainnet near deploy attestation.yourname.near target/wasm32-unknown-unknown/release/payroll_attestation.wasm
```

**Option B — Script**

```bash
CONTRACT_ACCOUNT=attestation.yourname.near INIT_CALLER=your-backend.near ./deploy.sh deploy
```

(`INIT_CALLER` is the account that will be allowed to call `record_payment` — usually your backend NEAR account.)

## 5. Initialize contract

If you didn’t use the script (which runs `new` for you):

```bash
NEAR_ENV=mainnet near call attestation.yourname.near new '{"allowed_caller": "your-backend.near"}' --accountId yourname.near
```

Replace `your-backend.near` with the account that holds the key you’ll put in `NEAR_ATTESTATION_NEAR_PRIVATE_KEY`.

## 6. Backend env

In `apps/backend/.env.local` (or your deployment env):

```env
NEAR_ATTESTATION_CONTRACT_ID=attestation.yourname.near
NEAR_ATTESTATION_NEAR_ACCOUNT_ID=your-backend.near
NEAR_ATTESTATION_NEAR_PRIVATE_KEY=ed25519:...
NEAR_NETWORK_ID=mainnet
```

- **NEAR_ATTESTATION_NEAR_PRIVATE_KEY**: Full-access key for `your-backend.near` (format `ed25519:base58...`). Generate in Wallet → Manage Keys or via `near generate-key` and add to the account.

## 7. Verify

- Complete a test claim payment (status → SUCCESS).
- Check the claim in DB or on the claim page: `attestation_tx_hash` should be set and “Attested on NEAR” with link should appear.
- Optionally call the contract:  
  `NEAR_ENV=mainnet near view attestation.yourname.near get_payment '{"claim_id": "<your-claim-uuid>"}'`

## Cost recap

- **Deploy**: A few cents (fractions of NEAR).
- **Per attestation**: Small storage + gas; a few NEAR on the contract account covers thousands of records.
- **No ongoing fee** beyond storage for new records.

## Troubleshooting

- **`PrepareError::Deserialization` when calling `new`** — The WASM from `cargo build --target wasm32-unknown-unknown --release` is often **incompatible** with the NEAR VM (Rust 1.82+ enables bulk-memory/sign-ext). **Fix:** Build with **cargo near** and deploy the WASM from **`target/near/payroll_attestation/payroll_attestation.wasm`**. Run `cargo install cargo-near` then `cargo near build`; the deploy script will use that file if present. Alternatively pin Rust to 1.80 (`rustup default 1.80`) and rebuild. If the error persists, use a **fresh subaccount** (delete + recreate) in case of old state.
- **“Only the allowed caller can record payments”** — The account that signs the tx (in `NEAR_ATTESTATION_NEAR_ACCOUNT_ID`) must match the `allowed_caller` you passed to `new(...)`. Fix: call `set_allowed_caller` from the contract owner:  
  `NEAR_ENV=mainnet near call attestation.yourname.near set_allowed_caller '{"account_id": "your-backend.near"}' --accountId yourname.near`
- **Attestation not recorded** — Backend skips if env vars are unset. Check logs for “Claim attestation not configured” or “Failed to record attestation”. Ensure the backend NEAR account has a small amount of NEAR for gas.
- **Retries** — The backend cron runs every 10 minutes and retries SUCCESS claims that have no `attestation_tx_hash` yet; no need to re-run payment flow manually.
