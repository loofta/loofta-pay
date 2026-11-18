import type { ReactNode } from "react";

/**
 * Loofta's own icon set. Two layers on a 24px grid: a soft filled shape (the "body") and a round
 * stroked outline on top, both in currentColor, so every icon picks up the colour of its tile.
 */
type P = { size?: number; className?: string };

function Svg({ size = 24, className, children }: P & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" stroke="currentColor">
      {children}
    </svg>
  );
}

const SOFT = { fill: "currentColor", fillOpacity: 0.22, stroke: "none" } as const;

export const HomeIcon = (p: P) => (
  <Svg {...p}>
    <path {...SOFT} d="M4 11.2 12 4l8 7.2V19a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
    <path d="M3.5 11.5 12 3.8l8.5 7.7" />
    <path d="M5.5 10v9a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5v-9" />
    <path d="M10 20.5v-4.8a2 2 0 0 1 4 0v4.8" />
  </Svg>
);

/** A flame: what is hot right now. */
export const TrendingIcon = (p: P) => (
  <Svg {...p}>
    <path {...SOFT} d="M12 2.8c.4 3.2-1.4 4.6-3 6.4-1.5 1.7-2.5 3.2-2.5 5.4 0 3.6 2.5 6.4 5.5 6.4s5.5-2.8 5.5-6.4c0-2-.8-3.5-1.9-4.9-.4 1.3-1.1 2.1-2 2.5.5-3-.3-6.6-1.6-9.4z" />
    <path d="M12 2.8c.4 3.2-1.4 4.6-3 6.4-1.5 1.7-2.5 3.2-2.5 5.4 0 3.6 2.5 6.4 5.5 6.4s5.5-2.8 5.5-6.4c0-2-.8-3.5-1.9-4.9-.4 1.3-1.1 2.1-2 2.5.5-3-.3-6.6-1.6-9.4z" />
    <path d="M12 20.8c-1.5 0-2.6-1.1-2.6-2.6 0-1.4 1-2.2 1.7-3.2.4.8 1 1.2 1.6 1.4.5-.6.6-1.2.6-1.8 1 1 1.4 2 1.4 3.6 0 1.5-1.2 2.6-2.7 2.6z" />
  </Svg>
);

/** A rocket: new launches. */
export const RocketIcon = (p: P) => (
  <Svg {...p}>
    <path {...SOFT} d="M12 2.5c3.2 2 5 5.2 5 9v3.2l-2 1.8H9l-2-1.8v-3.2c0-3.8 1.8-7 5-9z" />
    <path d="M12 2.5c3.2 2 5 5.2 5 9v3.2l-2 1.8H9l-2-1.8v-3.2c0-3.8 1.8-7 5-9z" />
    <circle cx="12" cy="10" r="1.9" />
    <path d="M7 13.2 4.6 15.8V19L8 17.4M17 13.2l2.4 2.6V19L16 17.4" />
    <path d="M10.4 19.2c0 1.2.6 2 1.6 2.9 1-.9 1.6-1.7 1.6-2.9" />
  </Svg>
);

/** A vault: money that earns while it sits. */
export const VaultIcon = (p: P) => (
  <Svg {...p}>
    <rect {...SOFT} x="3" y="4" width="18" height="15" rx="3.5" />
    <rect x="3" y="4" width="18" height="15" rx="3.5" />
    <circle cx="12" cy="11.5" r="3.6" />
    <path d="M12 8v1.4M12 13.6V15M8.4 11.5h1.4M14.2 11.5h1.4" />
    <path d="M7 19v2M17 19v2" />
  </Svg>
);

export const WalletIcon = (p: P) => (
  <Svg {...p}>
    <path {...SOFT} d="M3.5 8.5A2.5 2.5 0 0 1 6 6h11.5a2 2 0 0 1 2 2v1H6a2.5 2.5 0 0 1-2.5-2.5V8.5zM3.5 8.5V17A2.5 2.5 0 0 0 6 19.5h12.5a1.5 1.5 0 0 0 1.5-1.5V10.5a1.5 1.5 0 0 0-1.5-1.5H6A2.5 2.5 0 0 1 3.5 6.5" />
    <path d="M3.5 6.5v10.5A2.5 2.5 0 0 0 6 19.5h12.5a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5H6A2.5 2.5 0 0 1 3.5 6.5 2.5 2.5 0 0 1 6 4h10" />
    <circle cx="16.2" cy="14.2" r="1.2" fill="currentColor" stroke="none" />
  </Svg>
);

/** A paper plane: send. */
export const SendIcon = (p: P) => (
  <Svg {...p}>
    <path {...SOFT} d="M21 3 3 10.2l7.5 3.3L13.8 21z" />
    <path d="M21 3 3 10.2l7.5 3.3L13.8 21z" />
    <path d="M21 3 10.5 13.5" />
  </Svg>
);

/** An arrow into a tray: receive. */
export const ReceiveIcon = (p: P) => (
  <Svg {...p}>
    <path {...SOFT} d="M4 16.5V18a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-1.5z" />
    <path d="M12 3.5v11M7.5 10.2l4.5 4.5 4.5-4.5" />
    <path d="M4 16.5V18a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-1.5" />
  </Svg>
);

/** Candles: stocks and charts. */
export const CandlesIcon = (p: P) => (
  <Svg {...p}>
    <rect {...SOFT} x="4" y="9" width="4" height="7" rx="1" />
    <rect {...SOFT} x="10" y="5" width="4" height="9" rx="1" />
    <rect {...SOFT} x="16" y="10" width="4" height="8" rx="1" />
    <path d="M6 5.5V9M6 16v3M12 2.5V5M12 14v4M18 6.5V10M18 18v2.5" />
    <rect x="4" y="9" width="4" height="7" rx="1" />
    <rect x="10" y="5" width="4" height="9" rx="1" />
    <rect x="16" y="10" width="4" height="8" rx="1" />
  </Svg>
);

/** A coin: tokens. */
export const CoinIcon = (p: P) => (
  <Svg {...p}>
    <circle {...SOFT} cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5.6" />
    <path d="M12 9v6M10.2 10.4c.4-.6 1-.9 1.8-.9 1 0 1.8.5 1.8 1.2 0 1.7-3.6.9-3.6 2.6 0 .7.8 1.2 1.8 1.2.8 0 1.4-.3 1.8-.9" strokeWidth={1.4} />
  </Svg>
);

/** A plus inside a tile: add money. */
export const AddCashIcon = (p: P) => (
  <Svg {...p}>
    <circle {...SOFT} cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v9M7.5 12h9" />
  </Svg>
);
