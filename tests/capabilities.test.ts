import { describe, expect, it, vi } from 'vitest'

import { EbayAuth, ScopeNotGrantedError } from '@main/ebay/auth'
import {
  CapabilityUnavailableError,
  EbayApiError,
  asCapabilityError,
} from '@main/ebay/client'

import { testConfig } from './helpers'

const secrets = { store: vi.fn(), load: vi.fn(() => null) }
const browser = { open: vi.fn(async () => {}) }

describe('asCapabilityError', () => {
  it('treats a 403 as a missing entitlement, not a fault', () => {
    const mapped = asCapabilityError(new EbayApiError(403, 'Insufficient permissions'), 'browse')
    expect(mapped).toBeInstanceOf(CapabilityUnavailableError)
    expect(mapped?.capability).toBe('browse')
  })

  it('treats a 401 mentioning the scope as a missing entitlement', () => {
    expect(asCapabilityError(new EbayApiError(401, 'insufficient scope'), 'catalog')).not.toBeNull()
  })

  it('leaves genuine faults alone, so they still fail loudly', () => {
    // A 500 or a timeout is not a permission problem and must not be
    // silently swallowed as "feature unavailable".
    expect(asCapabilityError(new EbayApiError(500, 'server error'), 'catalog')).toBeNull()
    expect(asCapabilityError(new EbayApiError(404, 'not found'), 'catalog')).toBeNull()
    expect(asCapabilityError(new Error('socket hang up'), 'catalog')).toBeNull()
  })

  it('maps a refused scope from the token endpoint', () => {
    const refused = new ScopeNotGrantedError(['x'], 'nicht erteilt')
    expect(asCapabilityError(refused, 'catalog')).toBeInstanceOf(CapabilityUnavailableError)
  })
})

describe('EbayAuth application tokens', () => {
  function authWithFetch(handler: (scope: string) => Response): EbayAuth {
    vi.stubGlobal('fetch', async (_url: unknown, init: { body?: URLSearchParams }) => {
      const scope = init?.body?.get('scope') ?? ''
      return handler(scope)
    })
    return new EbayAuth(testConfig(), secrets, browser)
  }

  const okToken = (token: string): Response =>
    new Response(JSON.stringify({ access_token: token, expires_in: 7200 }), { status: 200 })

  it('caches tokens per scope set instead of globally', async () => {
    const calls: string[] = []
    const auth = authWithFetch((scope) => {
      calls.push(scope)
      return okToken(`token-for-${scope.includes('catalog') ? 'catalog' : 'basic'}`)
    })

    const basic = await auth.getAppToken()
    const catalog = await auth.getAppToken([
      'https://api.ebay.com/oauth/api_scope',
      'https://api.ebay.com/oauth/api_scope/commerce.catalog.readonly',
    ])

    expect(basic).not.toBe(catalog)
    expect(calls).toHaveLength(2)

    // Second call for the same scope set must come from the cache.
    await auth.getAppToken()
    expect(calls).toHaveLength(2)

    vi.unstubAllGlobals()
  })

  it('a refused catalog scope does not poison the basic token', async () => {
    // This is the whole reason the catalog scope is requested separately:
    // eBay rejects the entire token request when one scope is not granted.
    const auth = authWithFetch((scope) =>
      scope.includes('catalog')
        ? new Response(JSON.stringify({ error: 'invalid_scope' }), { status: 400 })
        : okToken('basic-token'),
    )

    await expect(
      auth.getAppToken(['https://api.ebay.com/oauth/api_scope/commerce.catalog.readonly']),
    ).rejects.toBeInstanceOf(ScopeNotGrantedError)

    // Taxonomy and Browse must keep working.
    await expect(auth.getAppToken()).resolves.toBe('basic-token')

    vi.unstubAllGlobals()
  })
})
