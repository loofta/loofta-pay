# GCP KMS secrets

Reference for AI agents and devs working on production secrets in `apps/backend`. Covers what's
KMS-wrapped today, how decryption actually happens at boot, who should have access, and how to
add or rotate a secret.

## Why this exists

Railway env vars are plaintext at rest in Railway's own dashboard/API. For the handful of secrets
that can move real money if leaked (the Solana fee payer's private key, the burner-wallet
encryption key), Loofta wraps them with Google Cloud KMS instead of setting them directly — Railway
only ever holds a **ciphertext**, and the backend decrypts it in memory once at boot, before
`NestFactory.create()` runs. See `apps/backend/src/common/kms-secrets.ts` for the actual code; this
doc is the "how do I operate this" companion to it.

## Key inventory

| Secret (env var) | Purpose | KMS crypto key name | Status |
|---|---|---|---|
| `SOLANA_FEE_PAYER_PRIVATE_KEY` | Solana keypair that pays tx fees / sponsors gas & rent (`SolanaSponsorService`) | `SOLANA_FEE_PAYER_PRIVATE_KEY` | KMS-wrapped in prod, required |
| `SEND_PAYMENT_ENC_KEY` | Encrypts claim-burner wallet secrets at rest (`ClaimsService`) | `SEND_PAYMENT_ENC_KEY` | KMS-wrapped in prod, required |
| `SEND_PAYMENT_ENC_KEY_OLD` | Previous `SEND_PAYMENT_ENC_KEY`, kept only during a rotation window so already-encrypted burner secrets stay decryptable | `SEND_PAYMENT_ENC_KEY_OLD` | KMS-wrapped, optional (only present mid-rotation) |
| `LOOFTA_BOT_AUTH_PRIVATE_KEY` | Lets the backend sign auto-pay transactions on an enrolled user's behalf (`/app/twitter-bot`) | `LOOFTA_BOT_AUTH_PRIVATE_KEY` | Wired into `KMS_SECRETS` in `kms-secrets.ts`, but **not yet in `REQUIRED_IN_PRODUCTION`** — the auto-pay signing code that consumes it hasn't shipped yet. Add it there once that code exists. Local dev: plain `LOOFTA_BOT_AUTH_PRIVATE_KEY` in `.env.local`, no KMS involved. |

Keyring: **`looftapay`**, location: **`global`** (both configurable via `KMS_KEY_RING` /
`KMS_LOCATION`, but every secret above uses the defaults — don't override per-secret without a
reason, it makes the inventory harder to audit).

## How to list what actually exists

Needs `gcloud` installed and authenticated (`gcloud auth login`) as an account with at least
`roles/cloudkms.viewer` on the project. Nothing here can run from this environment — no `gcloud`
CLI and no GCP credentials are available in this sandbox, so these are commands to run yourself:

```bash
# Which keyrings exist
gcloud kms keyrings list --location=global --project=<GCP_PROJECT_ID>

# Keys inside the looftapay keyring (should match the inventory table above)
gcloud kms keys list --keyring=looftapay --location=global --project=<GCP_PROJECT_ID>

# Every key's IAM policy (who can encrypt/decrypt with it specifically)
gcloud kms keys get-iam-policy SOLANA_FEE_PAYER_PRIVATE_KEY \
  --keyring=looftapay --location=global --project=<GCP_PROJECT_ID>

# Versions of a given key (for checking rotation state / which version is primary)
gcloud kms keys versions list --key=SOLANA_FEE_PAYER_PRIVATE_KEY \
  --keyring=looftapay --location=global --project=<GCP_PROJECT_ID>
```

`<GCP_PROJECT_ID>` is whatever `GCP_PROJECT_ID` is set to in Railway's backend env — check there if
unsure, don't guess it.

## Who runs the encryption / decryption

**Decryption** happens automatically, server-side, on every backend boot in production —
no human runs it manually. `main.ts` calls `loadKmsSecrets()` (from `kms-secrets.ts`) before
`NestFactory.create()`. That function:

1. Writes the service-account JSON (from `GCP_SA_KEY_BASE64`, base64-encoded in Railway) to a temp
   file and points `GOOGLE_APPLICATION_CREDENTIALS` at it — this is how the backend authenticates
   to GCP, not a human's `gcloud auth`.
2. For each `KMS_<SECRET_NAME>` env var present, calls `KeyManagementServiceClient.decrypt()`
   against `projects/<project>/locations/global/keyRings/looftapay/cryptoKeys/<SECRET_NAME>`.
3. Sets the decrypted plaintext onto `process.env[<SECRET_NAME>]` so the rest of the app (e.g.
   `SolanaSponsorService`, `ClaimsService`) reads it exactly like a normal env var — nothing
   downstream of boot needs to know KMS is involved at all.
