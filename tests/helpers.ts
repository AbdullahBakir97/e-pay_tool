/** Fake eBay and AI backends, so tests never touch the network. */

import type { AIProvider, IdentifyInput } from '@main/ai/provider'
import type {
  ListingCopy,
  ListingReview,
  ProductIdentification,
} from '@main/ai/schemas'
import type { AppConfig } from '@main/config'
import type { EbayClient, RequestOptions } from '@main/ebay/client'
import { ProductRepository } from '@main/db/products'
import { openDatabase, type Db } from '@main/db/schema'

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    ebayEnv: 'sandbox',
    ebayClientId: 'test-id',
    ebayClientSecret: 'test-secret',
    ebayRuName: 'test-ru-name',
    ebayMarketplace: 'EBAY_DE',
    contentLanguage: 'de-DE',
    currency: 'EUR',
    aiProvider: 'none',
    geminiApiKey: '',
    geminiModel: 'gemini-2.5-flash',
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'qwen2.5vl',
    defaultCondition: 'NEW',
    undercutPercent: 3.0,
    oauthCallbackPort: 8123,
    ...overrides,
  }
}

export type CannedResponses = Record<string, unknown | (() => unknown)>

/**
 * Serves canned JSON keyed by a substring of the request path. Shaped
 * like EbayClient so it can be passed wherever one is expected.
 */
export class FakeEbayClient {
  readonly calls: Array<{ method: string; path: string; options: RequestOptions }> = []

  constructor(
    readonly config: AppConfig,
    private readonly responses: CannedResponses = {},
  ) {}

  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    this.calls.push({ method, path, options })

    // Prefer the key matching closest to the end of the path, so
    // ".../offer/X/publish" is not shadowed by the more general
    // ".../offer" prefix it happens to contain.
    const match = Object.entries(this.responses)
      .map(([fragment, value]) => ({ fragment, value, at: path.lastIndexOf(fragment) }))
      .filter((candidate) => candidate.at >= 0)
      .sort((a, b) => path.length - (a.at + a.fragment.length) - (path.length - (b.at + b.fragment.length)))[0]

    if (!match) return {} as T
    return (typeof match.value === 'function'
      ? (match.value as () => unknown)()
      : match.value) as T
  }

  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('GET', path, options)
  }

  post<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('POST', path, options)
  }

  put<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('PUT', path, options)
  }

  delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, options)
  }

  /** Structural cast: tests only exercise the request surface. */
  asClient(): EbayClient {
    return this as unknown as EbayClient
  }
}

export class FakeAI implements AIProvider {
  readonly identifyCalls: IdentifyInput[] = []
  readonly copyCalls: Array<Record<string, unknown>> = []

  constructor(
    private readonly identification: ProductIdentification = {
      aspects: {},
      questions: [],
      photoSuggestions: [],
    },
    private readonly copy: ListingCopy = {
      title: 'Testartikel',
      descriptionHtml: '<p>Test</p>',
    },
  ) {}

  async identifyProduct(input: IdentifyInput): Promise<ProductIdentification> {
    this.identifyCalls.push(input)
    return this.identification
  }

  async writeCopy(facts: Record<string, unknown>): Promise<ListingCopy> {
    this.copyCalls.push(facts)
    return this.copy
  }

  async reviewListing(): Promise<ListingReview> {
    return { issues: [], suggestions: [] }
  }
}

/** Fresh in-memory database per test. */
export function testDb(): { db: Db; repo: ProductRepository } {
  const db = openDatabase(':memory:')
  return { db, repo: new ProductRepository(db) }
}

export const silentLogger = { warn: () => {}, error: () => {} }
