// Real, sourced market-moving events (verified against CNBC/Reuters/Bloomberg reporting — not
// fabricated) — shared between the Event Ledger section and NestHero's default demo eggs, so the
// splash page's hero and its "receipts" show the same real data, not two disconnected sets.
// Exactly 4 (matches the .ns-grid4 layout — a 5th event used to wrap alone onto its own row).
// `action` states what the rebalance would actually do in response — the section is titled
// "Rebalanced on real headlines," so the cards need to show the rebalancing, not just the price
// move that triggered it.
export interface MarketEvent {
  outlet: "CNBC" | "Reuters" | "Bloomberg";
  domain: string;
  date: string;
  move: string;
  movePct: number;
  up: boolean;
  co: string;
  ticker: string; // xStock symbol
  domainCo: string; // company domain, for the egg/label favicon
  cat: string;
  action: string;
}

export const MARKET_EVENTS: MarketEvent[] = [
  {
    outlet: "CNBC",
    domain: "cnbc.com",
    date: "Aug 19",
    move: "+61%",
    movePct: 61,
    up: true,
    co: "Moderna",
    ticker: "MRNAx",
    domainCo: "modernatx.com",
    cat: "Positive late-stage cancer-vaccine results with Merck.",
    action: "Increased weight — mention spike flagged before the move",
  },
  {
    outlet: "Reuters",
    domain: "reuters.com",
    date: "Jun 1",
    move: "+36%",
    movePct: 36,
    up: true,
    co: "Hewlett Packard Enterprise",
    ticker: "HPEx",
    domainCo: "hpe.com",
    cat: "Strong AI-driven revenue and sharply higher growth guidance.",
    action: "Increased weight — guidance beat picked up early",
  },
  {
    outlet: "CNBC",
    domain: "cnbc.com",
    date: "Jul 29",
    move: "+15%",
    movePct: 15,
    up: true,
    co: "Microsoft",
    ticker: "MSFTx",
    domainCo: "microsoft.com",
    cat: "Revenue and Azure growth exceeded expectations.",
    action: "Increased weight — Azure momentum flagged",
  },
  {
    outlet: "Reuters",
    domain: "reuters.com",
    date: "Jan 27",
    move: "−20%",
    movePct: -20,
    up: false,
    co: "UnitedHealth",
    ticker: "UNHx",
    domainCo: "unitedhealthgroup.com",
    cat: "Weak Medicare Advantage reimbursement proposal.",
    action: "Reduced weight — negative guidance flagged, exposure cut",
  },
];

export const PRESS = [
  ["Reuters", "reuters.com"],
  ["CNBC", "cnbc.com"],
  ["Bloomberg", "bloomberg.com"],
] as const;

export const fav = (domain: string) => `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
