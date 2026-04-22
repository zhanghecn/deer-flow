/**
 * Normalize app asset URLs against Vite's BASE_URL so proxied deployments keep
 * loading runtime assets from the mounted app prefix instead of leaking root
 * requests like `/fonts/...` and `/canvaskit/...`.
 */
export function normalizeAppBasePath(basePath: string | undefined): string {
  const trimmedBasePath = basePath?.trim() || '/'
  const withLeadingSlash = trimmedBasePath.startsWith('/')
    ? trimmedBasePath
    : `/${trimmedBasePath}`
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`
}

export function resolveAppAssetPath(
  relativePath: string,
  basePath = import.meta.env.BASE_URL,
): string {
  const normalizedRelativePath = relativePath.replace(/^\/+/, '')
  return `${normalizeAppBasePath(basePath)}${normalizedRelativePath}`
}
