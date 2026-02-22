# Send Payment & Private Payment – What to Do Now

## 1. Environment (backend `.env.local`)

- **Supabase** – `SUPABASE_URL`, `SUPABASE_SECRET` (and `SUPABASE_ANON_KEY` if needed).
- **Send payment (create/claim)** – `SEND_PAYMENT_ENC_KEY` (32-byte hex).
- **RPC** – `HELIUS_API_KEY` (or `SOLANA_RPC_URL`). Used for send payment and private flow.
- **Private payments (optional)** – `NEXT_PUBLIC_RELAYER_API_URL` (default: `https://api3.privacycash.org`).
- **Sponsorship (optional)** – `SOLANA_FEE_PAYER_PRIVATE_KEY` for sponsored claims.

See `apps/backend/env.template` for the full list.

## 2. Database

- Ensure the `send_payment_links` table exists and has **all** private-claim columns:  
  `private_claim_sender_address`, `private_claim_burner_address`, `private_claim_encrypted_receiver`, `private_claim_encrypted_sender`, `private_claim_activity_id`, `private_claim_passphrase`.
- **Option A – Migrations:** Run `supabase db push` (or your usual migration flow) so `20260213200000_add_private_claim_vault_columns.sql` is applied.
- **Option B – Full manual:** If the table doesn’t exist, run  
  `apps/backend/supabase/migrations/run_manual_send_payment_links.sql`  
  (creates table + adds all `private_claim_*` columns).
- **Option C – Columns only:** If you already have `send_payment_links` but see  
  *"Could not find the 'private_claim_sender_address' column... in the schema cache"*,  
  run in Supabase SQL Editor:  
  `apps/backend/supabase/migrations/run_add_private_claim_columns_only.sql`  
  then reload the schema (the script includes `NOTIFY pgrst, 'reload schema'`).

## 3. Persist the privacycash patch (after `npm install`)

The backend uses internal `privacycash` paths for building the unsigned deposit tx. We patch `node_modules/privacycash/package.json` so those paths are exported.

- **Option A – Create the patch once (recommended)**  
  From repo root, with current `node_modules` already patched:
  ```bash
  npx patch-package privacycash
  ```
  This creates `patches/privacycash+1.1.16.patch`. Root `package.json` already has `"postinstall": "patch-package"`, so every `npm install` will reapply it.

- **Option B – No patch**  
  If you skip patch-package, after every fresh `npm install` you must re-apply the exports in  
  `node_modules/privacycash/package.json` (add the `./dist/...` entries under `"exports"`) or the backend will fail when building the private deposit.

## 4. ZK circuit files (required for “Pay privately”)

The `privacycash` npm package does **not** include the ZK circuit files (`transaction2.wasm` and `transaction2.zkey`). This repo ships them in-repo so the backend can build from it.

- **In-repo (default)**  
  `apps/backend/circuit2/` contains `transaction2.wasm` and `transaction2.zkey` (copied from the [Privacy Cash SDK](https://github.com/Privacy-Cash/privacy-cash-sdk) `circuit2/` folder). The backend resolves the path from its own `dist` location, so no env var is needed. To refresh from the SDK: copy the two files from the SDK’s `circuit2/` into `apps/backend/circuit2/` (see that folder’s README).

- **Override with env**  
  Set `PRIVACYCASH_CIRCUIT_BASE_PATH` to the full base path (no `.wasm`/`.zkey`) if you want to use a different location.

If the circuit files are missing, you’ll see: *“Privacy Cash ZK circuit files not found”* or *“ENOENT: ... transaction2.wasm”*.

## 5. Run and test

- **Backend:** `npm run start` or `npm run start:dev` in `apps/backend` (or from root: `npm run dev:backend`).
- **Frontend:** Use the send flow; “Pay privately” uses the same backend (prepare-private → sign deposit → submit-private).

If the backend fails with `ERR_PACKAGE_PATH_NOT_EXPORTED` for `privacycash`, the patch was not applied—see step 3.

---

## 6. Safety, Vault service, and client-side

### Do we need the Vault service?

Yes, for the current design. The “vault” here is not a key custodian; it’s the backend logic that:

- Proves the sender owns the wallet (wallet signature **or** Privy linked-account check).
- Builds the unsigned Privacy Cash deposit tx and stores activity in `send_payment_links`.
- Sends the signed deposit to the relayer and runs the withdraw so the link’s burner gets the funds.

The backend never holds user private keys.

### Is it safe?

- **Auth:** Only the link sender (same `sender_user_id`) can call prepare-private / submit-private.
- **Sender proof:** We either verify a 64-byte Ed25519 session signature from the wallet, or (if that fails, e.g. with Privy embedded wallet) we check via Privy API that the given sender address is in the user’s linked Solana accounts. So only a wallet the user actually controls is accepted.
- **Session signature:** The value is still sent and used for encryption/key derivation in the Privacy Cash flow; we only skip *verification* when we already trust the sender via Privy.

### Can we do the transfer fully client-side?

Not entirely. Privacy Cash still needs:

- **Relayer:** Someone must submit the signed deposit and trigger the withdraw. That can be the backend (as now) or a relayer that accepts client-signed requests.
- **Link association:** The withdraw must be tied to this send-payment link (burner, activity id, etc.). Today that’s stored and used in the backend.

So you can move *building* and *signing* of the deposit tx to the client (e.g. with Privacy Cash SDK in the browser), but the step that submits to the relayer and associates the result with the link still needs a trusted backend (or an API that accepts a signed intent from the client and does the same).

### Private flow = same as privacy-hack (deposit → withdraw to burner)

The private "Pay privately" flow matches **privacy-hack**: (1) The only tx the user signs is the Privacy Cash **deposit** (ZK); there is no "first tx to burner". (2) Backend relays the signed deposit, then **withdraws** from Privacy Cash to the link's burner. (3) Recipient claims from the burner. The deposit is always built with the **user as fee payer** so the wallet can simulate; the user needs a little SOL for that tx.

### Single burner (no “two burners”)

Each link has **one** burner wallet. The deposit address shown to the sender is that burner’s USDC ATA.

- **Public flow:** Sender sends USDC to that deposit address; claim pulls from that burner.
- **Pay privately:** The same burner is used as the withdraw target. Prepare-private reuses the link’s existing burner instead of creating a second one, so the deposit address and the private-withdraw destination are the same. Claim and reclaim only ever move funds from that single burner.

So we do not create a second burner for private payments; we only have one burner per link.

### Amount safeguards (avoid partial withdraws)

To avoid withdrawing the wrong amount (e.g. only 0.13 instead of the full link amount):

- **Prepare:** Minimum amount 0.1 USDC; deposit tx is built for the full link amount (`link.amount`).
- **Submit/withdraw:** Amount is read from the link row again, validated (≥ 0.1 USDC, baseUnits ≥ 100_000), and logged before calling the relayer/withdraw. Backend logs: `[PrivateClaim] Preparing deposit for X USDC (Y baseUnits)...` and `[PrivateClaim] Withdrawing X USDC (Y baseUnits) to burner ...`.

If a partial amount ever appears, the logs show exactly which amount was used for the withdraw.
