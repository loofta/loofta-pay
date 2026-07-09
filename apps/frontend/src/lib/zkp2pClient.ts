import type { EIP1193Provider } from "viem";

const BEAM_LOG = "[Beam zkp2p]";
export const BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const ZKP2P_RATE_UNIT = 1_000_000_000_000_000_000n; // 1e18

// conversionRate = fxRateFromUsd * (1 - spread) * 1e18 — how much of the payout currency a
// peer pays out per 1 USDC deposited. For USD payouts fxRateFromUsd is 1 (peers pay less fiat
// per USDC, incentivizing faster fills). For EUR (or any non-USD payout currency), fxRateFromUsd
// must be the live USD→currency rate so the peer pays out the correct converted amount.
export function zkp2pRate(spreadPercent: number, fxRateFromUsd: number = 1): string {
  const rate = fxRateFromUsd * (1 - spreadPercent / 100);
  return ((ZKP2P_RATE_UNIT * BigInt(Math.round(rate * 1_000_000))) / 1_000_000n).toString();
}

/** Gate check before any EVM gas-sponsored transaction. Throws if rate-limited. */
export async function assertEvmSponsorAllowed(walletAddress: string, userId: string, accessToken: string | null) {
  try {
    const res = await fetch("/api/payments/sponsor-check", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ walletAddress }),
    });
    if (res.status === 429 || res.status === 403) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error ?? "Sponsorship limit reached. Try again tomorrow.");
    }
  } catch (err) {
    if (err instanceof Error && (err.message.includes("limit") || err.message.includes("denied") || err.message.includes("Unauthorized"))) {
      throw err; // re-throw rate-limit / auth errors
    }
    // Network failure — fail open so users aren't blocked by infra issues
    console.warn("[evmSponsorGate] check failed, proceeding:", err);
  }
}

type PrivySendTx = (
  tx: { to: string; data?: string; value?: bigint; chainId: number },
  opts: { sponsor: boolean },
) => Promise<{ hash: string }>;

/**
 * Builds a viem wallet client whose eth_sendTransaction calls are routed through
 * Privy's gas-sponsored send (same pattern as the withdraw flow's Peer signing step),
 * plus a ZKP2P OfframpClient bound to it.
 */
export async function createSponsoredZkp2pClient(opts: {
  rawProvider: EIP1193Provider;
  privySendTx: PrivySendTx;
  baseWalletAddress: string;
}) {
  const { base } = await import("viem/chains");
  const { createWalletClient, createPublicClient, custom, http } = await import("viem");
  const { OfframpClient, getContracts } = await import("@zkp2p/sdk");

  const sponsoredTransport = custom({
    async request({ method, params }: { method: string; params: any[] }) {
      if (method === "eth_chainId") return "0x2105";
      if (method === "eth_sendTransaction") {
        const tx = params[0];
        const result = await opts.privySendTx({
          to: tx.to,
          data: tx.data,
          ...(tx.value ? { value: BigInt(tx.value) } : {}),
          chainId: base.id,
        }, { sponsor: true });
        return result.hash;
      }
      return opts.rawProvider.request({ method, params } as any);
    },
  });

  const walletClient = createWalletClient({
    chain: base,
    transport: sponsoredTransport,
    account: opts.baseWalletAddress as `0x${string}`,
  });

  const client = new OfframpClient({ walletClient: walletClient as any, chainId: base.id, runtimeEnv: "production" });
  const { addresses, abis } = getContracts(base.id, "production");
  const publicClient = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });

  return { client, addresses, abis, publicClient };
}

/**
 * Attaches Peer's oracle-backed "automatic rate management" (ARM) to a currency/processor pair
 * on an already-created deposit, at 0% spread — the deposit's conversion rate then tracks the
 * live Chainlink feed instead of the static rate baked in at createDeposit time. Only applies to
 * currencies with a bundled oracle feed (USD's is a no-op 1:1 passthrough, so it's skipped).
 * Non-fatal on failure: the static conversionRate from createDeposit remains in effect as a fallback.
 */
