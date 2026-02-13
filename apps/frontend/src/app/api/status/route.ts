import { NextResponse } from "next/server";
import { getExecutionStatus } from "@/services/nearIntents";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const depositAddress = (searchParams.get("depositAddress") || "").trim();
  if (!depositAddress) {
    return NextResponse.json({ error: "Missing depositAddress" }, { status: 400 });
  }
  try {
    const raw = await getExecutionStatus(depositAddress);
    console.log('logo status', raw);
    const s =
      raw?.status ||
      raw?.executionStatus ||
      raw?.state ||
      "UNKNOWN";
    const sd = raw?.swapDetails || raw || {};
    let statusStr = String(s);
    const swapDetails = {
      amountIn: sd?.amountIn ?? null,
      amountInFormatted: sd?.amountInFormatted ?? null,
      amountInUsd: sd?.amountInUsd ?? null,
      amountOut: sd?.amountOut ?? null,
      amountOutFormatted: sd?.amountOutFormatted ?? null,
      amountOutUsd: sd?.amountOutUsd ?? null,
      depositedAmount: sd?.depositedAmount ?? null,
      depositedAmountFormatted: sd?.depositedAmountFormatted ?? null,
      depositedAmountUsd: sd?.depositedAmountUsd ?? null,
      destinationChainTxHashes: Array.isArray(sd?.destinationChainTxHashes)
        ? sd.destinationChainTxHashes
        : [],
      intentHashes: Array.isArray(sd?.intentHashes) ? sd.intentHashes : [],
      nearTxHashes: Array.isArray(sd?.nearTxHashes) ? sd.nearTxHashes : [],
      originChainTxHashes: Array.isArray(sd?.originChainTxHashes)
        ? sd.originChainTxHashes
        : [],
      refundedAmount: sd?.refundedAmount ?? "0",
      refundedAmountFormatted: sd?.refundedAmountFormatted ?? "0",
      refundedAmountUsd: sd?.refundedAmountUsd ?? "0",
      slippage: sd?.slippage ?? null,
    };
    // Provider returns INCOMPLETE_DEPOSIT when expected amount (amountInFormatted) is null
    // but we have a deposit (depositedAmountFormatted). Treat as PROCESSING so the user sees progress.
    if (
      statusStr.toUpperCase() === "INCOMPLETE_DEPOSIT" &&
      swapDetails.depositedAmountFormatted &&
      Number(swapDetails.depositedAmountFormatted) > 0 &&
      (swapDetails.amountInFormatted == null || swapDetails.amountInFormatted === "")
    ) {
      statusStr = "PROCESSING";
    }
    const out = {
      status: statusStr,
      updatedAt:
        (raw?.updatedAt as string) ||
        (sd?.updatedAt as string) ||
        new Date().toISOString(),
      originAsset: raw?.quoteResponse?.quoteRequest?.originAsset || null,
      destinationAsset: raw?.quoteResponse?.quoteRequest?.destinationAsset || null,
      swapDetails,
    };
    return NextResponse.json(out, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to fetch status" },
      { status: 500 }
    );
  }
}

