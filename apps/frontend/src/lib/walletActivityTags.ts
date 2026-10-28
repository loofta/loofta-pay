/**
 * Per-browser notes about transactions this wallet made through Loofta, keyed by signature. They let
 * the History list say "Private", "Cross-chain" or "Jupiter" for things the chain alone can't tell
 * apart from a plain transfer. Purely a display convenience: History still works without them.
 */
export type WalletTxTag = {
  private?: boolean;
  kind?: "send" | "swap" | "bridge";
  /** Where a private send went (the chain only shows the relay). */
  to?: string;
  label?: string;
};

const KEY = "loofta:walletTxTags";
const MAX = 200;

function read(): Record<string, WalletTxTag> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, WalletTxTag>;
  } catch {
    return {};
  }
}

export function getWalletTxTags(): Record<string, WalletTxTag> {
  return read();
}

export function tagWalletTx(signature: string, tag: WalletTxTag): void {
  try {
    const all = read();
    all[signature] = tag;
    const keys = Object.keys(all);
    if (keys.length > MAX) for (const k of keys.slice(0, keys.length - MAX)) delete all[k];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable */
  }
}
