/**
 * Provider-agnostic AI interface.
 *
 * The app never talks to a specific model directly - it talks to this
 * interface. Swapping Gemini for a local Ollama model (or any future
 * provider) is a config change, not a refactor. Nothing outside this
 * directory imports a vendor SDK.
 */

import type { AppConfig } from '@main/config'

import type { ListingCopy, ListingReview, ProductIdentification } from './schemas'

export interface IdentifyInput {
  /** Absolute paths of local photos. */
  photoPaths: string[]
  /** Anything already known, e.g. the barcode. */
  known?: Record<string, string>
  /** Free text the seller added. */
  notes?: string | null
}

export interface AIProvider {
  /** Identify a product from photos; ask questions where uncertain. */
  identifyProduct(input: IdentifyInput): Promise<ProductIdentification>
  /** Generate title (<=80 chars) and HTML description from known facts. */
  writeCopy(facts: Record<string, unknown>): Promise<ListingCopy>
  /** Soft quality review of a complete draft before posting. */
  reviewListing(draft: Record<string, unknown>): Promise<ListingReview>
}

/** Used when AI is disabled - the app still works for barcode matches. */
export class NullProvider implements AIProvider {
  async identifyProduct(): Promise<ProductIdentification> {
    return {
      aspects: {},
      questions: ['KI ist deaktiviert – bitte Produktdaten manuell eintragen.'],
      photoSuggestions: [],
    }
  }

  async writeCopy(facts: Record<string, unknown>): Promise<ListingCopy> {
    const title = String(facts.title ?? facts.productName ?? '').slice(0, 80)
    return { title, descriptionHtml: `<p>${title}</p>` }
  }

  async reviewListing(): Promise<ListingReview> {
    return { issues: [], suggestions: [] }
  }
}

export interface ProviderResult {
  provider: AIProvider
  /** Why the configured provider is unavailable, for the UI to surface. */
  error: string | null
}

/**
 * Never throws. A missing API key must not stop the app from starting:
 * barcode lookups go through eBay's catalog and work without any AI at
 * all, so the app degrades to that instead of refusing to launch.
 */
export async function createProvider(config: AppConfig): Promise<ProviderResult> {
  try {
    switch (config.aiProvider) {
      case 'gemini': {
        const { GeminiProvider } = await import('./gemini')
        return { provider: new GeminiProvider(config), error: null }
      }
      case 'ollama': {
        const { OllamaProvider } = await import('./ollama')
        return { provider: new OllamaProvider(config), error: null }
      }
      default:
        return { provider: new NullProvider(), error: null }
    }
  } catch (error) {
    return {
      provider: new NullProvider(),
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
