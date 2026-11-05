import { defineConfig } from "tsup";

export default defineConfig([
  // npm package: React stays a peer dependency of the partner's app.
  {
    entry: { index: "src/index.tsx" },
    format: ["cjs", "esm"],
    dts: true,
    clean: true,
    sourcemap: true,
    target: "es2020",
    external: ["react", "react-dom"],
  },
  // <script> tag build for non-React sites: bundles its own React, exposes window.LooftaPortal.
  {
    entry: { "loofta-portal": "src/global.tsx" },
    format: ["iife"],
    globalName: "LooftaPortal",
    minify: true,
    target: "es2020",
    noExternal: [/.*/],
    define: { "process.env.NODE_ENV": '"production"' },
  },
]);
