# Steps to Enable Private USDC Payment on Solana in Loofta

This document outlines how to add **private USDC payment** (Magic Block Private Ephemeral Rollup) to:

1. **Request payment page** — `/c/[id]` (claim pay page): pay a claim with private USDC.
2. **Username link page** — `/link/[...username]`: create and pay via a link; payer never sees recipient wallet; recipient never sees payer.

Use the [private-payments-demo](https://github.com/magicblock-labs/starter-kits/tree/main/private-payments-demo) as the **reference implementation** (same program, same PER flow). All code changes below are in **loofta-swap** only. The demo repo is unchanged; do not add new program instructions there—implement only in loofta-swap.

**Solana programs** live in the **`solana/`** folder: `solana/programs/private-payments/`, `solana/Anchor.toml`, `solana/Cargo.toml`, `solana/migrations/`. Build and deploy from `solana/` with `anchor build` and `anchor deploy`.

---

## Current state in Loofta

- **Username link** (`apps/frontend/src/app/link/[...username]/page.tsx`): Creates a claim via `createClaimFromUsername`; backend resolves username → wallet (never exposed). Redirects to `/c/{claimId}`. Has `requiresPrivatePayments` and "Create Private Payment Link" but private path is stubbed.
- **Claim pay page** (`apps/frontend/src/app/c/[id]/page.tsx`): Standard USDC pay via `useSolanaPayment` (public SPL transfer). `payPrivatelyWithPrivacyCash` in `privacyCash.ts` returns "Private payments coming soon."
- **USDC**: `USDC_MINT` in `services/solanaBalance.ts`; Solana payments use `buildUSDCTransferTransaction` in `services/solanaTransfer.ts`.

---

## High-level flow (private payment)

1. **Recipient** (identified by username/email in your DB) has an **embedded Solana wallet**; you never expose it to the payer.
2. **Payer** goes to either:
   - **Username link**: `/link/@username` → enters amount → "Create payment link" → redirect to `/c/{claimId}`.
   - **Request payment**: lands on `/c/{id}` (e.g. from shared link).
3. On **pay**:
   - For **private**: use Magic Block **Private Ephemeral Rollup (PER)**. Payer deposits USDC into program vault, delegates deposit to PER, then a **private transfer** moves balance from payer’s deposit to **recipient’s deposit** (recipient = claim’s wallet, resolved server-side). Payer only gets a **destination deposit PDA** (or request id); recipient only sees balance change (no payer in logs if PER permissions are set correctly).
4. **Backend** holds the **platform authority** keypair and signs the private-transfer tx (or issues a signed payment request) so only authorized claims get paid.

---

## Step 1: Add program and PER dependencies (loofta-swap)

- **Option A — Use Magic Block’s deployed program (devnet):**  
  Use program id `EnhkomtzKms55jXi3ijn9XsMKYpMT4BJjmbuDQmPo3YS` and Magic Block devnet/PER RPC. No new repo; add SDK and RPC URLs in frontend/backend.
- **Option B — Deploy your own instance:**  
  Copy the [private-payments](https://github.com/magicblock-labs/starter-kits/tree/main/private-payments-demo/programs/private-payments) program into loofta-swap (e.g. `programs/private-payments` or a dedicated package), build with Anchor, deploy to devnet/mainnet, then point app to your program id and PER.

**Add to frontend (and backend if it builds tx):**

- `@magicblock-labs/ephemeral-rollups-sdk` (auth, delegation, PER RPC).
- `@magicblock-labs/gum-sdk` or equivalent for **session keys** (payer signs private transfer via session in PER).
- Env: `NEXT_PUBLIC_MAGICBLOCK_URL` (ER/PER RPC, e.g. `https://devnet.magicblock.app` or TEE `https://tee.magicblock.app`), optional validator pubkey.

**Backend:**

- Store **platform authority** keypair securely (e.g. env or secrets manager). Used to sign private payment txs if you add a “platform-authorized transfer” instruction later; for the **current** demo program you only have `transfer_deposit(source, destination)`, so the platform doesn’t sign on-chain—privacy is from PER + not exposing recipient wallet to payer.

---

## Step 2: Backend — keep wallet hidden; optional “authorize pay” endpoint

- **Username → wallet:** Already done: `claims/create-from-username` (and similar) resolve username to wallet server-side; never return wallet to client.
- For **private** claim pay, the frontend will need either:
  - The **recipient’s deposit PDA** (derived from `recipient_wallet` + USDC mint + program id), or
  - A **claim-scoped token** (e.g. signed payload) that the backend gives only to the payer for that claim.
- Add an endpoint, e.g. `GET /claims/:id/private-pay-info`, that returns:
  - `recipientDepositPda` (and any other accounts needed for the private transfer),
  - `amount`, `tokenMint` (USDC),
  - Optional: a **nonce** or **request id** for idempotency.  
  Do **not** return the recipient’s public key; the client only gets the PDA so they cannot link to username/email.

---

## Step 3: Request payment page — `/c/[id]` (private USDC option)

**File:** `apps/frontend/src/app/c/[id]/page.tsx`

- When claim is **Solana USDC** and **private** (e.g. `claim.is_private` or “Pay privately” toggle):
  - Instead of calling `useSolanaPayment().makePayment({ recipientAddress, amount })` (public transfer), call a new **private payment** flow.
- **Private flow:**
  1. Fetch private-pay info from backend: `GET /claims/:id/private-pay-info` → `recipientDepositPda`, amount, mint.
  2. Ensure payer has a **deposit** and it’s **delegated** to PER (see demo: initialize deposit, create permission, delegate).
  3. Build PER session (session key) for payer; build `transfer_deposit(amount)` with `source_deposit` = payer’s deposit and `destination_deposit` = `recipientDepositPda`.
  4. Send the tx to the **ephemeral connection** (PER RPC with auth token from `getAuthToken(EPHEMERAL_RPC_URL, wallet, signMessage)`).
  5. After confirm, (optional) undelegate and/or commit; then mark claim as paid on your backend.

**New/updated modules in loofta-swap:**

- **`services/privatePayments.ts`** (or similar):  
  - `getPrivatePayAuthToken()`, `getEphemeralConnection()`, `buildPrivateTransferTx()`, `sendPrivateTransfer()` using the demo’s pattern (deposit, delegate, transfer_deposit on PER, then commit/undelegate if needed).
- **`hooks/usePrivateSolanaPayment.ts`**:  
  - Mirror `useSolanaPayment` but for the private flow: balance from PER or from your backend (you may expose “deposit balance” from the program), and `makePrivatePayment(claimId, amount)` that uses `privatePayments` + backend private-pay-info.

**UI:**

- On `/c/[id]`, when chain is Solana and token is USDC, show a **“Pay with private transfer”** (or “Pay privately”) option that uses the above flow and hides the recipient address from the payer.

---

## Step 4: Username link page — `/link/[...username]` (private USDC)

**File:** `apps/frontend/src/app/link/[...username]/page.tsx`

- Already creates a claim via `createClaimFromUsername` with `isPrivate`. No change needed for **creation**.
- When the user chooses **“Create Private Payment Link”** and is redirected to `/c/{claimId}`, the **payment** step is the same as Step 3: on `/c/[id]` the payer uses the private flow; they never see the recipient wallet; the backend maps claim id → recipient wallet and returns only `recipientDepositPda` (and related data) for the PER transfer.

**Optional:**

- If the username page ever showed a “pay here” widget (e.g. pay without going to `/c/[id]`), reuse the same private flow: backend returns private-pay-info keyed by a one-time token or claim id; frontend runs the same PER deposit → transfer_deposit flow.

---

## Step 5: Frontend PER auth and connection

- **Auth:** Use `getAuthToken(EPHEMERAL_RPC_URL, wallet.publicKey, signMessage)` from `@magicblock-labs/ephemeral-rollups-sdk` (same as demo). Store token in memory or short-lived storage; pass to PER RPC as `?token=...`.
- **Connection:** `new Connection(\`${EPHEMERAL_RPC_URL}?token=${authToken}\`)` for PER. Use this connection only for delegate/transfer_deposit/commit flows; keep mainnet RPC for deposit/withdraw and reading non-delegated state.
- **Session keys:** Use the same pattern as the demo (GUM session key) so the payer can sign the `transfer_deposit` instruction on PER without sending the main wallet’s private key to the PER.

---

## Step 6: USDC only

- Use existing `USDC_MINT` from `services/solanaBalance.ts` for all private flows (mainnet: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`).
- In backend, when returning private-pay-info, validate that the claim’s token/chain is Solana USDC and only then return deposit PDA; reject other tokens/chains for this private path.

---

## Step 7: Order of implementation (suggested)

1. **Dependencies and env** in loofta-swap: ephemeral-rollups-sdk, PER RPC URL, program id (demo or your own).
2. **Backend** `GET /claims/:id/private-pay-info`: resolve claim → recipient wallet (from DB), compute recipient deposit PDA, return it + amount + mint (no wallet address).
3. **Frontend** `services/privatePayments.ts`: auth token, ephemeral connection, build delegate + transfer_deposit + optional commit/undelegate (reuse demo logic).
4. **Frontend** `hooks/usePrivateSolanaPayment.ts`: balance (from program or backend), `makePrivatePayment(claimId, amount)`.
5. **Request payment page** `/c/[id]`: add “Pay privately” path that calls `usePrivateSolanaPayment` when claim is private and Solana USDC.
6. **Username link page**: no change to creation; paying happens on `/c/[id]` with the same private path. Optionally add a direct “pay” on username page later using the same flow.

---

## Summary

| Where              | What to do |
|--------------------|------------|
| **Request payment** (`/c/[id]`) | Add private USDC pay path: backend private-pay-info → PER auth → deposit/delegate → transfer_deposit on PER → confirm; use existing claim and USDC mint. |
| **Username link** (`/link/[...username]`) | Keep creating claim with `isPrivate`; payment happens on `/c/[id]` with the same private flow so payer never sees wallet, recipient never sees payer. |
| **Backend**        | New endpoint for private-pay-info (recipient deposit PDA + amount + mint); keep wallet hidden. |
| **Frontend**       | New private payment service + hook; integrate into claim pay page; PER auth and session keys as in demo. |
| **Reference**      | private-payments-demo (program, use-simple-transfer, use-ephemeral-connection, use-private-rollup-auth). |

All implementation is in **loofta-swap**; the demo is only a reference. Private payments use **USDC on Solana** and **Magic Block Private Ephemeral Rollup** so that payer and recipient stay unlinked while you still resolve the link server-side (username/email → wallet, claim id → recipient).

---

## PER permission groups

- **Deposit accounts**: When creating permissions for each user’s deposit (e.g. in `create_permission`), add the **platform** pubkey as a member with flags `TX_LOGS_FLAG | TX_BALANCES_FLAG | TX_MESSAGE_FLAG` only for a **compliance** group. That way the platform can read transaction logs and balances on PER for audit; normal users only have `AUTHORITY_FLAG` on their own deposit.
- **Audit account**: The program has an **audit log** PDA (`log_audit` instruction) that stores `(payment_id, payer, recipient, amount, token_mint, timestamp)`. Create a **permission for the audit account** with **only the platform** as member (e.g. `AUTHORITY_FLAG | TX_LOGS_FLAG | TX_BALANCES_FLAG`). Delegate that audit account to PER; then only the platform (with its PER auth token) can read it. That gives you an on-chain, program-side record of the payer ↔ recipient link for compliance without exposing it to payer or recipient.

---

## Program-side audit account

- **Instruction**: `log_audit(payment_id, payer, recipient, amount)` — callable only by `platform_authority`. Writes to an account with seeds `["audit_log", payment_id]`.
- **When to call**: After a successful private transfer (e.g. from your backend after `submitPrivatePay`), call `log_audit` on L1 with a unique `payment_id` (e.g. claim id or nonce) and the payer/recipient pubkeys and amount. The audit account is then delegated to PER with a permission that only includes the platform, so only “us” can read it.
- **Location**: `programs/private-payments/src/lib.rs` — `AuditLog` struct, `LogAudit` accounts, `log_audit` handler.
