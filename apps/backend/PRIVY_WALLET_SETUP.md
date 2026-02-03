# Privy Backend Wallet Setup

This guide explains how to set up the Privy backend wallet for private cross-chain payments.

## Overview

We use a dedicated Privy user account (`ADMIN_WALLET_USER_ID`) with a pregenerated Solana wallet. This wallet receives USDC from Near-Intents for private cross-chain payments.

**IMPORTANT:** To execute transactions (Privacy Cash) from this wallet, you MUST:
1. Create an authorization key
2. Add it as a signer to the wallet
3. Use the authorization key to sign transaction requests

Without an authorization key signer, the backend can only RECEIVE funds but cannot SEND/EXECUTE transactions.

## Setup Steps

### 1. Create or Use Existing Privy User

You already have `ADMIN_WALLET_USER_ID=did:privy:cmkx21q1e03uok30dsw0bnlrd` in your `.env.local`.

If you need to create a new user:

**Option A: Via Privy Dashboard**
1. Go to Privy Dashboard → Users
2. Create a new user (can use a placeholder email like `loofta-backend@yourdomain.com`)
3. Copy the user ID (format: `did:privy:...`)

**Option B: Via API**
```bash
curl --request POST https://auth.privy.io/api/v1/users \
  -u "<your-privy-app-id>:<your-privy-app-secret>" \
  -H "privy-app-id: <your-privy-app-id>" \
  -H "Content-Type: application/json" \
  -d '{
    "linked_accounts": [
      {
        "address": "loofta-backend@yourdomain.com",
        "type": "email"
      }
    ]
  }'
```

### 2. Ensure Solana Wallet Exists

The backend will automatically create a Solana wallet for the user if it doesn't exist on startup. You can also create it manually:

**Via API:**
```bash
curl --request POST https://auth.privy.io/api/v1/apps/<your-privy-app-id>/users/wallet \
  -u "<your-privy-app-id>:<your-privy-app-secret>" \
  -H "privy-app-id: <your-privy-app-id>" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "did:privy:cmkx21q1e03uok30dsw0bnlrd",
    "wallets": [
      {
        "chain_type": "solana",
        "wallet_index": 0
      }
    ]
  }'
```

### 3. Configure Environment Variables

Add to your backend `.env`:

```bash
# Privy credentials (already configured)
PRIVY_APP_ID=cmi50l24f0069kz0c1p67xxt9
PRIVY_APP_SECRET=5xBAChepjPvgQpsE5fEnjqnXx6S9sAgUXtxmevYP9Udatr8n8RzhGvSyBh4RCvwbw4wAQ6u3Wdjy1K1t9vpK8ERc

# Loofta backend wallet user ID
ADMIN_WALLET_USER_ID=did:privy:cmkx21q1e03uok30dsw0bnlrd
# OR use LOOFTA_WALLET_USER_ID if you prefer
# LOOFTA_WALLET_USER_ID=did:privy:cmkx21q1e03uok30dsw0bnlrd
```

### 4. Create Authorization Key and Add as Signer

**CRITICAL:** To execute transactions from the backend, you need an authorization key:

1. **Create authorization key:**
   ```bash
   openssl ecparam -name prime256v1 -genkey -noout -out private.pem && \
   openssl ec -in private.pem -pubout -out public.pem
   ```

2. **Register key quorum in Privy Dashboard:**
   - Go to Privy Dashboard → Authorization Keys
   - Click "New key" → "Register key quorum instead"
   - Paste the public key from `public.pem`
   - Set Authorization threshold to 1
   - Save the key quorum ID

3. **Add signer to wallet** (via API or frontend):
   ```bash
   # Get wallet address first (check backend logs)
   # Then add signer using Privy SDK or API
   ```

4. **Store private key securely:**

   **Development (.env.local):**
   ```bash
   # Get private key in base64 DER format:
   openssl ec -in private.pem -outform DER | base64
   
   # Then add to .env.local:
   PRIVY_AUTH_PRIVATE_KEY="<output-from-above-command>"
   ```
   
   **Important:** The private key should be in base64-encoded DER format, NOT the PEM format.
   
   **Production - Railway:**
   - Go to Railway Dashboard → Your Service → Variables
   - Add new variable: `PRIVY_AUTH_PRIVATE_KEY`
   - Paste the private key value (Railway encrypts it at rest)
   - Mark as "Sensitive" if available
   
   **Production - Vercel:**
   - Go to Vercel Dashboard → Your Project → Settings → Environment Variables
   - Add: `PRIVY_AUTH_PRIVATE_KEY`
   - Paste the private key value
   - Select "Sensitive" (Vercel encrypts it at rest)
   - Choose environment (Production, Preview, Development)
   
   **Production - AWS Secrets Manager (Optional, for extra security):**
   ```bash
   aws secretsmanager create-secret \
     --name "loofta/privy-auth-key" \
     --secret-string "<private-key-from-private.pem>"
   ```
   Then set in Railway/Vercel:
   ```bash
   AWS_SECRETS_MANAGER_SECRET_NAME="loofta/privy-auth-key"
   AWS_REGION="us-east-1"
   ```

See: https://docs.privy.io/recipes/wallets/user-and-server-signers

### 5. Verify Setup

When the backend starts, check the logs for:
```
[PrivyWalletService] Loofta backend wallet initialized successfully
[PrivyWalletService] Wallet ready: <solana-address>
```

If you see an error, check:
- Privy credentials are correct
- User ID exists in Privy
- User has necessary permissions

## How It Works

