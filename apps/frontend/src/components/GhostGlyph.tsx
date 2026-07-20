const GHOST_PATH =
  "M12 2C7.58 2 4 5.58 4 10v9.5c0 .5.5.8.9.5l1.6-1.2c.3-.2.7-.2 1 0l1.5 1.1c.3.2.7.2 1 0l1.5-1.1c.3-.2.7-.2 1 0l1.5 1.1c.3.2.7.2 1 0l1.6-1.2c.4-.3.9 0 .9.5V10c0-4.42-3.58-8-8-8z";

/** Loofta's private-payment glyph — used anywhere a payment's privacy needs a visual tell
 *  (claim page, history rows, confetti bursts) instead of a generic lock icon. */
export function GhostGlyph({ size, opacity }: { size: number; opacity: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ opacity }} className="drop-shadow-[0_4px_14px_rgba(217,119,6,0.6)]">
      <path d={GHOST_PATH} fill="#fef3c7" />
      <ellipse cx="9" cy="10.2" rx="1.1" ry="1.5" fill="#78350f" />
      <ellipse cx="15" cy="10.2" rx="1.1" ry="1.5" fill="#78350f" />
    </svg>
  );
}
