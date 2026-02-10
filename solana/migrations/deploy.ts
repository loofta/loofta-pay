// Run after anchor build (from solana/). Deploys private_payments to the cluster in Anchor.toml.
// One-time: then call initialize_config(platform_authority) with your backend key.

import * as anchor from "@coral-xyz/anchor";

module.exports = async function (provider: anchor.AnchorProvider) {
  anchor.setProvider(provider);
  // Add deploy steps if needed (e.g. initialize_config).
};
