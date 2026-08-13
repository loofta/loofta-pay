/**
 * Thin wrapper around @zkp2p/cash (the "Peer Cash" SDK) — the maker-side offramp facade that
 * replaced our hand-rolled @zkp2p/sdk OfframpClient/createDeposit/withdrawDeposit calls.
 *
 * We still bridge Solana USDC -> Base USDC ourselves via Near Intents (offramp.service.ts) before
 * calling into this client — Peer Cash's own Relay-based source routing only accepts EVM source
 * assets, not Solana, so it can't replace that leg.
 */
import { createCashClient, usdc, type CashClient, type CashOrder, type CashEstimate, type CashCapabilities, type CashFillStats } from "@zkp2p/cash";
import type { WalletClient } from "viem";

let client: CashClient | null = null;

export function getPeerCashClient(): CashClient {
  if (!client) client = createCashClient({ environment: "production" });
  return client;
}

/** Sync, no network call — platform list, payee hints, identity-attestation requirements. */
export function getPeerCapabilities(): CashCapabilities {
  return getPeerCashClient().capabilities();
}

/** Cached 30-day fill counts + median first-fill time, keyed by "platform:CURRENCY". */
export function getPeerFillStats(): Promise<CashFillStats> {
  return getPeerCashClient().fillStats();
}

export function getPeerEstimate(amountAtomicUsdc: bigint, currency: string, platform?: string, includeEta = true): Promise<CashEstimate> {
  return getPeerCashClient().estimate({ amount: amountAtomicUsdc, currency: currency as any, platform }, { includeEta });
}

export async function peerCashout(opts: {
  amountAtomicUsdc: bigint;
  platform: string;
  currency: string;
  payee: string;
  signer: WalletClient;
}) {
  const { amountAtomicUsdc, platform, currency, payee, signer } = opts;
  return getPeerCashClient().cashout(
    { amount: amountAtomicUsdc, receive: { platform, currency: currency as any, payee } },
    { signer },
  );
}

export function peerWithdraw(depositId: string, signer: WalletClient, amountAtomicUsdc?: bigint) {
  return getPeerCashClient().withdraw(depositId, { signer, ...(amountAtomicUsdc != null ? { amount: amountAtomicUsdc } : {}) });
}

export function peerOrder(depositId: string): Promise<CashOrder> {
  return getPeerCashClient().order(depositId);
}

export function peerOrders(owner: string, opts?: { inFlight?: boolean; limit?: number }): Promise<CashOrder[]> {
  return getPeerCashClient().orders(owner, opts);
}

export { usdc };
export type { CashOrder, CashEstimate, CashCapabilities, CashFillStats };
