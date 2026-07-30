/** Thin HTTP client for eBay REST APIs with retries and error mapping. */

import { apiBase, type AppConfig } from '@main/config'

const RETRY_STATUS = new Set([429, 500, 502, 503, 504])
const MAX_RETRIES = 4
const REQUEST_TIMEOUT_MS = 30_000

export type TokenKind = 'user' | 'app'

export interface RequestOptions {
  token?: TokenKind
  params?: Record<string, string | number | undefined>
  body?: unknown
  headers?: Record<string, string>
}

export interface TokenSource {
  getUserToken(): Promise<string>
  getAppToken(): Promise<string>
}

export class EbayApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly errors: Array<{ message?: string }> = [],
  ) {
    super(`eBay API error ${status}: ${message}`)
    this.name = 'EbayApiError'
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export class EbayClient {
  constructor(
    readonly config: AppConfig,
    private readonly auth: TokenSource,
  ) {}

  async request<T = Record<string, unknown>>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const { token = 'user', params, body, headers } = options

    const url = new URL(path, apiBase(this.config))
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }

    let backoff = 1000
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      const bearer = token === 'user' ? await this.auth.getUserToken() : await this.auth.getAppToken()

      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${bearer}`,
          'X-EBAY-C-MARKETPLACE-ID': this.config.ebayMarketplace,
          'Content-Language': this.config.contentLanguage,
          'Accept-Language': this.config.contentLanguage,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })

      if (RETRY_STATUS.has(response.status) && attempt < MAX_RETRIES) {
        await sleep(backoff)
        backoff *= 2
        continue
      }

      if (!response.ok) {
        throw await toApiError(response)
      }

      if (response.status === 204) return {} as T
      const text = await response.text()
      return (text ? JSON.parse(text) : {}) as T
    }

    /* c8 ignore next */
    throw new EbayApiError(0, 'unreachable')
  }

  get<T = Record<string, unknown>>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('GET', path, options)
  }

  post<T = Record<string, unknown>>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('POST', path, options)
  }

  put<T = Record<string, unknown>>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('PUT', path, options)
  }
}

async function toApiError(response: Response): Promise<EbayApiError> {
  const text = await response.text()
  try {
    const parsed = JSON.parse(text) as { errors?: Array<{ message?: string }> }
    const errors = parsed.errors ?? []
    const message = errors.length
      ? errors.map((error) => error.message ?? '').join('; ')
      : text.slice(0, 300)
    return new EbayApiError(response.status, message, errors)
  } catch {
    return new EbayApiError(response.status, text.slice(0, 300))
  }
}
