export const BOOST_PRICE = 30; // Price in USDT

// Payment addresses for different networks
export const PAYMENT_ADDRESSES = {
  taraxa: "0xEC523839fd5Aa275115d382A996Db616A3a7465F",
  eth: "0xEC523839fd5Aa275115d382A996Db616A3a7465F" // Same address for now, can be updated later
};

// Blockchain explorer URLs for transaction viewing
export const BLOCKCHAIN_EXPLORERS = {
  taraxa: "https://tara.to",
  eth: "https://etherscan.io"
};

// Legacy constant for backward compatibility
export const ERC20_PAYMENT_ADDRESS = PAYMENT_ADDRESSES.taraxa;

export const SOLANA_PAYMENT_ADDRESS = "0xEC523839fd5Aa275115d382A996Db616A3a7465F";

// Network URLs
export const TARAXA_EXPLORER_URL = "https://mainnet.explorer.taraxa.io";
export const PAYMENT_ADDRESS = "0xEC523839fd5Aa275115d382A996Db616A3a7465F"; 