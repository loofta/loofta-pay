#!/usr/bin/env bash
# Build and optionally deploy Payroll Attestation to NEAR.
# Usage:
#   ./deploy.sh                    # build only
#   ./deploy.sh deploy             # build + deploy + init (set CONTRACT_ACCOUNT and INIT_CALLER)
#   ./deploy.sh deploy-only        # deploy existing WASM + init (no cargo build)
#   ./deploy.sh update             # deploy WASM only, no init (for already-initialized contract)
# Testnet: NEAR_ENV=testnet CONTRACT_ACCOUNT=payroll-attestation.lisabey.testnet INIT_CALLER=lisabey.testnet ./deploy.sh deploy

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
# cargo near build puts optimized WASM here (required for NEAR — avoid PrepareError::Deserialization)
WASM_NEAR_DIR="target/near"
WASM_NEAR="$WASM_NEAR_DIR/payroll_attestation.wasm"
WASM_NEAR_ALT="$WASM_NEAR_DIR/payroll_attestation/payroll_attestation.wasm"
WASM_RAW="target/wasm32-unknown-unknown/release/payroll_attestation.wasm"

# update = deploy existing WASM only (no build, no init). deploy-only = deploy + init. deploy = build + deploy + init.
if [[ "${1:-}" != "deploy-only" ]] && [[ "${1:-}" != "update" ]]; then
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

if [[ "${1:-}" != "deploy" && "${1:-}" != "deploy-only" && "${1:-}" != "update" ]]; then
  echo "Done (build only). Run with 'deploy' to build+deploy+init, 'deploy-only' to deploy+init, or 'update' to deploy WASM only (no init)."
  exit 0
fi

CONTRACT_ACCOUNT="${CONTRACT_ACCOUNT:-}"
INIT_CALLER="${INIT_CALLER:-}"
NEAR_ENV="${NEAR_ENV:-mainnet}"
SKIP_INIT=false
[[ "${1:-}" == "update" ]] && SKIP_INIT=true

# Use non-deprecated RPC (avoid 429 / "THIS ENDPOINT IS DEPRECATED")
if [[ "$NEAR_ENV" == "testnet" ]]; then
  export NODE_URL="${NODE_URL:-https://rpc.testnet.fastnear.com}"
else
  export NODE_URL="${NODE_URL:-https://free.rpc.fastnear.com}"
fi
if [[ -z "$CONTRACT_ACCOUNT" ]]; then
  echo "Deploy requires CONTRACT_ACCOUNT."
  echo "Example: CONTRACT_ACCOUNT=attestation.yourname.near ./deploy.sh update"
  echo "For first deploy + init also set INIT_CALLER and use deploy or deploy-only."
  exit 1
fi
if [[ "$SKIP_INIT" != "true" ]] && [[ -z "$INIT_CALLER" ]]; then
  echo "Deploy with init requires INIT_CALLER. Use 'update' to deploy WASM only (no init)."
  exit 1
fi

echo "Deploying to NEAR $NEAR_ENV: $CONTRACT_ACCOUNT"
NEAR_ENV="$NEAR_ENV" near deploy "$CONTRACT_ACCOUNT" "$WASM"

if [[ "$SKIP_INIT" == "true" ]]; then
  echo "Skipping init (update mode). Contract code updated."
else
  echo "Initializing contract (allowed_caller = $INIT_CALLER)..."
  NEAR_ENV="$NEAR_ENV" near call "$CONTRACT_ACCOUNT" new "{\"allowed_caller\": \"$INIT_CALLER\"}" --accountId "$CONTRACT_ACCOUNT"
fi

echo "Done. Set in backend .env:"
echo "  NEAR_ATTESTATION_CONTRACT_ID=$CONTRACT_ACCOUNT"
echo "  NEAR_ATTESTATION_NEAR_ACCOUNT_ID=${INIT_CALLER:-<caller-account>}"
echo "  NEAR_ATTESTATION_NEAR_PRIVATE_KEY=ed25519:..."
echo "  NEAR_NETWORK_ID=$NEAR_ENV"
