// A small flat SVG nest with three eggs bobbing at staggered offsets — replaces a plain "Loading
// your Nest…" text line. Pure CSS keyframes (no JS animation loop), so it's cheap to render
// anywhere loading state is needed.
export function NestLoader({ label = "Loading your Nest…" }: { label?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: "80px 64px" }}>
      <style>{`
        @keyframes nestEggBob {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-5px); }
        }
      `}</style>
      <svg width="72" height="56" viewBox="0 0 72 56" fill="none">
        {/* Nest bowl — a shallow woven arc, drawn as a dashed stroke to suggest twigs */}
        <path
          d="M6 30 Q6 50 36 50 Q66 50 66 30"
          stroke="var(--accent)"
          strokeOpacity="0.35"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray="6 5"
        />
        <ellipse cx="36" cy="30" rx="32" ry="7" stroke="var(--accent)" strokeOpacity="0.5" strokeWidth="3" />
        {/* Eggs */}
        {[
          { cx: 24, cy: 24, delay: "0s" },
          { cx: 36, cy: 20, delay: "0.15s" },
          { cx: 48, cy: 24, delay: "0.3s" },
        ].map((egg, i) => (
          <ellipse
            key={i}
            cx={egg.cx}
            cy={egg.cy}
            rx="7"
            ry="9"
            fill="var(--accent)"
            style={{ animation: "nestEggBob 1.1s ease-in-out infinite", animationDelay: egg.delay, transformOrigin: `${egg.cx}px ${egg.cy}px` }}
          />
        ))}
      </svg>
      <span style={{ fontSize: 14, color: "var(--ink3)" }}>{label}</span>
    </div>
  );
}