1. **User selects token for private cross-chain payment**
   - Frontend calls `/api/claims/deposit` with `isPrivate: true`
   - Backend gets or creates Solana wallet for Loofta user
   - Returns wallet address as Near-Intents destination

2. **Near-Intents routes payment**
   - User pays with any token (ETH, USDT, etc.)
   - Near-Intents swaps to USDC on Solana
   - USDC arrives at Loofta's backend wallet

3. **Backend executes Privacy Cash** (TODO: Implement monitoring cron job)
   - Monitor wallet for incoming USDC
   - Automatically execute Privacy Cash deposit + withdraw
   - Send to recipient's private address

## Security Notes

- The `ADMIN_WALLET_USER_ID` is a regular Privy user account
- The wallet can RECEIVE funds without authorization keys
- To SEND/EXECUTE transactions, you MUST use authorization keys as signers
- Authorization key private key must be stored securely (KMS in production)
- Backend signs transaction requests with authorization key private key
- Privy verifies signatures using the public key registered in the key quorum

## Troubleshooting

### Wallet not found
- Check user ID is correct
- Verify user exists in Privy Dashboard
- Check backend logs for initialization errors

### Wallet creation fails
- Verify Privy app credentials
- Check user has permission to create wallets
- Ensure Solana is enabled for your Privy app

### Transaction signing fails
- **CRITICAL:** Ensure authorization key is added as signer to the wallet
- Verify `PRIVY_AUTH_PRIVATE_KEY` is configured correctly
- Check authorization key quorum ID matches the signer ID
- Verify backend signs requests with authorization key (see Privy docs)
- Check Privy app permissions
- Ensure wallet has sufficient SOL for transaction fees

**Note:** Without an authorization key signer, transaction signing will ALWAYS fail. The wallet can only receive funds.

## Production Deployment (Railway/Vercel)

### Railway

1. **Add environment variable:**
   - Go to Railway Dashboard → Your Service → Variables
   - Click "New Variable"
   - Name: `PRIVY_AUTH_PRIVATE_KEY`
   - Value: Paste your private key (base64 DER format)
   - Click "Add"

2. **Railway automatically:**
   - Encrypts the variable at rest using envelope encryption
   - Makes it available to your app at runtime
   - Hides the value in the UI after saving

### Vercel

1. **Add environment variable:**
   - Go to Vercel Dashboard → Your Project → Settings → Environment Variables
   - Click "Add New"
   - Key: `PRIVY_AUTH_PRIVATE_KEY`
   - Value: Paste your private key (base64 DER format)
   - Check "Sensitive" checkbox
   - Select environment(s): Production, Preview, Development
   - Click "Save"

2. **Vercel automatically:**
   - Encrypts sensitive variables at rest
   - Only decrypts at build/runtime
   - Hides values in the UI

### Optional: AWS Secrets Manager (Extra Security)

If you want additional security layers:

1. **Create secret in AWS:**
   ```bash
   aws secretsmanager create-secret \
     --name "loofta/privy-auth-key" \
     --secret-string "<your-private-key-base64>"
   ```

2. **Add to Railway/Vercel:**
   ```bash
   AWS_SECRETS_MANAGER_SECRET_NAME="loofta/privy-auth-key"
   AWS_REGION="us-east-1"
   AWS_ACCESS_KEY_ID="<your-access-key>"
   AWS_SECRET_ACCESS_KEY="<your-secret-key>"
   ```

3. **Update code** to load from AWS Secrets Manager (see KMS_SETUP.md for implementation)

## 5. Gas Fee Sponsorship (Privy Handles This!)

**GOOD NEWS:** Privy automatically sponsors gas fees for transactions executed through their server-side API when using authorization keys.

### How It Works

When you execute transactions from the backend using Privy's API with an authorization key signer, Privy automatically sponsors the gas fees. **You don't need to fund the wallet with SOL.**

### What This Means

- ✅ **No SOL funding required** - Privy handles gas fees automatically
- ✅ **No manual wallet management** - No need to create a separate funding wallet
- ✅ **Simpler setup** - Just configure the authorization key and you're done
- ✅ **Cost-effective** - Privy manages the gas fee sponsorship

### Important Notes

- Privy's fee sponsorship works when transactions are executed through their API
- Make sure you're using Privy's transaction signing endpoints (not direct Solana RPC)
- The authorization key must be properly configured as a signer (see Step 3 above)
- Fee sponsorship is automatic - no additional configuration needed

### Optional: Check Balance (Informational Only)

If you want to check the wallet balance for monitoring purposes, you can use the `getSolBalance()` method, but it's not required for transactions to work.

## Next Steps

1. ✅ Backend wallet setup (this guide)
2. ✅ Authorization key configured
3. ⏳ Add signer to wallet (via API or frontend)
4. ✅ Gas fee sponsorship (Privy handles this automatically!)
5. ⏳ Implement wallet monitoring cron job
6. ⏳ Implement automatic Privacy Cash execution (using Privy API for transaction signing)
7. ⏳ Add error handling and retry logic
8. ⏳ Add monitoring and alerts

## Important: Transaction Execution

When implementing Privacy Cash execution from the backend, make sure to:

1. **Use Privy's API** for transaction signing (not direct Solana RPC)
2. **Include the authorization key** in the request headers/body
3. **Privy will automatically sponsor gas fees** - no SOL needed in the wallet

Example flow:
- Monitor wallet for incoming USDC
- When USDC arrives, call Privacy Cash SDK to create deposit/withdraw transactions
- Sign transactions using Privy's API (with authorization key)
- Privy sponsors the gas fees automatically
