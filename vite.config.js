import { defineConfig } from "vite"

// Relative base so the build works on GitHub Pages under /claim-check/ and on any static host.
export default defineConfig({
  base: "./",
  build: { outDir: "dist", target: "es2022" },
})
