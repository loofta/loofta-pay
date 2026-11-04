/**
 * Server-side Peer Cash cash-out, signed by a backend-held Base wallet. The same sequence the browser runs
 * (apps/frontend/src/services/peerCash.ts): create the deposit, price it just under the oracle so a peer
 * fills it, and withdraw it again if nobody does. Imports are dynamic because both SDKs are ESM-only.
 */
import { fillerIncentiveSpreadBps } from './offramp-fee';

/** Above this, a buyer may take a slice no smaller than this instead of the whole deposit. */
const MIN_FILL_ATOMIC = 500_000_000n;

export async function peerCashout(opts: {
  /** USDC being deposited on Base. */
  amountAtomicUsdc: bigint;
  /** What the sender was charged; the fill incentive is sized from this. */
  grossAtomicUsdc: bigint;
  platform: string;
  currency: string;
  /** The raw handle: no @ or $. */
  payee: string;
  signer: any;
}): Promise<{ depositId: string; txHash?: string; accessPolicyTxHash?: string }> {
  const { createCashClient } = await import('@zkp2p/cash');
  const cash = createCashClient({ environment: 'production' });
  const result: any = await cash.cashout(
    {
      amount: opts.amountAtomicUsdc,
      receive: { platform: opts.platform, currency: opts.currency as any, payee: opts.payee },
      // One person fills the whole order.
      intentAmountRange: { min: opts.amountAtomicUsdc > MIN_FILL_ATOMIC ? MIN_FILL_ATOMIC : opts.amountAtomicUsdc, max: opts.amountAtomicUsdc },
    },
    { signer: opts.signer },
  );
  try {
    await applyFillerIncentive({ depositId: result.depositId, platform: opts.platform, currency: opts.currency, grossAtomicUsdc: opts.grossAtomicUsdc, signer: opts.signer });
  } catch (err) {
    // The deposit already exists on-chain. Hand it back with the error so it is still recorded.
    throw Object.assign(err instanceof Error ? err : new Error(String(err)), { cashout: result });
  }
  return result;
}

async function applyFillerIncentive(opts: { depositId: string; platform: string; currency: string; grossAtomicUsdc: bigint; signer: any }) {
  const spreadBps = fillerIncentiveSpreadBps(opts.grossAtomicUsdc);
  if (spreadBps === 0) return;
  const { Zkp2pClient, currencyInfo, getPaymentMethodsCatalog, getSpreadOracleConfig, resolvePaymentMethodHashFromCatalog } = await import('@zkp2p/sdk');
  const oracle: any = getSpreadOracleConfig(opts.currency as never);
  const currencyHash = (currencyInfo as any)[opts.currency]?.currencyCodeHash;
  const catalog = getPaymentMethodsCatalog(8453, 'production');
  const paymentMethodHash = resolvePaymentMethodHashFromCatalog(opts.platform, catalog);
  if (!oracle || !currencyHash || !paymentMethodHash) throw new Error('Could not price this cash out below the market rate.');
  const client = new Zkp2pClient({ walletClient: opts.signer, chainId: 8453, runtimeEnv: 'production' });
  await client.setOracleRateConfig({
    depositId: opts.depositId,
    paymentMethodHash,
    currencyHash: currencyHash as `0x${string}`,
    config: { adapter: oracle.adapter, adapterConfig: oracle.adapterConfig, spreadBps, maxStaleness: oracle.maxStaleness },
  });
}

/** Takes the unfilled USDC back out of the Peer escrow into the signing wallet. */
export async function peerWithdraw(depositId: string, signer: any) {
  const { createCashClient } = await import('@zkp2p/cash');
  const cash = createCashClient({ environment: 'production' });
  try {
    return await cash.withdraw(depositId, { signer });
  } catch (err) {
    // A deposit priced under the oracle is hidden from cash.order(), so cancel has to hit the escrow directly.
    const [escrow, raw] = depositId.split('_');
    if (!escrow?.startsWith('0x') || !raw) throw err;
    const { Zkp2pClient } = await import('@zkp2p/sdk');
    const client = new Zkp2pClient({ walletClient: signer, chainId: 8453, runtimeEnv: 'production' });
    const withdrawTxHash = await client.withdrawDeposit({ depositId: BigInt(raw), escrowAddress: escrow as `0x${string}` });
    return { depositId, withdrawTxHash };
  }
}

/** The curator's real reason for a rejected handle lives on error.cause, behind a generic wrapper message. */
export function peerCashoutErrorMessage(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    const message = (current as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim() && !/^Registering payee details with the curator failed\.?$/i.test(message.trim())) return message.trim();
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}
