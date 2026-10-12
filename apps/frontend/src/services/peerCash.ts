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

/** Cash-out is 2% under the amount paid, and the fee is never under $0.30. */
export const CASHOUT_FEE_RATE = 0.02;
export const CASHOUT_MIN_FEE_USDC = 0.3;

export function cashoutFeeAtomic(amountAtomicUsdc: bigint): bigint {
  if (amountAtomicUsdc <= 0n) return 0n;
  const percent = (amountAtomicUsdc * 2n) / 100n;
  const minimum = 300_000n;
  const fee = percent > minimum ? percent : minimum;
  return fee > amountAtomicUsdc ? amountAtomicUsdc : fee;
}

export function cashoutPayoutAtomic(amountAtomicUsdc: bigint): bigint {
  return amountAtomicUsdc - cashoutFeeAtomic(amountAtomicUsdc);
}

export function cashoutFeeUsdc(amountUsdc: number): number {
  if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) return 0;
  return Number(cashoutFeeAtomic(BigInt(Math.round(amountUsdc * 1_000_000)))) / 1_000_000;
}

export function cashoutPayoutUsdc(amountUsdc: number): number {
  if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) return 0;
  return Number(cashoutPayoutAtomic(BigInt(Math.round(amountUsdc * 1_000_000)))) / 1_000_000;
}

export async function peerCashout(opts: {
  amountAtomicUsdc: bigint;
  platform: string;
  currency: string;
  payee: string;
  signer: WalletClient;
  /** One buyer must take the whole amount — no partial fills. */
  exactFill?: boolean;
}) {
  const { amountAtomicUsdc, platform, currency, payee, signer, exactFill } = opts;
  return getPeerCashClient().cashout(
    {
      amount: amountAtomicUsdc,
      receive: { platform, currency: currency as any, payee },
      ...(exactFill ? { intentAmountRange: { min: amountAtomicUsdc, max: amountAtomicUsdc } } : {}),
    },
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
