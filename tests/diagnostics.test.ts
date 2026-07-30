import { describe, expect, it } from 'vitest'

import { EbayApiError } from '@main/ebay/client'
import { formatReport, runDiagnostics, runPublishDryRun } from '@main/ebay/diagnostics'
import type { CheckResult } from '@shared/types'

import { FakeEbayClient, testConfig, type CannedResponses } from './helpers'

const HEALTHY: CannedResponses = {
  get_default_category_tree_id: { categoryTreeId: '77' },
  get_category_suggestions: {
    categorySuggestions: [{ category: { categoryId: '9355', categoryName: 'Handys' } }],
  },
  'product_summary/search': {
    productSummaries: [{ epid: '1', title: 'Apple iPhone 13 128GB' }],
  },
  'item_summary/search': {
    itemSummaries: [
      { price: { value: '400.00', currency: 'EUR' } },
      { price: { value: '420.00', currency: 'EUR' } },
      { price: { value: '380.00', currency: 'EUR' } },
    ],
  },
  fulfillment_policy: { fulfillmentPolicies: [{ fulfillmentPolicyId: 'F', name: 'Versand' }] },
  payment_policy: { paymentPolicies: [{ paymentPolicyId: 'P', name: 'Zahlung' }] },
  return_policy: { returnPolicies: [{ returnPolicyId: 'R', name: 'Rücknahme' }] },
  'location/DEFAULT_LOCATION': { merchantLocationKey: 'DEFAULT_LOCATION' },
}

const ALL_POLICIES = { fulfillment: 'F', payment: 'P', return: 'R' }

function deps(overrides: {
  responses?: CannedResponses
  signedIn?: boolean
  policyIds?: Record<string, string>
  config?: Partial<ReturnType<typeof testConfig>>
  getAppToken?: () => Promise<string>
} = {}) {
  const config = testConfig(overrides.config)
  const client = new FakeEbayClient(config, overrides.responses ?? HEALTHY)
  return {
    config,
    client: client.asClient(),
    auth: {
      hasUserConsent: overrides.signedIn ?? true,
      getAppToken: overrides.getAppToken ?? (async () => 'token'),
    },
    policyIds: overrides.policyIds ?? ALL_POLICIES,
    fake: client,
  }
}

const byId = (results: CheckResult[], id: string): CheckResult =>
  results.find((result) => result.id === id) as CheckResult

describe('runDiagnostics', () => {
  it('passes every check on a healthy, fully configured account', async () => {
    const results = await runDiagnostics(deps())
    expect(results.every((r) => r.status === 'ok')).toBe(true)
    expect(results.map((r) => r.id)).toEqual([
      'config',
      'app-token',
      'taxonomy',
      'catalog',
      'browse',
      'consent',
      'policies',
      'location',
      'policy-selection',
    ])
  })

  it('stops early and skips the rest when credentials are missing', async () => {
    const results = await runDiagnostics(
      deps({ config: { ebayClientId: '', ebayClientSecret: '', ebayRuName: '' } }),
    )
    expect(byId(results, 'config').status).toBe('fail')
    // Reporting later checks as broken would be misleading, not helpful.
    expect(byId(results, 'taxonomy').status).toBe('skipped')
    expect(byId(results, 'browse').status).toBe('skipped')
  })

  it('fails hard when the application token cannot be obtained', async () => {
    const results = await runDiagnostics(
      deps({
        getAppToken: async () => {
          throw new Error('invalid_client')
        },
      }),
    )
    expect(byId(results, 'app-token').status).toBe('fail')
    expect(byId(results, 'app-token').hint).toMatch(/Sandbox/)
    expect(byId(results, 'taxonomy').status).toBe('skipped')
  })

  it('reports a missing Catalog entitlement as a warning, not a failure', async () => {
    // The app still works without it, so this must not read as "broken".
    const bad = new FakeEbayClient(testConfig(), HEALTHY)
    const original = bad.request.bind(bad)
    bad.request = async (method, path, options) => {
      if (path.includes('product_summary/search')) {
        throw new EbayApiError(403, 'Insufficient permissions')
      }
      return original(method, path, options)
    }

    const base = deps()
    const results = await runDiagnostics({ ...base, client: bad.asClient() })

    expect(byId(results, 'catalog').status).toBe('warn')
    expect(byId(results, 'catalog').hint).toMatch(/commerce\.catalog\.readonly/)
    expect(byId(results, 'browse').status).toBe('ok')
  })

  it('skips the account checks when the seller is not signed in', async () => {
    const results = await runDiagnostics(deps({ signedIn: false }))
    expect(byId(results, 'consent').status).toBe('fail')
    expect(byId(results, 'policies').status).toBe('skipped')
    expect(byId(results, 'location').status).toBe('skipped')
  })

  it('flags an incomplete set of eBay business policies', async () => {
    const results = await runDiagnostics(
      deps({ responses: { ...HEALTHY, return_policy: { returnPolicies: [] } } }),
    )
    expect(byId(results, 'policies').status).toBe('fail')
    expect(byId(results, 'policies').hint).toMatch(/Verkaufsrichtlinien/)
  })

  it('flags policies that exist at eBay but are not selected in the app', async () => {
    const results = await runDiagnostics(deps({ policyIds: {} }))
    expect(byId(results, 'policies').status).toBe('ok')
    expect(byId(results, 'policy-selection').status).toBe('fail')
  })
})

