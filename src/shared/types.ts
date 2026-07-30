/**
 * Types shared between the main process and the renderer.
 *
 * This file must stay free of Node and Electron imports: the renderer
 * bundles it too.
 */

/** Lifecycle of a product in the listing queue. */
export enum ProductState {
  /** Captured (barcode and/or photos), not yet processed. */
  Scanned = 'SCANNED',
  /** Lookup, pricing and AI running in the background. */
  Enriching = 'ENRICHING',
  /** Open questions or missing required fields. */
  NeedsInfo = 'NEEDS_INFO',
  /** Complete draft, one click away from publishing. */
  Ready = 'READY',
  /** Being published to eBay. */
  Posting = 'POSTING',
  /** Live on eBay. */
  Posted = 'POSTED',
  /** Last operation failed; can be retried. */
  Failed = 'FAILED',
}

/** Where a product's data came from. */
export enum DataSource {
  /** Matched in the eBay product catalog by GTIN. */
  Catalog = 'CATALOG',
  /** Identified by the AI fallback from photos/notes. */
  Ai = 'AI',
  /** Entered by the user. */
  Manual = 'MANUAL',
}

export interface Photo {
  id: number
  productId: number
  /** Local file path; empty for eBay catalog stock images. */
  path: string
  /** eBay-hosted URL, set after upload or taken from the catalog. */
  ebayUrl: string | null
  position: number
}

export interface PriceStats {
  minimum: number
  median: number
  maximum: number
  sampleSize: number
  currency: string
  outliersRemoved: number
}

export interface Product {
  id: number
  sku: string
  state: ProductState
  source: DataSource | null

  // Identification
  gtin: string | null
  epid: string | null
  title: string | null
  brand: string | null
  mpn: string | null
  condition: string | null
  categoryId: string | null
  aspects: Record<string, string[]> | null
  description: string | null
  userNotes: string | null

  // Offer
  price: number | null
  currency: string
  quantity: number
  priceStats: PriceStats | null

  // AI assistance
  aiQuestions: string[] | null
  aiSuggestions: string[] | null
  aiConfidence: Record<string, number> | null

  // eBay publishing state
  offerId: string | null
  listingId: string | null
  lastError: string | null

  createdAt: string
  updatedAt: string

  photos: Photo[]
}

export type Severity = 'BLOCKER' | 'WARNING'

export interface Issue {
  severity: Severity
  message: string
}

export interface PolicyIds {
  fulfillment?: string
  payment?: string
  return?: string
}

export interface PolicyOption {
  id: string
  name: string
}

export interface PolicyOptions {
  fulfillment: PolicyOption[]
  payment: PolicyOption[]
  return: PolicyOption[]
}

/** Fields the detail panel may write back. */
export interface ProductEdit {
  title?: string | null
  brand?: string | null
  condition?: string | null
  price?: number | null
  userNotes?: string | null
  description?: string | null
  aspects?: Record<string, string[]> | null
}

export interface AppStatus {
  configured: boolean
  signedIn: boolean
  environment: string
  marketplace: string
  aiProvider: string
  /** Set when the configured AI provider could not be started. */
  aiError: string | null
  /** eBay APIs this application is not entitled to call, with reasons. */
  missingCapabilities: Array<{ capability: string; hint: string }>
}

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skipped'

export interface CheckResult {
  id: string
  label: string
  status: CheckStatus
  detail: string
  hint?: string
}

export const EBAY_CONDITIONS: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'NEW', label: 'Neu' },
  { code: 'NEW_OTHER', label: 'Neu: Sonstige' },
  { code: 'USED_EXCELLENT', label: 'Gebraucht: Sehr gut' },
  { code: 'USED_GOOD', label: 'Gebraucht: Gut' },
  { code: 'USED_ACCEPTABLE', label: 'Gebraucht: Akzeptabel' },
  { code: 'FOR_PARTS_OR_NOT_WORKING', label: 'Defekt / Ersatzteile' },
]

export const STATE_LABELS: Record<ProductState, string> = {
  [ProductState.Scanned]: 'Gescannt',
  [ProductState.Enriching]: 'Wird ermittelt…',
  [ProductState.NeedsInfo]: 'Info benötigt',
  [ProductState.Ready]: 'Bereit',
  [ProductState.Posting]: 'Wird eingestellt…',
  [ProductState.Posted]: 'Eingestellt',
  [ProductState.Failed]: 'Fehler',
}
