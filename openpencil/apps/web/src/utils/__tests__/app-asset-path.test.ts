import { describe, expect, it } from 'vitest'

import { normalizeAppBasePath, resolveAppAssetPath } from '@/utils/app-asset-path'

describe('app asset path helpers', () => {
  it('normalizes root deployments to a single leading slash', () => {
    expect(normalizeAppBasePath(undefined)).toBe('/')
    expect(normalizeAppBasePath('/')).toBe('/')
  })

  it('normalizes mounted deployments to a prefixed trailing-slash path', () => {
    expect(normalizeAppBasePath('/openpencil')).toBe('/openpencil/')
    expect(normalizeAppBasePath('openpencil')).toBe('/openpencil/')
  })

  it('resolves asset paths under the mounted app prefix', () => {
    expect(resolveAppAssetPath('fonts/inter-400.woff2', '/openpencil/'))
      .toBe('/openpencil/fonts/inter-400.woff2')
    expect(resolveAppAssetPath('/canvaskit/canvaskit.wasm', '/openpencil'))
      .toBe('/openpencil/canvaskit/canvaskit.wasm')
  })

  it('keeps root deployments on root asset paths', () => {
    expect(resolveAppAssetPath('fonts/inter-400.woff2', '/'))
      .toBe('/fonts/inter-400.woff2')
  })
})
