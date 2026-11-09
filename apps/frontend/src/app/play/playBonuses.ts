/** One power-up per payout app. It floats in the countries where the app works, jump up to hit it. */
export type BonusDef = {
  name: string;
  desc: string;
  color: string;
  /** Frames the effect lasts, 0 for one-off effects. */
  frames: number;
};

export const BONUSES: Record<string, BonusDef> = {
  venmo: { name: "Venmo Splash", desc: "Coins count double", color: "#3d95ce", frames: 360 },
  cashapp: { name: "Cash Rain", desc: "A shower of coins", color: "#00d64f", frames: 0 },
  chime: { name: "Chime Magnet", desc: "Coins fly to you", color: "#1ec677", frames: 420 },
  revolut: { name: "Revolut Rocket", desc: "Smash straight through fees", color: "#0075eb", frames: 240 },
  zelle: { name: "Zelle Zap", desc: "Zaps every fee ahead", color: "#a55eea", frames: 0 },
  xmoney: { name: "X Drop", desc: "10 coins and triple coins", color: "#e7e9ea", frames: 300 },
  monzo: { name: "Monzo Pot", desc: "5 coins and a shield", color: "#ff4f40", frames: 0 },
  upi: { name: "UPI Instant", desc: "Instant pay grabs every coin ahead", color: "#f26b21", frames: 0 },
  paj: { name: "Naira Rain", desc: "Shower of coins, double coins", color: "#15a05a", frames: 240 },
};
