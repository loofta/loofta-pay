import { NextResponse } from "next/server";
import { FALLBACK_RATES, PLAY_CURRENCIES } from "@/app/play/playWorlds";

export const revalidate = 600;

/** Public market rates (USD base) for the /play game and converter. Reference only. */
export async function GET() {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", { next: { revalidate: 600 } });
    if (!res.ok) throw new Error(`rates ${res.status}`);
    const json = (await res.json()) as { rates?: Record<string, number> };
    const rates: Record<string, number> = { USD: 1 };
    for (const c of PLAY_CURRENCIES) {
      const v = json.rates?.[c];
      if (typeof v === "number" && v > 0) rates[c] = v;
    }
    const complete = PLAY_CURRENCIES.every((c) => rates[c] != null);
    return NextResponse.json({ rates: complete ? rates : { ...FALLBACK_RATES, ...rates }, live: complete });
  } catch {
    return NextResponse.json({ rates: FALLBACK_RATES, live: false });
  }
}