describe('runPublishDryRun', () => {
  const DRY_RUN_RESPONSES: CannedResponses = {
    ...HEALTHY,
    '/sell/inventory/v1/offer': { offerId: 'OFFER-TEST' },
  }

  it('creates a draft and deletes everything again, never publishing', async () => {
    const base = deps({ responses: DRY_RUN_RESPONSES })
    const results = await runPublishDryRun(base)

    expect(byId(results, 'dry-run-inventory').status).toBe('ok')
    expect(byId(results, 'dry-run-offer').status).toBe('ok')
    expect(byId(results, 'dry-run-cleanup').status).toBe('ok')

    const paths = base.fake.calls.map((call) => `${call.method} ${call.path}`)
    expect(paths).toContain('DELETE /sell/inventory/v1/offer/OFFER-TEST')
    expect(paths).toContain('DELETE /sell/inventory/v1/inventory_item/EP-DIAGNOSE-TEST')
    // The one thing this test must never do.
    expect(paths.some((path) => path.includes('/publish'))).toBe(false)
  })

  it('still cleans up the inventory item when creating the offer fails', async () => {
    const client = new FakeEbayClient(testConfig(), DRY_RUN_RESPONSES)
    const original = client.request.bind(client)
    client.request = async (method, path, options) => {
      if (method === 'POST' && path.endsWith('/sell/inventory/v1/offer')) {
        throw new Error('Angebot abgelehnt')
      }
      return original(method, path, options)
    }

    const base = deps({ responses: DRY_RUN_RESPONSES })
    const results = await runPublishDryRun({ ...base, client: client.asClient() })

    expect(byId(results, 'dry-run-offer').status).toBe('fail')
    const paths = client.calls.map((call) => `${call.method} ${call.path}`)
    expect(paths).toContain('DELETE /sell/inventory/v1/inventory_item/EP-DIAGNOSE-TEST')
  })

  it('refuses to run without a complete policy selection', async () => {
    const results = await runPublishDryRun(deps({ policyIds: {} }))
    expect(results).toHaveLength(1)
    expect(results[0]?.status).toBe('fail')
  })
})

describe('formatReport', () => {
  it('renders a copyable report with hints for anything not ok', () => {
    const report = formatReport([
      { id: 'a', label: 'Erste Prüfung', status: 'ok', detail: 'gut', hint: 'unsichtbar' },
      { id: 'b', label: 'Zweite Prüfung', status: 'warn', detail: 'teilweise', hint: 'mach dies' },
    ])
    expect(report).toContain('[ OK ] Erste Prüfung: gut')
    expect(report).not.toContain('unsichtbar')
    expect(report).toContain('-> mach dies')
  })
})