4. Deletes the temp service-account file.
5. **Fails closed in production**: if `NODE_ENV=production` and either no `KMS_*` vars are set at
   all, or a *required* secret (`SOLANA_FEE_PAYER_PRIVATE_KEY`, `SEND_PAYMENT_ENC_KEY`) didn't
   successfully decrypt, the process throws and refuses to boot rather than silently falling back
   to a plaintext/stale value. Local dev has no such requirement — plain env vars work fine there.

**Encryption** (producing a new ciphertext to put in Railway) is a manual, one-off action a human
runs from their own machine — there's no code path for it, by design, since it should happen rarely
and deliberately. See "Adding a new secret" below for the exact command.

## Who should have access (IAM)

Two distinct roles, don't conflate them:

- **The backend's service account** (whose key is base64'd into Railway's `GCP_SA_KEY_BASE64`)
  needs only `roles/cloudkms.cryptoKeyDecrypter`, scoped to the `looftapay` keyring (or per-key,
  tighter still). It should **never** have `cloudkms.cryptoKeyEncrypter` or `cloudkms.admin` — the
  running app has no legitimate reason to ever produce new ciphertexts, only consume them. If this
  account can encrypt, a backend compromise could silently re-wrap a secret with an attacker-known
  key.
- **Humans who need to add/rotate secrets** (currently: Lisa; extend deliberately, not by default)
  need `roles/cloudkms.admin` (to create new crypto keys) plus `roles/cloudkms.cryptoKeyEncrypter`
  on the keyring, granted through their own `gcloud auth login` identity — never share the
  service-account key file itself for this.

Check current bindings before assuming they're right:

```bash
gcloud kms keyrings get-iam-policy looftapay --location=global --project=<GCP_PROJECT_ID>
```

## Adding a new secret (e.g. the Twitter bot's Privy authorization key)

1. Create the crypto key (name it exactly like the env var it protects, matching the existing
   convention — this is what lets `kms-secrets.ts` derive the key path automatically from
   `KMS_KEY_RING`/`KMS_LOCATION` without a per-secret override):
   ```bash
   gcloud kms keys create LOOFTA_BOT_AUTH_PRIVATE_KEY \
     --keyring=looftapay --location=global --purpose=encryption --project=<GCP_PROJECT_ID>
   ```
2. Encrypt the actual secret value:
   ```bash
   echo -n "<the raw private key value>" | gcloud kms encrypt \
     --keyring=looftapay --location=global --key=LOOFTA_BOT_AUTH_PRIVATE_KEY \
     --project=<GCP_PROJECT_ID> \
     --plaintext-file=- --ciphertext-file=- | base64 > ciphertext.b64
   ```
3. Set `KMS_LOOFTA_BOT_AUTH_PRIVATE_KEY=<contents of ciphertext.b64>` in Railway's backend env
   (delete `ciphertext.b64` locally afterward — it's the encrypted form so it's low-risk to leave
   around, but no reason to).
4. Add `'LOOFTA_BOT_AUTH_PRIVATE_KEY'` to the `KMS_SECRETS` array in `kms-secrets.ts` (and to
   `REQUIRED_IN_PRODUCTION` once the auto-pay execution path that depends on it actually ships —
   don't add it there before the code that needs it exists, or production boot will fail for an
   unused secret).
5. Redeploy — `loadKmsSecrets()` picks it up automatically on next boot, no other code change
   needed to get it into `process.env`.

## Rotating an existing secret

Same shape as the existing `SEND_PAYMENT_ENC_KEY` / `SEND_PAYMENT_ENC_KEY_OLD` pattern — the `_OLD`
suffix exists specifically so already-encrypted data (burner wallet secrets) stays decryptable
during the window between rotating the key and re-encrypting everything under the new one:

1. Encrypt the new value under the same crypto key name (KMS keys support multiple versions —
   `gcloud kms encrypt` uses the primary version automatically) or create a new key if you're doing
   a full key rotation, not just a value rotation.
2. Set the new `KMS_<NAME>` ciphertext in Railway, and copy the *old* ciphertext to
   `KMS_<NAME>_OLD` before overwriting it.
3. Deploy. The app now has both old and new plaintext available at runtime — update any code that
   needs to fall back to `_OLD` for already-encrypted-under-the-old-key data (see how
   `SEND_PAYMENT_ENC_KEY_OLD` is consumed in `claims.service.ts` for the pattern).
4. Once nothing references the old value anymore (re-encryption backfill done, or confirmed nothing
   needed it), remove `KMS_<NAME>_OLD` from Railway and delete the old crypto key version.
