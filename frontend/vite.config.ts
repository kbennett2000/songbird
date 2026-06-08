/// <reference types="vitest/config" />
import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Dev server proxies songbird's API (and /healthz) to the uvicorn backend. /tiles is proxied too:
// Vite's static dev server doesn't serve the relief pmtiles with the HTTP Range support its client
// needs, so the basemap would silently blank in dev — the backend's StaticFiles mount does (ADR 0003).
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? "http://localhost:8077";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/api": { target: apiProxyTarget, changeOrigin: true, secure: false },
      "/healthz": { target: apiProxyTarget, changeOrigin: true, secure: false },
      "/tiles": { target: apiProxyTarget, changeOrigin: true, secure: false },
    },
  },
  test: {
    globals: true,
    environment: "happy-dom",
    setupFiles: ["src/test/setup.ts"],
    css: true,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
