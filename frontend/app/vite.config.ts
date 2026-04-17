import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

import { mockApiPlugin } from "./src/mock-server/plugin";

const DEFAULT_GATEWAY_BASE_URL = "http://localhost:8001";
const DEFAULT_ONLYOFFICE_DEV_SERVER_URL = "http://localhost:8082";
const DEFAULT_OPENPENCIL_DEV_SERVER_URL = "http://localhost:3001";

function getGatewayBaseURL(rawURL?: string): string {
  const url = rawURL ?? DEFAULT_GATEWAY_BASE_URL;
  return url.replace(/\/+$/, "");
}

function getOnlyOfficeDevServerURL(rawURL?: string): string {
  const url = rawURL ?? DEFAULT_ONLYOFFICE_DEV_SERVER_URL;
  return url.replace(/\/+$/, "");
}

function getOpenPencilDevServerURL(rawURL?: string): string {
  const url = rawURL ?? DEFAULT_OPENPENCIL_DEV_SERVER_URL;
  return url.replace(/\/+$/, "");
}

function createGatewayProxy(
  target: string,
  onlyOfficeTarget: string,
  openPencilTarget: string,
) {
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
    "/sandbox-ide": {
      target,
      changeOrigin: true,
      ws: true,
    },
    // Keep local browser traffic aligned with production nginx by exposing
    // ONLYOFFICE under the same-origin `/onlyoffice` prefix during Vite dev.
    "/onlyoffice": {
      target: onlyOfficeTarget,
      changeOrigin: true,
      ws: true,
      rewrite: (path) => path.replace(/^\/onlyoffice/, ""),
    },
    // Keep OpenPencil under the same-origin `/openpencil` prefix so the
    // external design board can call back into `/api/design/*` without CORS.
    "/openpencil": {
      target: openPencilTarget,
      changeOrigin: true,
      ws: true,
      rewrite: (path) => path.replace(/^\/openpencil/, ""),
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "VITE_");
  const gatewayBaseURL = getGatewayBaseURL(env.VITE_BACKEND_BASE_URL);
  const onlyOfficeDevServerURL = getOnlyOfficeDevServerURL(
    env.VITE_ONLYOFFICE_DEV_SERVER_URL,
  );
  const openPencilDevServerURL = getOpenPencilDevServerURL(
    env.VITE_OPENPENCIL_DEV_SERVER_URL,
  );

  return {
    plugins: [react(), mockApiPlugin()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "@openagents/sdk": path.resolve(__dirname, "../../sdk/ts/src/index.ts"),
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
      proxy: createGatewayProxy(
        gatewayBaseURL,
        onlyOfficeDevServerURL,
        openPencilDevServerURL,
      ),
    },
    build: {
      outDir: "dist",
    },
  };
});
