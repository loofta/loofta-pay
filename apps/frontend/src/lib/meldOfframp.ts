/** localStorage key holding the Meld widget session id while the user is away verifying with the provider. */
export const MELD_SESSION_KEY = "loofta:meldOfframpSession";

/**
 * Set when the cash-out started from a partner payout. The payout is only claimed (and the partner and Loofta fees
 * taken) on the final "Send" step, so backing out earlier costs nothing. `done` flips once that claim succeeded.
 */
export const MELD_PARTNER_KEY = "loofta:meldPartnerWithdraw";
export type MeldPartnerStash = { orgId: string; maxFeeUsdc: number; done?: boolean };

/** Countries where Meld returned a live USDC sell quote (probed 2026-11-06). Anywhere else the bank row is hidden. */
export const MELD_SELL_COUNTRIES = new Set([
  "AE","AR","AT","BE","BG","CL","CM","CO","CY","CZ","DE","DK","EC","EE","ES","FI","FR","GR","HR","HU","ID","IN","IT","KE",
  "LT","LU","LV","MT","MX","NG","NL","PA","PH","PL","PT","RO","SE","SI","SK","SV","US",
]);
