import { NextResponse } from "next/server";
import { ONECLICK_BASE, oneClickHeaders } from "../_base";

export const dynamic = "force-dynamic";

const ASSET = /^[\w:.\-]{3,160}$/;
const ADDR = /^[\w.:\-]{3,128}$/;

/**
 * One deposit address for moving an asset between chains. The client picks the two assets, the
 * amount (atomic units) and the addresses. The Loofta fee, referral code and API token are added
 * here, never trusted from the browser.
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const str = (k: string) => (typeof b?.[k] === "string" ? (b[k] as string) : "");
  const originAsset = str("originAsset");
  const destinationAsset = str("destinationAsset");
  const amount = str("amount");
  const recipient = str("recipient");
  const refundTo = str("refundTo");
  const dry = b?.dry === true;
  if (!ASSET.test(originAsset) || !ASSET.test(destinationAsset) || !/^\d{1,40}$/.test(amount) || amount === "0" || !ADDR.test(recipient) || !ADDR.test(refundTo)) {
    return NextResponse.json({ message: "Invalid request" }, { status: 400 });
  }
  const feeBps = Number(process.env.NEXT_PUBLIC_APP_FEE_BPS);
  const feeTo = process.env.NEXT_PUBLIC_APP_FEE_RECIPIENT;
  const body: Record<string, unknown> = {
    dry,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset,
    destinationAsset,
    amount,
    depositType: "ORIGIN_CHAIN",
    refundTo,
    refundType: "ORIGIN_CHAIN",
    recipient,
    recipientType: "DESTINATION_CHAIN",
    deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
    quoteWaitingTimeMs: 3000,
  };
  if (feeTo && Number.isFinite(feeBps) && feeBps >= 0 && feeBps <= 1000) body.appFees = [{ recipient: feeTo, fee: feeBps }];
  if (process.env.NEXT_PUBLIC_REFERRAL_CODE) body.referral = process.env.NEXT_PUBLIC_REFERRAL_CODE;
  try {
    const res = await fetch(`${ONECLICK_BASE}/v0/quote`, { method: "POST", headers: oneClickHeaders(true), body: JSON.stringify(body), signal: AbortSignal.timeout(15_000), cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return NextResponse.json({ message: (json as { message?: string }).message || "Could not get a quote" }, { status: res.status >= 400 && res.status < 600 ? res.status : 502 });
    return NextResponse.json(json);
  } catch {
    return NextResponse.json({ message: "Quote service is not responding" }, { status: 502 });
  }
}
