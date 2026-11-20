import { LOGOS } from "./setup-shared";

const SHAPES: Record<string, React.ReactNode> = {
  ring: <><circle cx="12" cy="12" r="6.5" fill="none" stroke="#fff" strokeWidth="2.6" /></>,
  bars: <><rect x="5" y="11" width="3.4" height="8" rx="1.2" fill="#fff" /><rect x="10.3" y="6" width="3.4" height="13" rx="1.2" fill="#fff" /><rect x="15.6" y="9" width="3.4" height="10" rx="1.2" fill="#fff" /></>,
  spark: <path d="M12 4l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" fill="#fff" />,
  wave: <path d="M4 14c2-5 4-5 6 0s4 5 6 0 3-3 4-2" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />,
  tri: <path d="M12 5l7 13H5z" fill="#fff" />,
  dia: <path d="M12 4l8 8-8 8-8-8z" fill="#fff" />,
};

/** A partner's logo: the demo's stand-in for the file a real partner uploads. */
export function Mark({ id, size = 30, radius }: { id: string; size?: number; radius?: number }) {
  const l = LOGOS.find((x) => x.id === id) ?? LOGOS[0];
  return (
    <span aria-hidden style={{ width: size, height: size, borderRadius: radius ?? size * 0.28, background: `#${l.color}`, display: "inline-grid", placeItems: "center", flex: "none" }}>
      <svg width={size * 0.8} height={size * 0.8} viewBox="0 0 24 24">{SHAPES[l.id]}</svg>
    </span>
  );
}
