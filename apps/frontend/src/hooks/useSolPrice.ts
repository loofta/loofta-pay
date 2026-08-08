import { useQuery } from "@tanstack/react-query";

/**
 * Live SOL/USD price via Alchemy. Same source/fallback as megapot's local useSolPrice
 * (apps/frontend/src/app/app/megapot/page.tsx) — kept as a separate copy here rather than a
 * shared import so this fee-estimate code doesn't pull in or get affected by megapot's module.
 */
export function useSolPrice(): number {
  return useSolPriceOrNull() ?? 150;
}

/**
 * Same live price, but `null` when it genuinely isn't available (still loading, request failed,
 * or a nonsense value came back) instead of silently substituting a default. Use this where the
 * caller needs to *know* the price is unknown — e.g. to fall back to a flat quoted fee rather
 * than derive a number from a made-up price.
 */
export function useSolPriceOrNull(): number | null {
  const { data } = useQuery({
    queryKey: ["sol-price"],
    queryFn: async (): Promise<number> => {
      const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "";
      const apiKey = rpcUrl.split("/").pop() ?? "";
      const r = await fetch(`https://api.g.alchemy.com/prices/v1/${apiKey}/tokens/by-symbol?symbols=SOL`);
      const json = await r.json();
      return parseFloat(json?.data?.[0]?.prices?.find((p: { currency: string }) => p.currency === "usd")?.value ?? "0");
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  return data && data > 0 ? data : null;
}
