import type { Config } from "tailwindcss";

// Deliberately minimal — no shadcn theme tokens, no plugins beyond Tailwind's base. This app is a
// single-purpose claim flow, not the main product surface; keep its dependency footprint small.
const config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config;

export default config;
