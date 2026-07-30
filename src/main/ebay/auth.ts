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
export const APP_SCOPES = ['https://api.ebay.com/oauth/api_scope']

const EXPIRY_SKEW_MS = 60_000
const LOGIN_TIMEOUT_MS = 300_000

export class AuthError extends Error {}

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

export class EbayAuth {
  private userToken: string | null = null
  private userTokenExpiry = 0
  private appToken: string | null = null
  private appTokenExpiry = 0
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

  /** Valid application token (client credentials). */
  async getAppToken(): Promise<string> {
    if (this.appToken && Date.now() < this.appTokenExpiry - EXPIRY_SKEW_MS) {
      return this.appToken
    }
    const payload = await this.tokenRequest({
      grant_type: 'client_credentials',
      scope: APP_SCOPES.join(' '),
    })
    this.appToken = payload.access_token
    this.appTokenExpiry = Date.now() + (payload.expires_in ?? 7200) * 1000
    return this.appToken
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
