// The Loofta mark (public/loofta.svg) is a single flat fill (#FF4A26, orange) — Loofta's main
// brand color, which clashes against nest-splash's warm-cream/green palette. Rather than a second
// static asset, this recolors it via a CSS mask: the <span> paints a background color as its
// mask, so it can follow the active theme with no extra file — green accent in light mode, white
// in dark mode (an accent green on dark would still read, but white is what was asked for and is
// higher-contrast against the near-black dark background).
//
// The mask box must match the logo's real aspect ratio (viewBox 179x50, ~3.58:1) — sizing it as
// a square and relying on `mask-size: contain` to fit shrinks the whole mark down to fit the
// height inside that square, which is why the logo rendered tiny before this fix.
const ASPECT = 179 / 50;

export function NestLogo({ height = 24, dark = false }: { height?: number; dark?: boolean }) {
  return (
    <span
      role="img"
      aria-label="Loofta"
      style={{
        display: "inline-block",
        width: height * ASPECT,
        height,
        backgroundColor: dark ? "#fff" : "var(--accent)",
        WebkitMaskImage: "url(/loofta.svg)",
        maskImage: "url(/loofta.svg)",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
        WebkitMaskSize: "contain",
        maskSize: "contain",
      }}
    />
  );
}
