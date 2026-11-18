import type { MemecoinItem, StageKey } from "@/trade/lib/memecoin";

/** One set of rules. Each stage (new, almost, graduated) has its own, because a brand new coin cannot have 100 holders yet. */
export interface StageRules {
  minHolders: number;
  minVolumeUsd: number;
  requireSocial: boolean;
  /** Share of supply grabbed by bundled wallets in the launch block. */
  maxBundlePct: number;
  /** Share of supply the creator still holds. */
  maxDevPct: number;
  /** Wallets already up $1,000+ on this coin. */
  minProTraders: number;
}

export interface MemeFilterSettings {
  on: boolean;
  rules: Record<StageKey, StageRules>;
}

const R = (minHolders: number, minVolumeUsd: number, requireSocial: boolean, maxBundlePct: number, maxDevPct: number, minProTraders: number): StageRules => ({
  minHolders, minVolumeUsd, requireSocial, maxBundlePct, maxDevPct, minProTraders,
});

/**
 * Presets. Every preset needs a minimum number of holders, because a coin nobody owns yet is not
 * worth showing. A number we cannot measure never passes a rule that needs it for holders, but
 * bundles and creator share only hide a coin when they are measured and too high.
 *  - Light: hides coins flagged as rugs and the worst insiders.
 *  - Balanced (default): real holders, no heavy insiders.
 *  - Strict: the safest option. A social link is required at every stage, small insider shares,
 *    many holders and real volume. Expect to see few coins.
 */
export const PRESETS: Record<"relaxed" | "balanced" | "strict", { label: string; hint: string; rules: Record<StageKey, StageRules> }> = {
  relaxed: {
    label: "Light",
    hint: "Hides rugs and the worst insiders",
    rules: { new: R(2, 0, false, 50, 30, 0), final: R(10, 0, false, 50, 30, 0), grad: R(25, 0, false, 50, 30, 0) },
  },
  balanced: {
    label: "Balanced",
    hint: "Real holders, no heavy insiders",
    rules: { new: R(5, 0, false, 25, 10, 0), final: R(30, 1_000, false, 25, 10, 0), grad: R(75, 2_500, false, 25, 10, 0) },
  },
  strict: {
    label: "Strict",
    hint: "Safest: needs a social link, small insiders, many holders",
    rules: { new: R(20, 1_000, true, 10, 5, 0), final: R(100, 5_000, true, 10, 5, 1), grad: R(250, 10_000, true, 10, 5, 2) },
  },
};

export const DEFAULT_RULES: Record<StageKey, StageRules> = PRESETS.balanced.rules;

export const DEFAULT_SETTINGS: MemeFilterSettings = { on: false, rules: DEFAULT_RULES };

const KEY = "loofta.memepad.filters.v4";

export function loadSettings(): MemeFilterSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<MemeFilterSettings> | null;
    if (!raw) return DEFAULT_SETTINGS;
    return {
      on: raw.on ?? false,
      rules: {
        new: { ...DEFAULT_RULES.new, ...raw.rules?.new },
        final: { ...DEFAULT_RULES.final, ...raw.rules?.final },
        grad: { ...DEFAULT_RULES.grad, ...raw.rules?.grad },
      },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: MemeFilterSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode or blocked storage, settings just will not persist */
  }
}

/**
 * True when the coin passes every rule for its stage. A number we cannot measure yet (null) does
 * not hide the coin, because brand new coins have no data at all. Only a measured bad number does.
 */
export function passes(i: MemecoinItem, r: StageRules, holdersAvailable = true): boolean {
  if (i.risk === "high") return false;
  // Holders must be known and high enough. A coin we cannot count yet is not shown yet. When the feed has no holder
  // counts at all (free data mode), the rule cannot apply, or every coin would be hidden.
  if (holdersAvailable && r.minHolders > 0 && (i.holders == null || i.holders < r.minHolders)) return false;
  if (r.minVolumeUsd > 0 && i.volume24hUsd != null && i.volume24hUsd < r.minVolumeUsd) return false;
  if (r.requireSocial && !(i.website || i.twitter || i.telegram)) return false;
  if (i.bundlerPct != null && i.bundlerPct > r.maxBundlePct) return false;
  if (i.devPct != null && i.devPct > r.maxDevPct) return false;
  if (r.minProTraders > 0 && i.proTraders != null && i.proTraders < r.minProTraders) return false;
  return true;
}

export function needsPro(s: MemeFilterSettings): boolean {
  return s.on && Object.values(s.rules).some((r) => r.minProTraders > 0);
}
