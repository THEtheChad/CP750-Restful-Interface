import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** Where `vite` (dev) proxies `/api`: the gateway started by `bun run dev` at the repo root. */
const apiTarget = process.env.CP750_API_URL ?? "http://127.0.0.1:2222";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: false },
    },
  },
  preview: {
    proxy: {
      "/api": { target: apiTarget, changeOrigin: false },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // The executable embeds every file in dist/; source maps would only add weight.
    sourcemap: false,
    target: "es2022",
  },
});