async function attachAutomaticRateManagement(opts: {
  client: any;
  processorName: string;
  currency: string;
  depositId: string;
}) {
  const currency = opts.currency.toUpperCase();
  if (currency === "USD") return;
  try {
    const { getSpreadOracleConfig, resolveFiatCurrencyBytes32, resolvePaymentMethodHash } = await import("@zkp2p/sdk");
    const oracle = getSpreadOracleConfig(currency as any);
    if (!oracle) {
      console.warn(BEAM_LOG, `no bundled oracle feed for ${currency}, keeping static rate`);
      return;
    }
    const paymentMethodHash = resolvePaymentMethodHash(opts.processorName, { env: "production" });
    const currencyHash = resolveFiatCurrencyBytes32(currency);
    console.log(BEAM_LOG, `attaching ARM oracle for ${currency}/${opts.processorName}…`, { depositId: opts.depositId });
    await opts.client.setOracleRateConfig({
      depositId: opts.depositId,
      paymentMethodHash,
      currencyHash,
      config: { adapter: oracle.adapter, adapterConfig: oracle.adapterConfig, spreadBps: 0, maxStaleness: oracle.maxStaleness },
    });
    console.log(BEAM_LOG, `ARM oracle attached for ${currency}/${opts.processorName}`);
  } catch (err) {
    console.warn(BEAM_LOG, `ARM oracle attach failed, static rate remains in effect`, err);
  }
}

/**
 * Approves USDC (if needed) and creates a ZKP2P deposit for exactly the requested amount,
 * returning the resulting deposit id + tx hash. Mirrors the withdraw flow's Peer signing step.
 *
 * Caps the deposit at `amountUsdc` rather than the wallet's full balance — funding rails like
 * Coinbase Onramp convert from the buyer's local fiat currency, so the delivered USDC can come
 * in slightly above (or below) the requested amount. Any excess is left in the sender's wallet
 * instead of being sent on to the recipient.
 */
