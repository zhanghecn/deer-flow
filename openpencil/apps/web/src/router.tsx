import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

const routerBasePath = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') || '/'

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    basepath: routerBasePath === '/' ? '/' : routerBasePath,

    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
