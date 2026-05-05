/**
 * Cross-chain payments (non-Solana sources via NEAR Intents).
 * Disabled on mainnet beta — burner + auto-sweep not yet wired for registered users.
 * Set NEXT_PUBLIC_CROSS_CHAIN_ENABLED=true in .env.local to enable for development/testing.
 */
export const CROSS_CHAIN_ENABLED = process.env.NEXT_PUBLIC_CROSS_CHAIN_ENABLED === "true";