export async function createZkp2pDeposit(opts: {
  client: any;
  publicClient: any;
  addresses: any;
  abis: any;
  privySendTx: PrivySendTx;
  baseWalletAddress: string;
  processorName: string;
  identifier: string;
  currency: string;
  ratePercent: number;
  amountUsdc: number;
  /** Live USD->currency rate to apply (1 for USD). Must match the rate used to gross up amountUsdc. */
  fxRateFromUsd?: number;
}) {
  const { erc20Abi, encodeFunctionData, parseEventLogs } = await import("viem");
  const { base } = await import("viem/chains");

  const startedAt = Date.now();
  const elapsed = () => `${Date.now() - startedAt}ms`;

  const requestedAtomic = BigInt(Math.round(opts.amountUsdc * 1_000_000));
  console.log(BEAM_LOG, "balance check…", { wallet: opts.baseWalletAddress, requestedAtomic: requestedAtomic.toString() });
  const rawBalance = await opts.publicClient.readContract({
    address: BASE_USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [opts.baseWalletAddress as `0x${string}`],
  }) as bigint;
  console.log(BEAM_LOG, `balance check done (${elapsed()})`, { rawBalance: rawBalance.toString() });
  if (rawBalance < requestedAtomic) throw new Error("Your balance hasn't caught up with the full amount yet. Please wait and retry.");
  const atomicUsdc = requestedAtomic;

  const currentAllowance = await opts.publicClient.readContract({
    address: BASE_USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "allowance",
    args: [opts.baseWalletAddress as `0x${string}`, opts.addresses.escrow as `0x${string}`],
  }) as bigint;
  console.log(BEAM_LOG, `allowance check done (${elapsed()})`, { currentAllowance: currentAllowance.toString(), needed: atomicUsdc.toString() });

  if (currentAllowance < atomicUsdc) {
    console.log(BEAM_LOG, "approving USDC for escrow (sponsored tx)…");
    await opts.privySendTx({
      to: BASE_USDC_ADDRESS,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [opts.addresses.escrow as `0x${string}`, atomicUsdc] }),
      chainId: base.id,
    }, { sponsor: true });
    console.log(BEAM_LOG, `approve confirmed (${elapsed()})`);
  } else {
    console.log(BEAM_LOG, "allowance already sufficient, skipping approve");
  }

  // ZKP2P expects the raw username without display prefixes (@ for Revolut/Venmo, $ for Cash App)
  const zkp2pId = opts.identifier.trim().replace(/^[@$]/, "");
  const FIVE_USDC = 5_000_000n;
  const tenPercent = atomicUsdc / 10n;
  const minIntent = tenPercent > FIVE_USDC ? tenPercent : FIVE_USDC;

  console.log(BEAM_LOG, "signing createDeposit…", { processor: opts.processorName, identifier: zkp2pId, minIntent: minIntent.toString(), amount: atomicUsdc.toString() });
  const { hash: depositTxHash } = await opts.client.createDeposit({
    token: BASE_USDC_ADDRESS,
    amount: atomicUsdc,
    intentAmountRange: { min: minIntent, max: atomicUsdc },
    processorNames: [opts.processorName],
    payeeData: [{ offchainId: zkp2pId }],
    conversionRates: [[{ currency: opts.currency.toUpperCase(), conversionRate: zkp2pRate(opts.ratePercent, opts.fxRateFromUsd ?? 1) }]],
  });
  console.log(BEAM_LOG, `createDeposit tx sent (${elapsed()})`, { depositTxHash });

  const receipt = await opts.publicClient.waitForTransactionReceipt({ hash: depositTxHash as `0x${string}`, timeout: 90_000 });
  console.log(BEAM_LOG, `createDeposit tx mined (${elapsed()})`, { blockNumber: receipt.blockNumber?.toString(), logCount: receipt.logs?.length });
  let depositId: string | null = null;

  try {
    // Filter to the exact DepositReceived event — an unfiltered parseEventLogs() over the whole
    // ABI matches ANY escrow event carrying a depositId field (DepositWithdrawn, IntentSignaled,
    // DepositClosed, ...), and a bundled/sponsored tx receipt can contain other escrow events
    // that have nothing to do with this deposit. Grabbing the first depositId found was silently
    // recording the wrong deposit. Cross-check depositor + amount too, in case the receipt
    // contains more than one DepositReceived log.
    const parsed = parseEventLogs({ abi: opts.abis.escrow as any, eventName: "DepositReceived", logs: receipt.logs }) as any[];
    const walletLower = opts.baseWalletAddress.toLowerCase();
    const match =
      parsed.find((log) => log.args?.depositor?.toLowerCase() === walletLower && BigInt(log.args?.amount ?? 0) === atomicUsdc) ??
      parsed.find((log) => log.args?.depositor?.toLowerCase() === walletLower);
    if (match?.args?.depositId !== undefined) depositId = match.args.depositId.toString();
    console.log(BEAM_LOG, "depositId from event log", { matchedEvents: parsed.length, depositId });
  } catch (err) {
    console.warn(BEAM_LOG, "event log parsing failed, falling back to polling getAccountDeposits", err);
  }

  if (!depositId) {
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const deposits = await opts.client.getAccountDeposits(opts.baseWalletAddress as `0x${string}`) as any[];
        console.log(BEAM_LOG, `getAccountDeposits fallback attempt ${attempt + 1}/6`, { count: deposits?.length ?? 0 });
        if (Array.isArray(deposits) && deposits.length > 0) {
          // Prefer an exact amount match — "take the last item" assumes ordering the SDK
          // doesn't guarantee, which risks picking an older, unrelated deposit.
          const exact = deposits.find((d) => BigInt(d?.deposit?.depositAmount ?? d?.depositAmount ?? 0) === atomicUsdc);
          const chosen = exact ?? deposits.reduce((a, b) => (BigInt(b.depositId) > BigInt(a.depositId) ? b : a));
          depositId = chosen?.depositId?.toString() ?? null;
          if (depositId) break;
        }
      } catch (err) { console.warn(BEAM_LOG, `getAccountDeposits attempt ${attempt + 1} failed`, err); }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  console.log(BEAM_LOG, `deposit created (${elapsed()})`, { depositId, depositTxHash });

  if (depositId) {
    await attachAutomaticRateManagement({ client: opts.client, processorName: opts.processorName, currency: opts.currency, depositId });
  }

  return { depositId, depositTxHash: depositTxHash as string, amountAtomic: atomicUsdc };
}

/**
 * Withdraws a ZKP2P deposit back to the sender's own Base wallet. Only succeeds cleanly when
 * the deposit isn't locked (no peer has an outstanding intent against it) — callers should
 * check lock state via the backend's /beam/:id/lock-state first and not offer this otherwise.
 */
export async function withdrawZkp2pDeposit(opts: { client: any; zkp2pDepositId: string }) {
  return opts.client.withdrawDeposit({ depositId: BigInt(opts.zkp2pDepositId) });
}
