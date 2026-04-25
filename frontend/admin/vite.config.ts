import path from 'node:path'
import type { ClientRequest, IncomingMessage } from 'node:http'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

const DEFAULT_GATEWAY_BASE_URL = 'http://localhost:8001'

type ProxyReqHook = {
  on: (
    event: 'proxyReq',
    handler: (proxyReq: ClientRequest, req: IncomingMessage) => void,
  ) => void
}

function getGatewayBaseURL(rawURL?: string): string {
  const url = rawURL ?? DEFAULT_GATEWAY_BASE_URL
  return url.replace(/\/+$/, '')
}

function getPortFromHost(host: string) {
  if (host.startsWith('[')) {
    return host.split(']:')[1] ?? ''
  }
  const parts = host.split(':')
  return parts.length > 1 ? parts.at(-1) ?? '' : ''
}

function applyBrowserForwardedHeaders(
  proxyReq: ClientRequest,
  req: IncomingMessage,
) {
  const host = req.headers.host?.trim()
  if (!host) {
    return
  }

  // Keep gateway-generated public URLs browser-openable when the admin dev
  // server proxies through compose DNS names such as `gateway:8001`.
  proxyReq.setHeader('X-Forwarded-Host', host)
  proxyReq.setHeader('X-Forwarded-Proto', 'http')
  const port = getPortFromHost(host)
  if (port) {
    proxyReq.setHeader('X-Forwarded-Port', port)
  }
}

function createForwardedGatewayProxy(target: string) {
  return {
    target,
    changeOrigin: true,
    configure(proxy: ProxyReqHook) {
      proxy.on('proxyReq', applyBrowserForwardedHeaders)
    },
  }
}

function createGatewayProxy(target: string) {
  return {
    '/api': createForwardedGatewayProxy(target),
    '/open': createForwardedGatewayProxy(target),
    '/health': createForwardedGatewayProxy(target),
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, 'VITE_')
  // Prefer process env so the Docker dev stack can proxy `/api` to the
  // compose service DNS name without mutating checked-in .env files.
  const gatewayBaseURL = getGatewayBaseURL(
    process.env.VITE_GATEWAY_BASE_URL ?? env.VITE_GATEWAY_BASE_URL,
  )

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5173,
      // 后台开发时也统一走同源 `/api`，实际转发目标由
      // `.env.development*` 里的 VITE_GATEWAY_BASE_URL 控制。
      proxy: createGatewayProxy(gatewayBaseURL),
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom', 'react-router'],
            ui: ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', '@radix-ui/react-select', '@radix-ui/react-tabs'],
          },
        },
      },
    },
  }
})
