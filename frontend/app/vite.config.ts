import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { mockApiPlugin } from "./src/mock-server/plugin";

const DEFAULT_GATEWAY_BASE_URL = "http://localhost:8001";

function getGatewayBaseURL(): string {
  const url = process.env.VITE_BACKEND_BASE_URL ?? DEFAULT_GATEWAY_BASE_URL;
  return url.replace(/\/+$/, "");
}

export default defineConfig({
  plugins: [react(), mockApiPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react-router-dom",
      "@radix-ui/react-tabs",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-tooltip",
      "@radix-ui/react-select",
      "@radix-ui/react-switch",
      "@radix-ui/react-scroll-area",
      "@radix-ui/react-collapsible",
      "@radix-ui/react-avatar",
      "@radix-ui/react-separator",
      "@radix-ui/react-slot",
      "@radix-ui/react-toggle",
      "@radix-ui/react-toggle-group",
      "@radix-ui/react-hover-card",
      "@radix-ui/react-progress",
    ],
  },
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: getGatewayBaseURL(),
        changeOrigin: true,
      },
      "/open": {
        target: getGatewayBaseURL(),
        changeOrigin: true,
      },
      "/health": {
        target: getGatewayBaseURL(),
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
