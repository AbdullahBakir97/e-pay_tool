/**
 * eBay OAuth2.
 *
 * Two token kinds are used:
 *
 * - **User token** (authorization-code flow) - required by the Sell APIs
 *   (Inventory, Account). Obtained once via a browser consent screen; the
 *   refresh token (~18 months) is stored in the OS credential store and
 *   access tokens are refreshed silently afterwards.
 * - **Application token** (client-credentials flow) - enough for the
 *   read-only Buy/Commerce APIs (Browse, Catalog, Taxonomy).
 *
 * Desktop-app note: eBay redirects to the "accept URL" configured for the
 * app's RuName. Point that URL at `http://localhost:<port>/callback` so
 * the loopback server below can capture the authorization code.
 */

import { createServer, type Server } from 'node:http'

import { apiBase, authBase, type AppConfig } from '@main/config'

export const USER_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.account',
]

/** Enough for Browse and Taxonomy. */
export const APP_SCOPES = ['https://api.ebay.com/oauth/api_scope']

/**
 * The Catalog API needs its own scope on top of the basic one.
 *
 * It is deliberately requested as a *separate* token: eBay rejects the
 * whole token request when the application is not entitled to one of the
 * requested scopes, so merging this into APP_SCOPES would take Taxonomy
 * and Browse down with it whenever catalog access has not been granted.
 */
export const CATALOG_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/commerce.catalog.readonly',
]

const EXPIRY_SKEW_MS = 60_000
const LOGIN_TIMEOUT_MS = 300_000

export class AuthError extends Error {}

/**
 * Raised when eBay refuses to issue a token for the requested scopes -
 * i.e. the application is not entitled to that API. Distinct from a
 * transport failure so callers can degrade instead of retrying.
 */
export class ScopeNotGrantedError extends AuthError {
  constructor(
    readonly scopes: string[],
    message: string,
  ) {
    super(message)
    this.name = 'ScopeNotGrantedError'
  }
}

interface TokenResponse {
  access_token: string
  expires_in?: number
  refresh_token?: string
}

export interface SecretStore {
  store(name: string, value: string): void
  load(name: string): string | null
}

export interface Browser {
  open(url: string): Promise<void>
}

interface CachedToken {
  token: string
  expiry: number
}

export class EbayAuth {
  private userToken: string | null = null
  private userTokenExpiry = 0
  /** Application tokens are cached per scope set, not globally. */
  private readonly appTokens = new Map<string, CachedToken>()
  private readonly refreshKey: string

  constructor(
    private readonly config: AppConfig,
    private readonly secrets: SecretStore,
    private readonly browser: Browser,
  ) {
    this.refreshKey = `ebay_refresh_token_${config.ebayEnv}`
  }

  get hasUserConsent(): boolean {
    return this.secrets.load(this.refreshKey) !== null
  }

  /** Valid user access token, refreshing if needed. */
  async getUserToken(): Promise<string> {
    if (this.userToken && Date.now() < this.userTokenExpiry - EXPIRY_SKEW_MS) {
      return this.userToken
    }
    const refreshToken = this.secrets.load(this.refreshKey)
    if (!refreshToken) {
      throw new AuthError('Noch keine eBay-Anmeldung – bitte zuerst bei eBay anmelden.')
    }
    const payload = await this.tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: USER_SCOPES.join(' '),
    })
    this.userToken = payload.access_token
    this.userTokenExpiry = Date.now() + (payload.expires_in ?? 7200) * 1000
    return this.userToken
  }

  /** Valid application token (client credentials) for the given scopes. */
  async getAppToken(scopes: string[] = APP_SCOPES): Promise<string> {
    const key = [...scopes].sort().join(' ')
    const cached = this.appTokens.get(key)
    if (cached && Date.now() < cached.expiry - EXPIRY_SKEW_MS) {
      return cached.token
    }

    let payload: TokenResponse
    try {
      payload = await this.tokenRequest({
        grant_type: 'client_credentials',
        scope: scopes.join(' '),
      })
    } catch (error) {
      // eBay answers an unentitled scope with invalid_scope / invalid_client.
      if (error instanceof AuthError && /invalid_scope|invalid_client/i.test(error.message)) {
        throw new ScopeNotGrantedError(
          scopes,
          `eBay hat die Berechtigung für diese API nicht erteilt (${scopes.join(', ')}).`,
        )
      }
      throw error
    }

    this.appTokens.set(key, {
      token: payload.access_token,
      expiry: Date.now() + (payload.expires_in ?? 7200) * 1000,
    })
    return payload.access_token
  }

  /** Open the browser consent screen and wait for the redirect. */
  async interactiveLogin(timeoutMs = LOGIN_TIMEOUT_MS): Promise<void> {
    const params = new URLSearchParams({
      client_id: this.config.ebayClientId,
      response_type: 'code',
      redirect_uri: this.config.ebayRuName,
      scope: USER_SCOPES.join(' '),
    })
    const code = await this.captureAuthorizationCode(
      `${authBase(this.config)}/oauth2/authorize?${params}`,
      timeoutMs,
    )
    await this.exchangeCode(code)
  }

  private captureAuthorizationCode(consentUrl: string, timeoutMs: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      // `finish` is safe to reference here: requests can only arrive after
      // listen() below, by which point every binding is initialised.
      const server: Server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const code = url.searchParams.get('code')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(
          code
            ? '<h2>Anmeldung erfolgreich.</h2><p>Sie können dieses Fenster schließen.</p>'
            : '<h2>Anmeldung fehlgeschlagen.</h2>',
        )
        finish(code ? { code } : { error: new AuthError('eBay hat keinen Code zurückgegeben.') })
      })

      const timer = setTimeout(() => {
        server.close()
        reject(new AuthError('Zeitüberschreitung bei der eBay-Anmeldung.'))
      }, timeoutMs)

      const finish = (result: { code?: string; error?: Error }): void => {
        clearTimeout(timer)
        server.close()
        if (result.code) resolve(result.code)
        else reject(result.error ?? new AuthError('Die eBay-Anmeldung wurde abgebrochen.'))
      }

      server.on('error', (error) => finish({ error }))
      server.listen(this.config.oauthCallbackPort, '127.0.0.1', () => {
        this.browser.open(consentUrl).catch((error: Error) => finish({ error }))
      })
    })
  }

  private async exchangeCode(code: string): Promise<void> {
    const payload = await this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.ebayRuName,
    })
    this.userToken = payload.access_token
    this.userTokenExpiry = Date.now() + (payload.expires_in ?? 7200) * 1000
    if (payload.refresh_token) {
      this.secrets.store(this.refreshKey, payload.refresh_token)
    }
  }

  private async tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
    const basic = Buffer.from(
      `${this.config.ebayClientId}:${this.config.ebayClientSecret}`,
    ).toString('base64')

    const response = await fetch(`${apiBase(this.config)}/identity/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(body),
      signal: AbortSignal.timeout(30_000),
    })

    if (!response.ok) {
      throw new AuthError(
        `Token-Anfrage fehlgeschlagen (${response.status}): ${(await response.text()).slice(0, 300)}`,
      )
    }
    return (await response.json()) as TokenResponse
  }
}
