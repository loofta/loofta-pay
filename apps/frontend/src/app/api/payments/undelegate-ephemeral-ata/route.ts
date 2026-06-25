import { type NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";

const MAGICBLOCK_API = "https://payments.magicblock.app";
const USDC_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

type MagicblockCluster = "mainnet-private" | "devnet-private";

function resolveCluster(raw?: string): MagicblockCluster {
  if (raw === "devnet" || raw === "devnet-private") return "devnet-private";
  return "mainnet-private";
}

export async function POST(request: NextRequest) {
  try {
    const { payer, mint = USDC_MAINNET, cluster: clusterRaw } = await request.json() as {
      payer?: string;
      mint?: string;
      cluster?: string;
    };
    const authorization = request.headers.get("authorization")?.trim() ?? "";

    if (typeof payer !== "string") {
      return NextResponse.json({ error: "Missing payer" }, { status: 400 });
    }
    try { new PublicKey(payer); new PublicKey(mint); } catch {
      return NextResponse.json({ error: "Invalid payer or mint public key" }, { status: 400 });
    }

    const cluster = resolveCluster(clusterRaw);

    const res = await fetch(`${MAGICBLOCK_API}/v1/spl/undelegate-ephemeral-ata`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body: JSON.stringify({ payer, mint, cluster }),
      signal: AbortSignal.timeout(15_000),
    });

    const body = await res.json().catch(() => null);
    if (!res.ok) {
      return NextResponse.json(
        { error: body?.error?.message ?? body?.message ?? `Undelegate failed: ${res.status}`, details: body },
        { status: res.status },
      );
    }
    return NextResponse.json(body);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to build undelegate transaction" },
      { status: 500 },
    );
  }
}
