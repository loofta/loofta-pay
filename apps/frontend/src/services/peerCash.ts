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

/**
 * Total fee: 2% of the gross USDC, never under $0.10. The peer always gets a 1% (1 : 0.99) rate on the Base
 * deposit; Loofta keeps the rest of the fee, taken in the Solana bridge transaction by the backend.
 * Keep in sync with backend common/offramp-fee.ts.
 */
export const CASHOUT_FEE_RATE = 0.02;
const CASHOUT_MIN_FEE_ATOMIC = 100_000n;
const PEER_SPREAD_BPS = 100;
/** Above this, a buyer may take a slice no smaller than this instead of the whole deposit. */
const MIN_FILL_ATOMIC = 500_000_000n;

/** Whole amount up to $500; above that the smallest allowed fill stays at $500. */
function exactFillRange(amountAtomicUsdc: bigint) {
  return { min: amountAtomicUsdc > MIN_FILL_ATOMIC ? MIN_FILL_ATOMIC : amountAtomicUsdc, max: amountAtomicUsdc };
}

/** Total fee the sender pays out of the gross amount. */
export function cashoutFeeAtomic(amountAtomicUsdc: bigint): bigint {
  if (amountAtomicUsdc <= 0n) return 0n;
  const percent = (amountAtomicUsdc * 2n) / 100n;
  const fee = percent > CASHOUT_MIN_FEE_ATOMIC ? percent : CASHOUT_MIN_FEE_ATOMIC;
  return fee > amountAtomicUsdc ? amountAtomicUsdc : fee;
}

/** USDC that reaches the Base deposit: sized so the peer's 1% spread leaves exactly gross minus the total fee. */
export function cashoutDepositAtomic(grossAtomicUsdc: bigint): bigint {
  if (grossAtomicUsdc <= 0n) return 0n;
  const payout = grossAtomicUsdc - cashoutFeeAtomic(grossAtomicUsdc);
  const deposit = (payout * 10_000n + 9_899n) / 9_900n;
  return deposit > grossAtomicUsdc ? grossAtomicUsdc : deposit;
}

/** Loofta's share of the fee: whatever isn't the peer's 1%. */
export function cashoutLooftaFeeAtomic(grossAtomicUsdc: bigint): bigint {
  return grossAtomicUsdc - cashoutDepositAtomic(grossAtomicUsdc);
}

/** Negative oracle spread on the Base deposit: always 1%, so the peer sends 0.99 per 1 USDC. */
export function fillerIncentiveSpreadBps(grossAtomicUsdc: bigint): number {
  return cashoutDepositAtomic(grossAtomicUsdc) > 0n ? -PEER_SPREAD_BPS : 0;
}

export function cashoutPayoutAtomic(amountAtomicUsdc: bigint): bigint {
  return amountAtomicUsdc - cashoutFeeAtomic(amountAtomicUsdc);
}

/** USDC the sender must deposit so the recipient still gets `payout` after the total fee. */
export function cashoutGrossAtomic(payoutAtomicUsdc: bigint): bigint {
  if (payoutAtomicUsdc <= 0n) return 0n;
  const withMin = payoutAtomicUsdc + CASHOUT_MIN_FEE_ATOMIC;
  if (cashoutFeeAtomic(withMin) <= CASHOUT_MIN_FEE_ATOMIC) return withMin;
  let gross = (payoutAtomicUsdc * 100n) / 98n;
  while (gross - cashoutFeeAtomic(gross) < payoutAtomicUsdc) gross += 1n;
  return gross;
}

export function cashoutFeeUsdc(amountUsdc: number): number {
  if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) return 0;
  return Number(cashoutFeeAtomic(BigInt(Math.round(amountUsdc * 1_000_000)))) / 1_000_000;
}

export function cashoutPayoutUsdc(amountUsdc: number): number {
  if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) return 0;
  return Number(cashoutPayoutAtomic(BigInt(Math.round(amountUsdc * 1_000_000)))) / 1_000_000;
}

export function cashoutGrossUsdc(payoutUsdc: number): number {
  if (!Number.isFinite(payoutUsdc) || payoutUsdc <= 0) return 0;
  return Number(cashoutGrossAtomic(BigInt(Math.round(payoutUsdc * 1_000_000)))) / 1_000_000;
}

