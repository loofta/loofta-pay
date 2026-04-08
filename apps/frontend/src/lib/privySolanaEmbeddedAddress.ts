/**
 * Resolve the Solana address used for Loofta embedded payments and USDC balance.
 * Matches Header / Pay flow: prefer linked wallet, then embedded Solana account.
 */
export function deriveSolanaEmbeddedAddress(
  user: {
    linked_accounts?: Array<{ type?: string; address?: string }>;
    linkedAccounts?: Array<{ type?: string; address?: string }>;
  } | null
): string | null {
  if (!user) return null;
  const linkedAccounts = ((user as { linkedAccounts?: unknown }).linkedAccounts ??
    (user as { linked_accounts?: unknown }).linked_accounts ??
    []) as Array<{ type?: string; address?: string }>;
  const base58 = (a: { address?: string }) =>
    a?.address && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a.address);
  const walletOrSmart = linkedAccounts.find(
    (a) => (a.type === "wallet" || a.type === "smart_wallet") && base58(a)
  );
  if (walletOrSmart?.address) return walletOrSmart.address;
  const embedded = linkedAccounts.find(
    (a) =>
      (a.type === "solana_embedded_wallet" || a.type === "solana") && base58(a)
  );
  if (embedded?.address) return embedded.address;
  const wallet = linkedAccounts.find((a) => a.type === "wallet" && base58(a));
  return wallet?.address ?? null;
}
