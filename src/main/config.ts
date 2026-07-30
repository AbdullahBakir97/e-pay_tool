/**
 * Application configuration.
 *
 * Non-secret settings come from environment variables (prefix `EPAY_`) or
 * a local .env file. The one long-lived secret (the eBay refresh token)
 * is kept in the OS credential store - see secrets.ts.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export type AiProviderName = 'gemini' | 'ollama' | 'none'

export interface AppConfig {
  // eBay
  ebayEnv: 'sandbox' | 'production'
  ebayClientId: string
  ebayClientSecret: string
  /** eBay "RuName" (redirect URL name) of the app. */
  ebayRuName: string
  ebayMarketplace: string
  contentLanguage: string
  currency: string

  // AI
  aiProvider: AiProviderName
  geminiApiKey: string
  geminiModel: string
  ollamaUrl: string
  ollamaModel: string

  // Listing defaults
  defaultCondition: string

  // Pricing
  undercutPercent: number

  // OAuth loopback
  oauthCallbackPort: number
}

/** Minimal .env reader - avoids a dependency for a handful of keys. */
function loadDotEnv(cwd: string): void {
  const path = join(cwd, '.env')
  if (!existsSync(path)) return

  for (const rawLine of readFileSync(path, 'utf-8').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const separator = line.indexOf('=')
    if (separator === -1) continue

    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    // Real environment variables win over the file.
    if (!(key in process.env)) process.env[key] = value
  }
}

function str(key: string, fallback = ''): string {
  return process.env[`EPAY_${key}`]?.trim() || fallback
}

function num(key: string, fallback: number): number {
  const parsed = Number(process.env[`EPAY_${key}`])
  return Number.isFinite(parsed) ? parsed : fallback
}

export function loadConfig(cwd: string = process.cwd()): AppConfig {
  loadDotEnv(cwd)

  const provider = str('AI_PROVIDER', 'gemini').toLowerCase()
  return {
    ebayEnv: str('EBAY_ENV', 'sandbox') === 'production' ? 'production' : 'sandbox',
    ebayClientId: str('EBAY_CLIENT_ID'),
    ebayClientSecret: str('EBAY_CLIENT_SECRET'),
    ebayRuName: str('EBAY_RU_NAME'),
    ebayMarketplace: str('EBAY_MARKETPLACE', 'EBAY_DE'),
    contentLanguage: str('CONTENT_LANGUAGE', 'de-DE'),
    currency: str('CURRENCY', 'EUR'),

    aiProvider: (['gemini', 'ollama', 'none'].includes(provider)
      ? provider
      : 'none') as AiProviderName,
    geminiApiKey: str('GEMINI_API_KEY'),
    geminiModel: str('GEMINI_MODEL', 'gemini-2.5-flash'),
    ollamaUrl: str('OLLAMA_URL', 'http://localhost:11434'),
    ollamaModel: str('OLLAMA_MODEL', 'qwen2.5vl'),

    defaultCondition: str('DEFAULT_CONDITION', 'NEW'),
    undercutPercent: num('UNDERCUT_PERCENT', 3.0),
    oauthCallbackPort: num('OAUTH_CALLBACK_PORT', 8123),
  }
}

export function apiBase(config: AppConfig): string {
  return config.ebayEnv === 'production' ? 'https://api.ebay.com' : 'https://api.sandbox.ebay.com'
}

export function authBase(config: AppConfig): string {
  return config.ebayEnv === 'production' ? 'https://auth.ebay.com' : 'https://auth.sandbox.ebay.com'
}

export function mediaBase(config: AppConfig): string {
  return config.ebayEnv === 'production'
    ? 'https://apim.ebay.com'
    : 'https://apim.sandbox.ebay.com'
}

export function isConfigured(config: AppConfig): boolean {
  return Boolean(config.ebayClientId && config.ebayClientSecret && config.ebayRuName)
}