export async function peerCashout(opts: {
  /** USDC being deposited on Base (gross minus Loofta's cut). */
  amountAtomicUsdc: bigint;
  /** What the sender was charged; the fill incentive is sized from this. */
  grossAtomicUsdc: bigint;
  platform: string;
  currency: string;
  payee: string;
  signer: WalletClient;
  /** Up to $500 one buyer takes the whole amount; above that, fills are at least $500. */
  exactFill?: boolean;
}) {
  const { amountAtomicUsdc, grossAtomicUsdc, platform, currency, payee, signer, exactFill } = opts;
  const result = await getPeerCashClient().cashout(
    {
      amount: amountAtomicUsdc,
      receive: { platform, currency: currency as any, payee },
      ...(exactFill ? { intentAmountRange: exactFillRange(amountAtomicUsdc) } : {}),
    },
    { signer },
  );
  try {
    await applyFillerIncentive({
      depositId: result.depositId,
      platform,
      currency,
      grossAtomicUsdc,
      signer,
    });
  } catch (err) {
    // The deposit already exists on-chain at this point. Hand it back with the error so a caller can
    // still record it instead of losing track of the money.
    throw Object.assign(err instanceof Error ? err : new Error(String(err)), { cashout: result });
  }
  return result;
}

/** Price the deposit under the oracle so a peer sends less fiat — the sender already covered that gap. */
async function applyFillerIncentive(opts: {
  depositId: string;
  platform: string;
  currency: string;
  grossAtomicUsdc: bigint;
  signer: WalletClient;
}) {
  const spreadBps = fillerIncentiveSpreadBps(opts.grossAtomicUsdc);
  if (spreadBps === 0) return;
  const {
    Zkp2pClient,
    currencyInfo,
    getPaymentMethodsCatalog,
    getSpreadOracleConfig,
    resolvePaymentMethodHashFromCatalog,
  } = await import("@zkp2p/sdk");
  const oracle = getSpreadOracleConfig(opts.currency as never);
  const currencyHash = currencyInfo[opts.currency as keyof typeof currencyInfo]?.currencyCodeHash;
  const catalog = getPaymentMethodsCatalog(8453, "production");
  const paymentMethodHash = resolvePaymentMethodHashFromCatalog(opts.platform, catalog);
  if (!oracle || !currencyHash || !paymentMethodHash) {
    throw new Error("Could not price this cash out below the market rate.");
  }
  const client = new Zkp2pClient({
    walletClient: opts.signer,
    chainId: 8453,
    runtimeEnv: "production",
  });
  await client.setOracleRateConfig({
    depositId: opts.depositId,
    paymentMethodHash,
    currencyHash: currencyHash as `0x${string}`,
    config: {
      adapter: oracle.adapter,
      adapterConfig: oracle.adapterConfig,
      spreadBps,
      maxStaleness: oracle.maxStaleness,
    },
  });
}

export async function peerWithdraw(depositId: string, signer: WalletClient, amountAtomicUsdc?: bigint) {
  try {
    return await getPeerCashClient().withdraw(depositId, { signer, ...(amountAtomicUsdc != null ? { amount: amountAtomicUsdc } : {}) });
  } catch (err) {
    // A deposit priced under the oracle is hidden from cash.order(), so cancel has to hit the escrow directly.
    if (amountAtomicUsdc != null) throw err;
    const [escrow, raw] = depositId.split("_");
    if (!escrow?.startsWith("0x") || !raw) throw err;
    const { Zkp2pClient } = await import("@zkp2p/sdk");
    const client = new Zkp2pClient({ walletClient: signer, chainId: 8453, runtimeEnv: "production" });
    const withdrawTxHash = await client.withdrawDeposit({
      depositId: BigInt(raw),
      escrowAddress: escrow as `0x${string}`,
    });
    return { depositId, withdrawTxHash };
  }
}

/**
 * Pulls the most useful human-readable reason out of a failed `cash.cashout()`. The SDK wraps
 * curator rejections in a generic `PAYEE_REGISTRATION_FAILED` CashError ("Registering payee
 * details with the curator failed.") whose real cause — e.g. "X Money screen name not found:
 * quircks" — lives on `error.cause`, so surface that instead of the wrapper text.
 */
export function peerCashoutErrorMessage(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    const message = (current as { message?: unknown }).message;
    if (
      typeof message === "string" &&
      message.trim() &&
      !/^Registering payee details with the curator failed\.?$/i.test(message.trim())
    ) {
      return message.trim();
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

export function peerOrder(depositId: string): Promise<CashOrder> {
  return getPeerCashClient().order(depositId);
}

export function peerOrders(owner: string, opts?: { inFlight?: boolean; limit?: number }): Promise<CashOrder[]> {
  return getPeerCashClient().orders(owner, opts);
}

export { usdc };
export type { CashOrder, CashEstimate, CashCapabilities, CashFillStats };
