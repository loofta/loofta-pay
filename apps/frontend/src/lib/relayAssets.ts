import type { NearToken } from "@/services/nearIntents";

/**
 * Tokens the NEAR Intents list does not carry, routed through Relay (relay.link) instead.
 * Mirrors RELAY_WITHDRAW_ASSETS on the backend, which owns the real contract addresses and is the
 * only place that decides what is routable: this file only makes the tokens selectable. The
 * `tokenId` prefix `relay:` is how every call site tells these apart from NEAR Intents tokens.
 */
export const RELAY_MIN_WITHDRAW_USDC = 2;

export const RELAY_TOKENS: NearToken[] = [
  {
    symbol: "ETH",
    name: "Ether",
    chain: "robinhood",
    address: "0x0000000000000000000000000000000000000000",
    tokenId: "relay:robinhood:eth",
    decimals: 18,
    logoURI: "/static/icons/network/ethereum.svg",
  },
  {
    symbol: "USDG",
    name: "Global Dollar",
    chain: "robinhood",
    address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
    tokenId: "relay:robinhood:usdg",
    decimals: 6,
    logoURI: "https://assets.coingecko.com/coins/images/51281/standard/GDN_USDG_Token_200x200.png",
  },
];

export function isRelayToken(t?: { tokenId?: string } | null): boolean {
  return !!t?.tokenId && t.tokenId.startsWith("relay:");
}

/** The backend's asset key for a Relay token, e.g. "robinhood:usdg". */
export function relayAssetKey(t: { tokenId?: string }): string {
  return String(t.tokenId ?? "").replace(/^relay:/, "");
}
