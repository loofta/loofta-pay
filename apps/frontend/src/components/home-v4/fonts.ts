import localFont from "next/font/local";

// Self-hosted (latin, variable) so the build never depends on fetching Google Fonts.
export const sora = localFont({
  src: "../../fonts/sora.woff2",
  weight: "100 800",
  variable: "--font-home-sora",
  display: "swap",
});

export const manrope = localFont({
  src: "../../fonts/manrope.woff2",
  weight: "200 800",
  variable: "--font-home-manrope",
  display: "swap",
});

export const jetbrainsMono = localFont({
  src: "../../fonts/jetbrainsmono.woff2",
  weight: "100 800",
  variable: "--font-home-mono",
  display: "swap",
});
