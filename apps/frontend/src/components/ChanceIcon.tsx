/** The 3D gold ticket tile (same look as the "Buy a Megapot ticket" card on the dashboard). */
export function ChanceIcon({ size = 56, tilt = -6 }: { size?: number; tilt?: number }) {
  const depth = Math.max(3, Math.round(size / 12));
  return (
    <span
      aria-hidden
      style={{
        flex: "none",
        display: "grid",
        placeItems: "center",
        width: size,
        height: size,
        borderRadius: size * 0.31,
        transform: `rotate(${tilt}deg)`,
        background: "radial-gradient(120% 120% at 28% 18%,#FFF0B8 0%,#F5B70C 42%,#D17A04 100%)",
        boxShadow: `inset 0 ${depth / 2}px ${depth}px rgba(255,255,255,0.55), inset 0 -${depth}px ${depth * 1.6}px rgba(120,60,0,0.3), 0 ${depth}px 0 #8E5202, 0 ${depth * 3}px ${depth * 5}px rgba(0,0,0,0.45)`,
        marginBottom: depth,
      }}
    >
      <svg width={size * 0.48} height={size * 0.48} viewBox="0 0 24 24" fill="none" stroke="#6A3500" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9a2 2 0 0 0 0 6v3a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-3a2 2 0 0 1 0-6V6a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1z" />
        <path d="M14 5v14" strokeDasharray="2 3" />
      </svg>
    </span>
  );
}
