import { NextRequest, NextResponse } from "next/server";

/** MoonPay's card total for a USDC amount that must arrive on Solana. The key stays server-side. */
export async function GET(request: NextRequest) {
  const usdc = Number(request.nextUrl.searchParams.get("usdc"));
  const key = process.env.MOONPAY_API_KEY || process.env.NEXT_PUBLIC_MOONPAY_API_KEY;
  if (!key || !(usdc > 0)) return NextResponse.json({ total: null, fee: null });

  const url = new URL("https://api.moonpay.com/v3/currencies/usdc_sol/buy_quote");
  url.searchParams.set("apiKey", key);
  url.searchParams.set("quoteCurrencyAmount", String(usdc));
  url.searchParams.set("baseCurrencyCode", "usd");
  const res = await fetch(url, { cache: "no-store" }).catch(() => null);
  if (!res?.ok) return NextResponse.json({ total: null, fee: null });
  const body = await res.json().catch(() => null) as { totalAmount?: number; feeAmount?: number; extraFeeAmount?: number; networkFeeAmount?: number } | null;
  const total = typeof body?.totalAmount === "number" ? body.totalAmount : null;
  const fee = total != null ? Math.max(0, total - usdc) : null;
  return NextResponse.json({ total, fee });
}
