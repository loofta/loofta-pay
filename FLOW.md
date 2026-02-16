# Payroll flow (hackathon)

How payments and attestation work end-to-end.

---

## 1. Deal-based payments (current flow)

### Steps

1. **Org creates a deal** (Deals → New deal): title, amount, currency, deadline.
2. **Org invites a freelancer** by email. Freelancer gets an invite link.
3. **Freelancer accepts the invite** and can set preferred network/token (e.g. NEAR, Base).
4. **Freelancer delivers** (marks delivery complete). Org can request changes or **accept delivery**.
5. **On accept delivery** the backend:
   - Creates a **deal_invoice** (linked to the deal/invite).
   - Creates a **deal_payment** (pending) with recipient wallet, preferred network/token, amount.
6. **Org goes to Pay** (Pay → Deal payments tab). They see:
   - **Outstanding**: pending + processing payments (select one or more, or open a single payment).
   - **Paid**: completed payments with a “View” link to the payment detail.
7. **Org opens a payment** (Pay → row or “Pay selected” for one). On the payment page:
   - Chooses **pay-with token** (e.g. USDC on Base).
   - Optionally sets a **refund address**.
   - Clicks **Get deposit address**. Backend calls NEAR Intents (1-Click API) and returns a deposit address + amount to send.
8. **Org sends the required amount** to the deposit address (same chain as pay-with token). NEAR Intents execute the cross-chain intent and send funds to the freelancer’s wallet on their preferred network.
9. **Completion**:
   - Frontend polls status by deposit address (or user refreshes). When status is **SUCCESS**, frontend calls **checkComplete**.
   - Backend **checkAndComplete** fetches intent status; if completed, it gets a tx hash and calls **markCompleted**.
   - **markCompleted** sets payment to `completed`, invoice to `paid`, and  **posts an on-chain receipt** (see Attestation / receipt below).
10. **Payment detail** stays on the result screen: amount, recipient, “View on NEAR Intents explorer”, “View transaction”, and **on-chain attestation** section when a receipt was recorded.

---

## 2. When does attestation / receipt happen?

There are two separate mechanisms:

### A. Claim attestation (NEAR contract: payroll-attestation)

- **Used for:** claim payouts (other product flow), not for deal payments.
- **Contract:** `contracts/payroll-attestation` (method `record_payment`).
- **Backend env:** `NEAR_ATTESTATION_CONTRACT_ID`, `NEAR_ATTESTATION_NEAR_ACCOUNT_ID`, `NEAR_ATTESTATION_NEAR_PRIVATE_KEY`, `NEAR_NETWORK_ID=mainnet`.
- When a **claim** is paid, the backend calls this contract and stores the attestation tx ref on the claim.

### B. Deal payment receipt (on-chain attestation — always required)

- **Used for:** deal payments (the flow above). Attestation is **not optional**: every completed deal payment must have an on-chain receipt.
- **When:** On **markCompleted** (after an intent completes), the backend always calls **PayrollReceiptLoggerService.postReceipt**. The payment detail page always shows attestation status and returns `receipt_on_chain_tx_hash` when loading a payment.
- **Backend env (required for deal payments):** `PAYROLL_RECEIPT_LOGGER_CONTRACT_ID`, `PAYROLL_RECEIPT_LOGGER_NEAR_ACCOUNT_ID`, `PAYROLL_RECEIPT_LOGGER_NEAR_PRIVATE_KEY`. Same **NEAR_NETWORK_ID** (e.g. mainnet).
- **Contract:** payroll-attestation exposes `record_receipt(...)` (hash-only, no amounts on-chain). If the env vars are not set, receipt post fails and the API returns `receiptPosted: false` with an `error` message; the backend logs every failure. You can use the **same** payroll-attestation contract (it has both `record_payment` and `record_receipt`): set `PAYROLL_RECEIPT_LOGGER_*` to the same contract and backend account as attestation.

**If “Retry receipt” shows “Only the allowed caller can record receipts”:** the contract’s `allowed_caller` must be the account that signs the tx (i.e. `PAYROLL_RECEIPT_LOGGER_NEAR_ACCOUNT_ID`, e.g. `loofta-backend.lisabey.near`). From the contract owner account (e.g. `lisabey.near`), call:

```bash
NEAR_ENV=mainnet near call payroll-attestation.lisabey.near set_allowed_caller '{"account_id": "loofta-backend.lisabey.near"}' --accountId lisabey.near
```

---

## 3. Pay page

- **Deal payments** tab: outstanding table (pending/processing) + **Paid** table (completed). Paid rows stay visible and link to the payment detail (View).
- **Bulk payment** tab: “Pay from CSV” — **Coming soon** (no Import CSV in the main nav anymore).

---

## 4. Quick reference

| Step            | Where / what |
|-----------------|--------------|
| Create deal     | Deals → New deal |
| Invite          | Deal → Invite by email |
| Freelancer      | Accept invite, set network/token, deliver |
| Org             | Accept delivery → creates invoice + payment |
| Pay             | Pay → Deal payments → open payment → token + Get deposit address → send funds |
| Completion      | Status SUCCESS → checkComplete → markCompleted → (optional) receipt on NEAR |
| See paid        | Pay → Deal payments → “Paid” section → View |
| Attestation     | Deal: receipt logger (PAYROLL_RECEIPT_LOGGER_*). Claims: payroll-attestation (NEAR_ATTESTATION_*). |
