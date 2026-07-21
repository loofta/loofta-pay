import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", "agent-tool": "src/agent-tool.ts" },
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2020",
});
