import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../app/src"),
      "@demo": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom"],
  },
  server: {
    host: "127.0.0.1",
    port: 8084,
    fs: {
      allow: [path.resolve(__dirname, "..")],
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
