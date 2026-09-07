import { PublicKey } from "@solana/web3.js";

/**
 * Validate a Solana address by actually decoding it (base58 -> exactly 32 bytes),
 * not just checking length/charset — a regex accepts malformed strings that
 * happen to be the right shape but fail to decode to a real public key.
 */
export function isValidSolanaAddress(address: string): boolean {
  try {
    new PublicKey(address.trim());
    return true;
  } catch {
    return false;
  }
}

/**
 * Shape check for a Solana Name Service domain (`vitalik.sol`). Only says it LOOKS like a domain —
 * whether it's registered, and what it points at, needs an on-chain lookup (see useSolDomain).
 * Deliberately rejects sub-domains (`a.b.sol`) since resolution of those isn't wired up.
 */
export function isSolDomain(value: string): boolean {
  return /^[a-z0-9_-]+\.sol$/i.test((value || "").trim());
}

/**
 * Validate that an address matches the expected format for the given chain/network.
 * Use for destination addresses and refund addresses across the app.
 */
export function isValidAddressForChain(address: string, chain: string): boolean {
  const raw = (address || "").trim();
  if (!raw) return false;
  const ch = String(chain || "").toLowerCase();

  const evmChains = new Set([
    "eth", "ethereum", "base", "arb", "arbitrum", "op", "optimism",
    "bsc", "berachain", "pol", "polygon", "avax", "avalanche", "gnosis",
    "fantom", "ftm", "linea", "scroll", "zksync", "zk", "blast", "matic",
  ]);
  if (evmChains.has(ch)) return /^0x[a-fA-F0-9]{40}$/.test(raw);

  if (ch === "solana" || ch === "sol") return isValidSolanaAddress(raw);
  if (ch === "near") return /^[a-z0-9_.-]+\.(near|testnet)$/i.test(raw) || /^[a-f0-9]{64}$/i.test(raw);
  if (ch === "btc" || ch === "bitcoin") return /^bc1[0-9a-zA-Z]{20,90}$/.test(raw) || /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(raw);
  if (ch === "ton") return /^[A-Za-z0-9_-]{48,66}$/.test(raw);
  if (ch === "sui") return /^0x[a-fA-F0-9]{64}$/.test(raw);
  if (ch === "ada" || ch === "cardano") return /^addr1[0-9a-z]+$/.test(raw);
  if (ch === "zec" || ch === "zcash") return /^t1[0-9A-Za-z]{33}$/.test(raw) || /^zs1[0-9a-zA-Z]{75}$/.test(raw);
  if (ch === "xlm" || ch === "stellar") return /^G[2-7A-Z]{55}$/.test(raw);
  if (ch === "trx" || ch === "tron") return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(raw);
  if (ch === "xrp" || ch === "xrpledger") return /^r[1-9A-HJ-NP-Za-km-z]{25,35}$/.test(raw);
  if (ch === "ltc" || ch === "litecoin") return /^ltc1[0-9a-z]{20,90}$/.test(raw) || /^[LM3][a-km-zA-HJ-NP-Z1-9]{26,33}$/.test(raw);
  if (ch === "doge" || ch === "dogecoin") return /^D[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(raw);
  if (ch === "aptos") return /^0x[a-fA-F0-9]{64}$/.test(raw);

  return raw.length >= 20;
}

/**
 * Get default placeholder refund address for a given chain.
 * Used for quotes (dry runs) when user hasn't provided a refund address yet.
 * These are placeholder addresses (not real addresses) - only used for quote estimation.
 * 
 * @TODO: This is STRICTLY FOR MVP - TO BE REMOVED LATER when wallet connect is implemented
 */
export function getRefundToForChain(chain: string): string {
	const key = String(chain || "").toLowerCase();
	
	// EVM family chains - all use the same placeholder address. NOT any well-known null/system/
	// burn address (0x0-address, the "dead" address, etc.) — verified directly against 1-click's
	// /v0/quote: it rejects EVERY synthetic-looking address as "recipient is not valid" /
	// "refundTo is not valid", not just the literal zero address (confirmed both the zero address
	// AND 0x000...dEaD fail; an ordinary randomly-generated, unowned address passes). Since these
	// are dry quotes only (no funds ever move), any random valid-format address works — this one
	// was generated once and hardcoded, not derived from anything meaningful.
	const evmChains = new Set([
		"eth", "ethereum", "base", "arb", "arbitrum", "op", "optimism",
		"bsc", "berachain", "pol", "polygon", "avax", "avalanche", "gnosis",
		"fantom", "ftm", "linea", "scroll", "zksync", "zk", "blast"
	]);
	if (evmChains.has(key)) {
		return "0x8910b3f20921f1be3847182c54f10cd71d3de2d7";
	}
	
	// Chain-specific placeholder addresses (format-specific, not real addresses).
	// sol/solana was previously the System Program ID (all-zero pubkey) — also confirmed rejected
	// by 1-click's /v0/quote as "recipient is not valid"/"refundTo is not valid", same as the EVM
	// zero/dead addresses above. Now an ordinary randomly-generated Solana address, verified
	// against the live API. The other entries below are still the old all-zero/all-same-char
	// style placeholders and have NOT been individually verified against 1-click — if a dry quote
	// for one of these chains ever hits the same "not valid" rejection, replace it with a genuine
	// random address for that chain the same way (see git history on this file for how sol/EVM
	// were fixed and verified).
	const chainAddressMap: Record<string, string> = {
		ton: "UQ0000000000000000000000000000000000000000000000000000000000000000",
		btc: "bc1q000000000000000000000000000000000000000000000000000000000000",
		bitcoin: "bc1q000000000000000000000000000000000000000000000000000000000000",
		sui: "0x0000000000000000000000000000000000000000000000000000000000000000",
		sol: "DYeBR1Aimoib4cMyAgXYvrYKsorxNuPzc92mWHCmvLEu",
		solana: "DYeBR1Aimoib4cMyAgXYvrYKsorxNuPzc92mWHCmvLEu",
		ada: "addr1q000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
		cardano: "addr1q000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
		zec: "t100000000000000000000000000000000000000000",
		zcash: "t100000000000000000000000000000000000000000",
		xlm: "G000000000000000000000000000000000000000000000000000000000000000",
		stellar: "G000000000000000000000000000000000000000000000000000000000000000",
		trx: "T0000000000000000000000000000000000000000",
		tron: "T0000000000000000000000000000000000000000",
		xrp: "r0000000000000000000000000000000000000000",
		xrpledger: "r0000000000000000000000000000000000000000",
		ltc: "ltc1q000000000000000000000000000000000000000000000000000000000000",
		litecoin: "ltc1q000000000000000000000000000000000000000000000000000000000000",
		near: "0000000000000000000000000000000000000000000000000000000000000000.near",
		doge: "D0000000000000000000000000000000000000000",
		dogecoin: "D0000000000000000000000000000000000000000",
	};
	
	// Return chain-specific placeholder address if found, otherwise default to EVM placeholder
	return chainAddressMap[key] || "0x0000000000000000000000000000000000000000";
}

export function getRefundToForAssetId(assetId: string, fallbackChain?: string): string {
	const id = String(assetId || "");
	// Parse nep141:<head>-... to infer underlying chain family
	if (id.startsWith("nep141:")) {
		const rest = id.slice("nep141:".length);
		const head = rest.includes("-") ? rest.split("-")[0] : rest.split(".")[0];
		return getRefundToForChain(head || fallbackChain || "");
	}
	return getRefundToForChain(fallbackChain || "");
}
