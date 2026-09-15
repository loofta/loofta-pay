// Devnet-demo mode (free devnet USDC, no real money) shares every table and code path with real
// Nest usage — profile, holdings, trades, rebalance — but MUST never let its fake balance be
// mistaken for real capital. Rather than tagging fungible cash with provenance after deposit
// (which breaks the moment real and demo deposits ever mix in the same row), demo mode gets its
// own ledger identity: a suffixed user_id. Same tables, same rebalance engine, zero chance of
// conflating the two — see nest-rebalance.service.ts's solvency check, which excludes this suffix
// from real-capital accounting.
const DEMO_SUFFIX = ':devnet-demo';

export function ledgerUserId(userId: string, demo: boolean): string {
  return demo ? `${userId}${DEMO_SUFFIX}` : userId;
}

export function isDemoLedgerUserId(userId: string): boolean {
  return userId.endsWith(DEMO_SUFFIX);
}
