import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

const DEFAULT_GATEWAY_BASE_URL = 'http://localhost:8001'

function getGatewayBaseURL(rawURL?: string): string {
  const url = rawURL ?? DEFAULT_GATEWAY_BASE_URL
  return url.replace(/\/+$/, '')
}

function createGatewayProxy(target: string) {
  return {
    '/api': {
      target,
      changeOrigin: true,
    },
    '/open': {
      target,
      changeOrigin: true,
    },
    '/health': {
      target,
      changeOrigin: true,
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, 'VITE_')
  const gatewayBaseURL = getGatewayBaseURL(env.VITE_GATEWAY_BASE_URL)

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
