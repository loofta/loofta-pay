import posthog from "posthog-js";

type Props = Record<string, string | number | boolean | null | undefined>;

/** Bucket a USD amount so funnels can break down by size without storing exact values. */
export function usdBucket(amount: number | null | undefined): string | undefined {
  if (amount == null || !Number.isFinite(amount)) return undefined;
  if (amount < 5) return "<5";
  if (amount < 20) return "5-20";
  if (amount < 100) return "20-100";
  if (amount < 500) return "100-500";
  return "500+";
}

/** Safe PostHog capture: no-ops on the server, when unconfigured, or if PostHog throws. */
export function track(event: string, props?: Props): void {
  if (typeof window === "undefined") return;
  if (!process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN || !process.env.NEXT_PUBLIC_POSTHOG_HOST) return;
  try {
    posthog.capture(event, props);
  } catch {
    /* analytics must never break the app */
  }
}

const seen = new Set<string>();
/** Capture once per key for the lifetime of the page (status polling can report the same outcome repeatedly). */
export function trackOnce(key: string, event: string, props?: Props): void {
  if (seen.has(key)) return;
  seen.add(key);
  track(event, props);
}
