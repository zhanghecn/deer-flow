import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

import { mockApiPlugin } from "./src/mock-server/plugin";

const DEFAULT_GATEWAY_BASE_URL = "http://localhost:8001";

function getGatewayBaseURL(rawURL?: string): string {
  const url = rawURL ?? DEFAULT_GATEWAY_BASE_URL;
  return url.replace(/\/+$/, "");
}

function createGatewayProxy(target: string) {
  return {
    "/api": {
      target,
      changeOrigin: true,
    },
    "/open": {
      target,
      changeOrigin: true,
    },
    "/health": {
      target,
      changeOrigin: true,
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "VITE_");
  const gatewayBaseURL = getGatewayBaseURL(env.VITE_BACKEND_BASE_URL);

  return {
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
      // `vite` 默认使用 development mode，这里按当前 mode 读取
      // `.env.development*` 里的网关地址，只用于开发时的反向代理。
      proxy: createGatewayProxy(gatewayBaseURL),
    },
    build: {
      outDir: "dist",
    },
  };
});
