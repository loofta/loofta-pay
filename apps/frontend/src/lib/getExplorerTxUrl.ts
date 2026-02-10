/**
 * Returns the block explorer transaction URL for a given chain and transaction hash.
 * Supports all networks used in checkout/deposits.
 */
const EXPLORER_TX_BY_CHAIN: Record<string, string> = {
  solana: "https://solscan.io/tx",
  sol: "https://solscan.io/tx",
  ethereum: "https://etherscan.io/tx",
  eth: "https://etherscan.io/tx",
  base: "https://basescan.org/tx",
  arbitrum: "https://arbiscan.io/tx",
  arb: "https://arbiscan.io/tx",
  polygon: "https://polygonscan.com/tx",
  matic: "https://polygonscan.com/tx",
  pol: "https://polygonscan.com/tx",
  optimism: "https://optimistic.etherscan.io/tx",
  op: "https://optimistic.etherscan.io/tx",
  bsc: "https://bscscan.com/tx",
  avalanche: "https://snowtrace.io/tx",
  avax: "https://snowtrace.io/tx",
  gnosis: "https://gnosisscan.io/tx",
  xdai: "https://gnosisscan.io/tx",
  near: "https://nearblocks.io/tx",
  berachain: "https://berascan.com/tx",
  bera: "https://berascan.com/tx",
  monad: "https://explorer.monad.xyz/tx",
  starknet: "https://starkscan.co/tx",
  ton: "https://tonscan.org/tx",
  aptos: "https://aptoscan.com/tx",
  cardano: "https://cardanoscan.io/transaction",
  xlayer: "https://xlayer.blockscout.com/tx",
  adi: "https://adi.blockscout.com/tx",
};

export function getExplorerTxUrl(chain: string | undefined | null, txHash: string): string {
  if (!txHash?.trim()) return "#";
  const key = String(chain ?? "").toLowerCase().trim();
  const base = (EXPLORER_TX_BY_CHAIN[key] ?? EXPLORER_TX_BY_CHAIN.ethereum).replace(/\/$/, "");
  return `${base}/${txHash.trim()}`;
}

export function getExplorerName(chain: string | undefined | null): string {
  const key = String(chain ?? "").toLowerCase().trim();
  const names: Record<string, string> = {
    solana: "Solscan",
    sol: "Solscan",
    ethereum: "Etherscan",
    eth: "Etherscan",
    base: "Basescan",
    arbitrum: "Arbiscan",
    arb: "Arbiscan",
    polygon: "Polygonscan",
    matic: "Polygonscan",
    pol: "Polygonscan",
    optimism: "Optimistic Etherscan",
    op: "Optimistic Etherscan",
    bsc: "BscScan",
    avalanche: "Snowtrace",
    avax: "Snowtrace",
    gnosis: "Gnosisscan",
    xdai: "Gnosisscan",
    near: "Nearblocks",
    berachain: "Berascan",
    bera: "Berascan",
    monad: "Monad Explorer",
    starknet: "Starkscan",
    ton: "Tonscan",
    aptos: "Aptoscan",
    cardano: "Cardanoscan",
    xlayer: "X Layer Explorer",
    adi: "Adi Explorer",
  };
  return names[key] ?? "Explorer";
}
