export type PlayApp = { id: string; name: string; logo: string };

export type PlayWorld = {
  id: string;
  flag: string;
  name: string;
  currency: string;
  symbol: string;
  /** Apps that pay out here. Empty means local bank or wallet payout through the currency itself. */
  apps: PlayApp[];
  sky: [string, string];
  ground: string;
  accent: string;
  /** Music track under /play/audio, one per country style. */
  music: string;
};

const A = {
  venmo: { id: "venmo", name: "Venmo", logo: "/images/platforms/venmo.png" },
  cashapp: { id: "cashapp", name: "Cash App", logo: "/images/platforms/cashapp.webp" },
  chime: { id: "chime", name: "Chime", logo: "/images/platforms/chime.png" },
  revolut: { id: "revolut", name: "Revolut", logo: "/images/platforms/revolut.png" },
  zelle: { id: "zelle", name: "Zelle", logo: "/images/platforms/zelle.png" },
  xmoney: { id: "xmoney", name: "X Money", logo: "/images/platforms/xmoney.jpg" },
  monzo: { id: "monzo", name: "Monzo", logo: "/images/platforms/monzo.svg" },
  upi: { id: "upi", name: "UPI", logo: "/images/platforms/upi.svg" },
  paj: { id: "paj", name: "PAJ Cash", logo: "/images/icons/paj-cash-logo.svg" },
} satisfies Record<string, PlayApp>;

/** Every currency Loofta cashes out to, grouped into one world per country. Revolut countries are the app's biggest markets. */
const RAW_WORLDS: Omit<PlayWorld, "music">[] = [
  { id: "us", flag: "🇺🇸", name: "United States", currency: "USD", symbol: "$", apps: [A.venmo, A.cashapp, A.chime, A.revolut, A.zelle, A.xmoney], sky: ["#2a4fd6", "#ffb48a"], ground: "#3a3d52", accent: "#e63946" },
  { id: "gb", flag: "🇬🇧", name: "United Kingdom", currency: "GBP", symbol: "£", apps: [A.monzo, A.revolut], sky: ["#5d6b82", "#c9d1de"], ground: "#4a4e5c", accent: "#d62839" },
  { id: "fr", flag: "🇫🇷", name: "France", currency: "EUR", symbol: "€", apps: [A.revolut], sky: ["#3b5bdb", "#f4d6e4"], ground: "#4b4f66", accent: "#3b5bdb" },
  { id: "es", flag: "🇪🇸", name: "Spain", currency: "EUR", symbol: "€", apps: [A.revolut], sky: ["#d9480f", "#ffd43b"], ground: "#8a4b2a", accent: "#e03131" },
  { id: "de", flag: "🇩🇪", name: "Germany", currency: "EUR", symbol: "€", apps: [A.revolut], sky: ["#212529", "#fab005"], ground: "#343a40", accent: "#fab005" },
  { id: "ie", flag: "🇮🇪", name: "Ireland", currency: "EUR", symbol: "€", apps: [A.revolut], sky: ["#0b7a43", "#b2f2bb"], ground: "#2b8a3e", accent: "#ff922b" },
  { id: "pl", flag: "🇵🇱", name: "Poland", currency: "PLN", symbol: "zł", apps: [A.revolut], sky: ["#c92a2a", "#fff5f5"], ground: "#5c3a3a", accent: "#c92a2a" },
  { id: "ro", flag: "🇷🇴", name: "Romania", currency: "RON", symbol: "lei", apps: [A.revolut], sky: ["#1c3faa", "#ffe066"], ground: "#4a3f1c", accent: "#fcc419" },
  { id: "ng", flag: "🇳🇬", name: "Nigeria", currency: "NGN", symbol: "₦", apps: [A.paj], sky: ["#0b6b4b", "#ffe9a8"], ground: "#6b4a2b", accent: "#15a05a" },
  { id: "in", flag: "🇮🇳", name: "India", currency: "INR", symbol: "₹", apps: [A.upi], sky: ["#7b2d8e", "#ffb347"], ground: "#a9743a", accent: "#ff8a1f" },
  { id: "mx", flag: "🇲🇽", name: "Mexico", currency: "MXN", symbol: "$", apps: [], sky: ["#0b8a5b", "#ffd6a5"], ground: "#7a3b2e", accent: "#e8590c" },
  { id: "ar", flag: "🇦🇷", name: "Argentina", currency: "ARS", symbol: "$", apps: [], sky: ["#4dabf7", "#f1f3f5"], ground: "#5a6b7a", accent: "#fcc419" },
  { id: "co", flag: "🇨🇴", name: "Colombia", currency: "COP", symbol: "$", apps: [], sky: ["#f59f00", "#74c0fc"], ground: "#4a5d3a", accent: "#1c7ed6" },
  { id: "cl", flag: "🇨🇱", name: "Chile", currency: "CLP", symbol: "$", apps: [], sky: ["#364fc7", "#ffc9c9"], ground: "#5f4b3a", accent: "#e03131" },
  { id: "ke", flag: "🇰🇪", name: "Kenya", currency: "KES", symbol: "KSh", apps: [], sky: ["#e8590c", "#ffec99"], ground: "#6b4a2b", accent: "#2b8a3e" },
  { id: "ph", flag: "🇵🇭", name: "Philippines", currency: "PHP", symbol: "₱", apps: [], sky: ["#1864ab", "#ffe066"], ground: "#3b6b8a", accent: "#fcc419" },
  { id: "id", flag: "🇮🇩", name: "Indonesia", currency: "IDR", symbol: "Rp", apps: [], sky: ["#c92a2a", "#ffd8a8"], ground: "#5a3a2a", accent: "#fa5252" },
  { id: "ae", flag: "🇦🇪", name: "United Arab Emirates", currency: "AED", symbol: "AED", apps: [], sky: ["#0c8599", "#f8f0d8"], ground: "#c9a86a", accent: "#2f9e44" },
  { id: "cm", flag: "🇨🇲", name: "Central Africa", currency: "XAF", symbol: "FCFA", apps: [], sky: ["#2b8a3e", "#ffe066"], ground: "#6b4a2b", accent: "#e03131" },
];

const WORLD_MUSIC: Record<string, string> = { gb: "uk", pl: "eu", ro: "eu", cm: "ng" };

export const PLAY_WORLDS: PlayWorld[] = RAW_WORLDS.map((w) => ({ ...w, music: WORLD_MUSIC[w.id] ?? w.id }));

export const PLAY_CURRENCIES = Array.from(new Set(PLAY_WORLDS.map((w) => w.currency)));

/** Rough fallback so the game still shows a number if the live feed is down. */
export const FALLBACK_RATES: Record<string, number> = {
  USD: 1, EUR: 0.92, GBP: 0.79, PLN: 3.9, RON: 4.6, NGN: 1500, INR: 84, MXN: 18, ARS: 1000, COP: 4100, CLP: 950, KES: 129, PHP: 58, IDR: 15800, AED: 3.67, XAF: 600,
};

export function formatMoney(amount: number, currency: string, symbol: string): string {
  const text = amount.toLocaleString("en-US", { maximumFractionDigits: amount >= 1000 ? 0 : 2, minimumFractionDigits: amount >= 1000 ? 0 : 2 });
  return symbol.length > 1 ? `${text} ${symbol}` : `${symbol}${text}`;
}
