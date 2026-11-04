# AliX Pay v2 (Alipay / QR scan-to-pay) reference

Summary of https://docs.alixpay.com/v2 as read on 2026-11-04. No secrets live in this file.

## Secrets and where they live

| Item | Where |
|---|---|
| Our RSA private key | `~/.loofta-secrets/alixpay/partner-private.pem` (outside the repo, chmod 600). Prod: wrap with GCP KMS like the other keys, see `docs/GCP_KMS_SECRETS.md` |
| Our RSA public key | `~/.loofta-secrets/alixpay/partner-public.pem`, the half given to AliX at onboarding |
| `partnerCode`, `secretKey` | issued by AliX at onboarding. Env: `ALIX_PARTNER_CODE`, `ALIX_SECRET_KEY` |
| AliX public key | issued per partner. Env or file: `ALIX_PUBLIC_KEY` (verifies response and webhook signatures) |

Never commit any of these. Never put them in `NEXT_PUBLIC_*`.

## Base URLs and access

- Sandbox: `https://sandbox.alixpay.com`
- Production: `https://api.alixpay.com`
- Every request checks the caller IP against an allowlist (`PARTNER_IP_NOT_ALLOWED`, errorCode 19). Call it from the backend with a static egress IP, never from the browser.
- Sandbox and prod webhook endpoints are registered separately in the AliX portal.

## Signing

- String to sign: ordered, pipe-joined fields of the endpoint, then `secretKey` appended directly, `a|b|c|<secretKey>`. The JSON body is not signed.
- An omitted field is signed as the literal `undefined` (some numeric fields: `0`).
- RSA-SHA256, PKCS#1 v1.5, base64, sent in the body as `signature`.
- Responses carry `data.signature` over a fixed field order plus `secretKey`, verified with AliX's public key. Error responses have `data: null`, no signature.

```ts
const signer = createSign("RSA-SHA256");
signer.update(canonical + SECRET_KEY);
signer.end();
const signature = signer.sign(privateKeyPem, "base64");
```

## Scan-to-pay flow

KYC-verified user first, otherwise transactions are rejected.

1. `GET /api/v2/public/get-qr-code-info?qrContent=...` (public, unsigned). Returns `bankCode`, `bankName`, `bankAccountNumber`, `recipientName`, `countryCode`, `amount` (if fixed), `content`, `qrType`, `additionalData` (pass through untouched).
2. `POST /api/v2/orders/review-sell-order` (quote only, nothing debited). Signed: `partnerCode|currency|fiatAmount|` (`0` if no fiatAmount). Returns `price`, `tokenAmount`, `totalPayment`, `processingFee`, `systemFee`. Response signed: `fiatAmount|currency|price|tokenAmount|totalPayment|`.
3. `POST /api/v2/orders/create-sell-order` (debits the fund and pays the merchant). Signed: `partnerCode|externalOrderId|currency|fiatAmount|bankCode|bankAccountNumber|content|userEmail|`. `externalOrderId` is ours and is the idempotency key (duplicate = error 11). Put `qrType` and the country key (`PH`, `GE`, `BR`, `AR`, `PE`) with `recipientName` and `additionalData` in `extendInfo`; `null` for VND and NGN. Pass `webhookSecretKey` to get the webhook.
4. Webhook on terminal status, plus `POST /api/v2/orders/details` (signed `partnerCode|externalOrderId|`).

Other endpoints: `orders/prices` (signed `partnerCode|currencies|network|`), `bank/get-supported-banks` (signed `partnerCode|`), `bank/account/verify` (signed `partnerCode|bankCode|bankAccountNumber|`), `account/verify` (signed `partnerCode|`, use it to check key, code and IP), sandbox `POST /api/v2/public/generate-philippines-qrcode` (`amount` >= 200) returns a test `qrContent`.

## Order object and statuses

Fields: `externalOrderId`, `type` (`SELL`), `fiatAmount`, `paidAmount`, `status`, `tokenTransfer{currency,network,price,amount,address,txHash,memo}`, `bankTransfer{...}`, `fees{systemFee,processingFee}`, `createdAt`, `expiresAt` (UTC+7, created + 15 min), `signature`. Signed: `externalOrderId|type|fiatAmount|status|`.

`AWAITING_PAYMENT` then `PAYMENT_COMPLETED` / `PROCESSING` then terminal `SUCCESS` or `ERROR` (fund refunded). Treat unknown statuses as in progress.

## Webhook

POST JSON, body is the order object plus `id`. Fired once, only at `SUCCESS` or `ERROR`. Signature covers only `externalOrderId|type|fiatAmount|status|`, so after verifying, re-read the order from `orders/details`. Reply `200` with an empty body first. No retry policy is documented, so run a reconciliation sweep over non-terminal orders (same lesson as PAJ Cash: polling is the source of truth).

## Currencies and countries

Countries (QR decode): VN, PH, TH, GE, BR, AR, PE. Fiat: VND (default), PHP, ARS, BRL, PEN, GEL, IDR. `fiatAmount` decimals: VND 0, IDR 0, PHP 2, ARS 2, BRL 2, PEN 2 (truncated, not rounded). Crypto examples USDT, ETH, BTC on ERC20, TRC20, TON. Min and max per currency come from `orders/prices`.

## Not read yet

KYC (`/v2/api-reference/kyc`), fund (`fund`), cashout, errors, response-format pages. Read them before building.
