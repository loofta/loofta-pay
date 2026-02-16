#!/usr/bin/env bash
# Deploy Payroll Attestation to NEAR mainnet.
# Prereqs: NEAR_ENV=mainnet near login, and ~2 NEAR on your account.
#
# 1) Set your mainnet account IDs (replace yourname with your NEAR mainnet account):
export CONTRACT_ACCOUNT="${CONTRACT_ACCOUNT:-payroll-attestation.yourname.near}"
export INIT_CALLER="${INIT_CALLER:-yourname.near}"
#
# 2) Create contract subaccount if it doesn't exist yet (one-time):
#    NEAR_ENV=mainnet near create-account payroll-attestation.yourname.near --masterAccount yourname.near --initialBalance 2
#
# 3) Run this script from contracts/payroll-attestation:
#    CONTRACT_ACCOUNT=payroll-attestation.yourname.near INIT_CALLER=yourname.near ./deploy-mainnet.sh
#    Or: ./deploy-mainnet.sh   (then edit the defaults above first)

set -e
cd "$(dirname "$0")"
export NEAR_ENV=mainnet

if [[ "$CONTRACT_ACCOUNT" == *"yourname"* ]] || [[ "$INIT_CALLER" == *"yourname"* ]]; then
  echo "Set CONTRACT_ACCOUNT and INIT_CALLER to your mainnet account IDs."
  echo "Example: CONTRACT_ACCOUNT=payroll-attestation.lisabey.near INIT_CALLER=lisabey.near $0"
  exit 1
fi

echo "Deploying to mainnet: $CONTRACT_ACCOUNT (caller: $INIT_CALLER)"
bash deploy.sh deploy-only

echo ""
echo "Next: set in apps/backend .env (or .env.local):"
echo "  NEAR_NETWORK_ID=mainnet"
echo "  NEAR_ATTESTATION_CONTRACT_ID=$CONTRACT_ACCOUNT"
echo "  NEAR_ATTESTATION_NEAR_ACCOUNT_ID=$INIT_CALLER"
echo "  NEAR_ATTESTATION_NEAR_PRIVATE_KEY=ed25519:...   # from ~/.near-credentials/mainnet/$INIT_CALLER.json"
