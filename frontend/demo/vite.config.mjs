import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "../app/src"),
      "@demo": path.resolve(rootDir, "./src"),
      "@openagents/sdk": path.resolve(rootDir, "../../sdk/ts/src/index.ts"),
    },
    dedupe: ["react", "react-dom"],
  },
  server: {
    host: "127.0.0.1",
    port: 8084,
    fs: {
      allow: [path.resolve(rootDir, "../..")],
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 8084,
  },
  build: {
    outDir: "dist",
  },
});
