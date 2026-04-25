import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const viteHost = process.env.HOST ?? process.env.VITE_HOST ?? "127.0.0.1";
const vitePort = Number(process.env.PORT ?? process.env.VITE_PORT ?? 8084);
const demoFileServiceUrl =
  process.env.DEMO_FILE_SERVICE_URL ??
  process.env.VITE_DEMO_FILE_SERVICE_URL ??
  "http://127.0.0.1:8090";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "../app/src"),
      "@demo": path.resolve(rootDir, "./src"),
    },
    dedupe: ["react", "react-dom"],
  },
  server: {
    // Docker dev overrides HOST/PORT so the demo binds on 0.0.0.0 inside the
    // container, while plain host-run `pnpm dev` still defaults to localhost.
    host: viteHost,
    port: vitePort,
    // The standalone demo expects one public origin that serves both the UI
    // and the colocated workbench APIs/MCP transports.
    proxy: {
      "/api": {
        target: demoFileServiceUrl,
      },
      "/mcp-http": {
        target: demoFileServiceUrl,
        ws: true,
      },
      "/mcp-http-agent": {
        target: demoFileServiceUrl,
        ws: true,
      },
    },
    fs: {
      allow: [path.resolve(rootDir, "../..")],
    },
  },
  preview: {
    host: viteHost,
    port: vitePort,
  },
  build: {
    outDir: "dist",
  },
});
