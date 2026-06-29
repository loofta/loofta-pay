import { type NextRequest, NextResponse } from "next/server";

const MAGICBLOCK_PAYMENTS_BASE = "https://payments.magicblock.app";

const DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const MAINNET_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const DELAYS = {
  devnet: { minDelayMs: "30000", maxDelayMs: "300000" },
  mainnet: { minDelayMs: "60000", maxDelayMs: "600000" },
};

export async function POST(req: NextRequest) {
  const { from, to, amountUsdc, cluster } = await req.json() as {
    from: string;
    to: string;
    amountUsdc: number;
    cluster: "devnet" | "mainnet";
  };

  if (!from || !to || !amountUsdc || !cluster) {
    return NextResponse.json({ error: "Missing required fields: from, to, amountUsdc, cluster" }, { status: 400 });
  }

  const mint = cluster === "mainnet" ? MAINNET_USDC_MINT : DEVNET_USDC_MINT;
  const amountBaseUnits = Math.round(amountUsdc * 1_000_000);
  const { minDelayMs, maxDelayMs } = DELAYS[cluster];
  const apiCluster = cluster === "mainnet" ? "mainnet" : "devnet-private";

  const body: Record<string, unknown> = {
    from,
    to,
    mint,
    amount: amountBaseUnits,
    visibility: "private",
    fromBalance: "base",
    toBalance: "base",
    cluster: apiCluster,
    initIfMissing: true,
    initAtasIfMissing: true,
    initVaultIfMissing: false,
    minDelayMs,
    maxDelayMs,
    ...(cluster === "mainnet" ? { gasless: true } : {}),
  };

  console.log('body', body);
  console.log(`[test-transfer/build] POST ${MAGICBLOCK_PAYMENTS_BASE}/v1/spl/transfer`, JSON.stringify(body));

  const res = await fetch(`${MAGICBLOCK_PAYMENTS_BASE}/v1/spl/transfer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok || data.success === false) {
    const msg = data.error?.message ?? data.message ?? JSON.stringify(data);
    return NextResponse.json({ error: `MagicBlock error: ${msg}` }, { status: res.status });
  }

  return NextResponse.json(data);
}
