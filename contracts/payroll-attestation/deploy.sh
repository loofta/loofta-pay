#!/usr/bin/env bash
# Build and optionally deploy Payroll Attestation to NEAR.
# Usage:
#   ./deploy.sh                    # build only
#   ./deploy.sh deploy             # build + deploy (set CONTRACT_ACCOUNT and INIT_CALLER)
#   ./deploy.sh deploy-only        # deploy existing WASM only (no cargo build)
#   CONTRACT_ACCOUNT=attestation.yourname.near INIT_CALLER=your-backend.near ./deploy.sh deploy
# Testnet: NEAR_ENV=testnet CONTRACT_ACCOUNT=payroll-attestation.lisabey.testnet INIT_CALLER=lisabey.testnet ./deploy.sh deploy

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
# cargo near build puts optimized WASM here (required for NEAR — avoid PrepareError::Deserialization)
WASM_NEAR_DIR="target/near"
WASM_NEAR="$WASM_NEAR_DIR/payroll_attestation.wasm"
WASM_NEAR_ALT="$WASM_NEAR_DIR/payroll_attestation/payroll_attestation.wasm"
WASM_RAW="target/wasm32-unknown-unknown/release/payroll_attestation.wasm"

if [[ "${1:-}" != "deploy-only" ]]; then
  echo "Building payroll-attestation..."
  if command -v cargo-near &>/dev/null || command -v cargo near &>/dev/null; then
    if cargo near build 2>/dev/null; then
      echo "Built with cargo near (use this WASM for deploy)."
    else
      cargo build --target wasm32-unknown-unknown --release
    fi
  else
    echo "Hint: install cargo-near (cargo install cargo-near) so the WASM is optimized for NEAR VM."
    cargo build --target wasm32-unknown-unknown --release
  fi
fi
if [[ -f "$WASM_NEAR" ]]; then
  WASM="$WASM_NEAR"
elif [[ -f "$WASM_NEAR_ALT" ]]; then
  WASM="$WASM_NEAR_ALT"
elif [[ -f "$WASM_RAW" ]]; then
  echo "WARNING: Using raw WASM (target/wasm32-...). Init may fail with PrepareError::Deserialization. Run: cargo near build"
  WASM="$WASM_RAW"
else
  echo "WASM not found. Run: cargo near build (or cargo build --target wasm32-unknown-unknown --release)"
  exit 1
fi
echo "Using: $WASM ($(du -h "$WASM" | cut -f1))"

if [[ "${1:-}" != "deploy" && "${1:-}" != "deploy-only" ]]; then
  echo "Done (build only). Run with 'deploy' to build+deploy or 'deploy-only' to deploy existing WASM."
  exit 0
fi

CONTRACT_ACCOUNT="${CONTRACT_ACCOUNT:-}"
INIT_CALLER="${INIT_CALLER:-}"
NEAR_ENV="${NEAR_ENV:-mainnet}"
# Use non-deprecated RPC (avoid 429 / "THIS ENDPOINT IS DEPRECATED")
if [[ "$NEAR_ENV" == "testnet" ]]; then
  export NODE_URL="${NODE_URL:-https://rpc.testnet.fastnear.com}"
else
  export NODE_URL="${NODE_URL:-https://free.rpc.fastnear.com}"
fi
if [[ -z "$CONTRACT_ACCOUNT" ]] || [[ -z "$INIT_CALLER" ]]; then
  echo "Deploy requires CONTRACT_ACCOUNT and INIT_CALLER."
  echo "Example: CONTRACT_ACCOUNT=attestation.yourname.near INIT_CALLER=your-backend.near ./deploy.sh deploy"
  echo "Testnet: NEAR_ENV=testnet CONTRACT_ACCOUNT=payroll-attestation.yourname.testnet INIT_CALLER=yourname.testnet ./deploy.sh deploy"
  exit 1
fi

echo "Deploying to NEAR $NEAR_ENV: $CONTRACT_ACCOUNT"
NEAR_ENV="$NEAR_ENV" near deploy "$CONTRACT_ACCOUNT" "$WASM"

echo "Initializing contract (allowed_caller = $INIT_CALLER)..."
NEAR_ENV="$NEAR_ENV" near call "$CONTRACT_ACCOUNT" new "{\"allowed_caller\": \"$INIT_CALLER\"}" --accountId "$CONTRACT_ACCOUNT"
# Init takes a String; empty string = any caller. Same JSON shape.

echo "Done. Set in backend .env:"
echo "  NEAR_ATTESTATION_CONTRACT_ID=$CONTRACT_ACCOUNT"
echo "  NEAR_ATTESTATION_NEAR_ACCOUNT_ID=$INIT_CALLER"
echo "  NEAR_ATTESTATION_NEAR_PRIVATE_KEY=ed25519:..."
echo "  NEAR_NETWORK_ID=$NEAR_ENV"
