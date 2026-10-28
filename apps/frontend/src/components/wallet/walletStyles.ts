import type { CSSProperties } from "react";

/** One field look for every input in the wallet modals: same height, radius, padding and text size. */
export const FIELD_BOX: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  minHeight: 56,
  padding: "0 12px 0 16px",
  borderRadius: 16,
  background: "#1A1A20",
  border: "1px solid rgba(255,255,255,0.06)",
};

export const FIELD_INPUT: CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: 54,
  background: "transparent",
  border: 0,
  outline: "none",
  color: "#F2EFE8",
  fontSize: 16,
};

export const FIELD_PILL: CSSProperties = {
  cursor: "pointer",
  flex: "none",
  height: 36,
  padding: "0 14px",
  borderRadius: 999,
  border: 0,
  background: "#2A2A33",
  color: "#F2EFE8",
  fontWeight: 700,
  fontSize: 15,
};

export const BTN_PRIMARY: CSSProperties = {
  cursor: "pointer",
  flex: 1,
  height: 56,
  borderRadius: 16,
  border: 0,
  background: "linear-gradient(90deg,#FF2D0A,#F5B70C)",
  color: "#fff",
  fontFamily: "var(--font-home-sora), Sora, sans-serif",
  fontWeight: 600,
  fontSize: 16,
};

export const BTN_SECONDARY: CSSProperties = {
  cursor: "pointer",
  flex: 1,
  height: 56,
  borderRadius: 16,
  border: 0,
  background: "#1A1A20",
  color: "#F2EFE8",
  fontWeight: 700,
  fontSize: 16,
};

/** Short address like `5dCT...BKuq` (Solana) or `0x0cd0...005e` (EVM). */
export function shortAddress(address: string): string {
  const head = address.startsWith("0x") ? 6 : 4;
  return address.length > head + 8 ? `${address.slice(0, head)}...${address.slice(-4)}` : address;
}
