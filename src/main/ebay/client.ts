/** Thin HTTP client for eBay REST APIs with retries and error mapping. */

import { apiBase, type AppConfig } from '@main/config'

import { ScopeNotGrantedError } from './auth'

const RETRY_STATUS = new Set([429, 500, 502, 503, 504])
const MAX_RETRIES = 4
const REQUEST_TIMEOUT_MS = 30_000

export type TokenKind = 'user' | 'app'

export interface RequestOptions {
  token?: TokenKind
  /** Scopes for the application token; ignored for user tokens. */
  scopes?: string[]
  params?: Record<string, string | number | undefined>
  body?: unknown
  headers?: Record<string, string>
}

export interface TokenSource {
  getUserToken(): Promise<string>
  getAppToken(scopes?: string[]): Promise<string>
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

/**
 * The API exists and the credentials are valid, but this application has
 * not been granted access to it - a missing OAuth scope or an approval
 * eBay has not given (the Browse API needs one, for example).
 *
 * Separate from EbayApiError so the pipeline can degrade gracefully
 * instead of marking every product as failed.
 */
export class CapabilityUnavailableError extends Error {
  constructor(
    readonly capability: string,
    message: string,
  ) {
    super(message)
    this.name = 'CapabilityUnavailableError'
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
    const { token = 'user', scopes, params, body, headers } = options

    const url = new URL(path, apiBase(this.config))
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }

    let backoff = 1000
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      const bearer =
        token === 'user' ? await this.auth.getUserToken() : await this.auth.getAppToken(scopes)

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

  delete<T = Record<string, unknown>>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, options)
  }
}

/**
 * Maps "you may not call this" responses onto CapabilityUnavailableError.
 * A 403, or a 401 mentioning the scope, means an entitlement is missing -
 * retrying or failing the product would both be wrong.
 */
export function asCapabilityError(
  error: unknown,
  capability: string,
): CapabilityUnavailableError | null {
  if (error instanceof CapabilityUnavailableError) return error

  if (error instanceof ScopeNotGrantedError) {
    return new CapabilityUnavailableError(capability, error.message)
  }

  if (error instanceof EbayApiError) {
    const insufficientScope =
      error.status === 403 ||
      (error.status === 401 && /scope|insufficient/i.test(error.message))
    if (insufficientScope) {
      return new CapabilityUnavailableError(
        capability,
        `Kein Zugriff auf diese eBay-API (${capability}): ${error.message}`,
      )
    }
  }
  return null
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
