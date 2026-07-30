/**
 * Product enrichment and publishing pipeline.
 *
 * Enrichment per product:
 *
 *   1. Barcode -> eBay Catalog API (exact match: title, brand, aspects, EPID)
 *   2. No match + photos -> AI identification (with questions on uncertainty)
 *   3. Category + required aspects via Taxonomy API
 *   4. Market price research via Browse API -> price suggestion
 *   5. Missing title/description -> AI copywriting
 *   6. Deterministic quality check -> READY or NEEDS_INFO
 *
 * Each step is defensive: a failing product records its error and moves
 * to FAILED instead of taking a 100-item batch down with it.
 */

import type { AIProvider } from '@main/ai/provider'
import { confidenceMap, confidentAspects, confidentFields } from '@main/ai/schemas'
import type { AppConfig } from '@main/config'
import type { ProductRepository, ProductUpdate } from '@main/db/products'
import { priceResearch } from '@main/ebay/browse'
import type { CatalogMatch } from '@main/ebay/catalog'
import type { Capability } from '@main/ebay/capabilities'
import { findByGtin } from '@main/ebay/catalog'
import { asCapabilityError, type EbayClient } from '@main/ebay/client'
import type { TokenSource } from '@main/ebay/client'
import { createOrUpdateOffer, publishOffer, upsertInventoryItem } from '@main/ebay/inventory'
import { uploadImage } from '@main/ebay/media'
import type { AspectRequirement } from '@main/ebay/taxonomy'
import { aspectsForCategory, suggestCategory } from '@main/ebay/taxonomy'
import { DataSource, ProductState, type Product } from '@shared/types'

import { suggestPrice } from './pricing'
import { checkDraft, hasBlockers } from './quality'

const MAX_STOCK_PHOTOS = 12
const MAX_TITLE_LENGTH = 80

export interface PipelineDeps {
  config: AppConfig
  client: EbayClient
  auth: TokenSource
  ai: AIProvider
  repo: ProductRepository
  logger?: Pick<Console, 'warn' | 'error'>
}

export class Pipeline {
  private readonly config: AppConfig
  private readonly client: EbayClient
  private readonly auth: TokenSource
  private readonly ai: AIProvider
  private readonly repo: ProductRepository
  private readonly logger: Pick<Console, 'warn' | 'error'>
  private readonly unavailable = new Set<Capability>()

  constructor(deps: PipelineDeps) {
    this.config = deps.config
    this.client = deps.client
    this.auth = deps.auth
    this.ai = deps.ai
    this.repo = deps.repo
    this.logger = deps.logger ?? console
  }

  // ---------------- enrichment ----------------

  async enrich(productId: number): Promise<void> {
    const product = this.repo.get(productId)
    if (!product) return

    this.repo.setState(productId, ProductState.Enriching, null)

    try {
      const changes = await this.buildEnrichment(product)
      this.repo.update(productId, changes)

      const updated = this.repo.get(productId)
      if (!updated) return

      const issues = await this.finalCheck(updated)
      const needsInfo = hasBlockers(issues) || Boolean(updated.aiQuestions?.length)
      this.repo.setState(productId, needsInfo ? ProductState.NeedsInfo : ProductState.Ready, null)
    } catch (error) {
      this.logger.error(`Enrichment failed for product ${productId}`, error)
      this.repo.setState(productId, ProductState.Failed, describeError(error))
    }
  }

  private async buildEnrichment(product: Product): Promise<ProductUpdate> {
    const changes: ProductUpdate = {}
    const current = (): Product => ({ ...product, ...changes } as Product)

    if (!product.condition) {
      changes.condition = this.config.defaultCondition
    }

    // 1. Catalog lookup by barcode. A missing entitlement is not a
    //    product failure - it just means this step cannot contribute.
    const gtin = product.gtin
    if (gtin && !product.title) {
      const match = await this.optional('catalog', () => findByGtin(this.client, gtin))
      if (match) this.applyCatalog(product, match, changes)
    }

    // 2. AI fallback from photos.
    if (!changes.title && !product.title && product.photos.length > 0) {
      await this.applyAiIdentification(product, changes)
    }

    // 3. Category + required aspects.
    const title = changes.title ?? product.title
    if (!product.categoryId && !changes.categoryId && title) {
      const suggestion = await this.optional('taxonomy', () =>
        suggestCategory(this.client, title),
      )
      if (suggestion) changes.categoryId = suggestion[0]
    }

    // 4. Price research.
    if (product.price === null) {
      const stats = await this.optional('browse', () =>
        priceResearch(this.client, { gtin: product.gtin, query: title }),
      )
      if (stats) {
        changes.priceStats = stats
        changes.price = suggestPrice(stats, this.config.undercutPercent)
      }
    }

    // 5. Copywriting.
    if (title && !product.description) {
      const source = current()
      const facts = pruneEmpty({
        title,
        brand: source.brand,
        mpn: source.mpn,
        condition: source.condition,
        aspects: source.aspects,
        notes: source.userNotes,
      })
      const copy = await this.ai.writeCopy(facts)
      changes.description = copy.descriptionHtml

      // A catalog title is the exact wording eBay holds for this EPID.
      // Rewriting it would contradict the catalog entry the listing is
      // linked to, so the AI only retitles products it identified itself.
      if (changes.source !== DataSource.Catalog && product.source !== DataSource.Catalog) {
        changes.title = copy.title.slice(0, MAX_TITLE_LENGTH)
      }
    }

    return changes
  }

  /**
   * Runs an enrichment step that the application may not be entitled to
   * call. A missing entitlement yields null and is recorded once for the
   * whole session; every other error still propagates and fails the
   * product, because that is a genuine fault worth showing.
   */
  private async optional<T>(capability: Capability, step: () => Promise<T>): Promise<T | null> {
    if (this.unavailable.has(capability)) return null
    try {
      return await step()
    } catch (error) {
      const unavailable = asCapabilityError(error, capability)
      if (!unavailable) throw error

      if (!this.unavailable.has(capability)) {
        this.unavailable.add(capability)
        this.logger.warn(`eBay capability unavailable: ${capability}`, unavailable.message)
      }
      return null
    }
  }

  /** Capabilities eBay has refused during this session. */
  get missingCapabilities(): Capability[] {
    return [...this.unavailable]
  }

  private applyCatalog(product: Product, match: CatalogMatch, changes: ProductUpdate): void {
    changes.source = DataSource.Catalog
    changes.epid = match.epid
    changes.title = match.title
    changes.brand = match.brand ?? product.brand
    changes.mpn = match.mpn ?? product.mpn
    changes.aspects = { ...match.aspects, ...(product.aspects ?? {}) }
    if (match.categoryIds.length > 0 && !product.categoryId) {
      changes.categoryId = match.categoryIds[0] as string
    }

    // Catalog images are already eBay-hosted, so they need no upload and
    // make a barcode-only scan directly listable for new goods.
    if (product.photos.length === 0 && match.imageUrls.length > 0) {
      this.repo.addStockPhotos(product.id, match.imageUrls.slice(0, MAX_STOCK_PHOTOS))
    }
  }

  private async applyAiIdentification(product: Product, changes: ProductUpdate): Promise<void> {
    const known = pruneEmpty({ gtin: product.gtin, brand: product.brand }) as Record<string, string>

    const identification = await this.ai.identifyProduct({
      photoPaths: product.photos.map((photo) => photo.path).filter(Boolean),
      known,
      notes: product.userNotes,
    })

    changes.source = DataSource.Ai

    const fields = confidentFields(identification)
    if (fields.productName) {
      changes.title = buildTitle(fields).slice(0, MAX_TITLE_LENGTH)
    }
    changes.brand = fields.brand ?? product.brand
    // Only confident values may reach the listing; an uncertain model guess
    // becomes a question to the user instead of a fabricated part number.
    changes.mpn = product.mpn ?? fields.model ?? null
    changes.aspects = { ...confidentAspects(identification), ...(product.aspects ?? {}) }
    changes.aiQuestions = identification.questions.length ? identification.questions : null
    changes.aiSuggestions = identification.photoSuggestions.length
      ? identification.photoSuggestions
      : null
    changes.aiConfidence = confidenceMap(identification)
  }

  private async finalCheck(product: Product): Promise<ReturnType<typeof checkDraft>> {
    let required: AspectRequirement[] = []
    if (product.categoryId) {
      try {
        required = await aspectsForCategory(this.client, product.categoryId)
      } catch (error) {
        // A taxonomy hiccup must not fail the product; it only means the
        // required-aspect check is skipped for this pass.
        this.logger.warn('Could not load required aspects', error)
      }
    }
    return checkDraft(product, required)
  }

  // ---------------- publishing ----------------

  /** Upload photos, create the offer and publish it - the "one click". */
  async publish(
    productId: number,
    policies: { fulfillment: string; payment: string; return: string },
  ): Promise<void> {
    const product = this.repo.get(productId)
    if (!product) return

    this.repo.setState(productId, ProductState.Posting, null)

    try {
      const imageUrls: string[] = []
      for (const photo of product.photos) {
        if (photo.ebayUrl) {
          imageUrls.push(photo.ebayUrl)
          continue
        }
        const url = await uploadImage(this.config, this.auth, photo.path)
        this.repo.setPhotoUrl(photo.id, url)
        imageUrls.push(url)
      }

      await upsertInventoryItem(this.client, product, imageUrls)
      const offerId = await createOrUpdateOffer(this.client, product, {
        fulfillmentPolicyId: policies.fulfillment,
        paymentPolicyId: policies.payment,
        returnPolicyId: policies.return,
      })
      const listingId = await publishOffer(this.client, offerId)

      this.repo.update(productId, {
        offerId,
        listingId,
        state: ProductState.Posted,
        lastError: null,
      })
    } catch (error) {
      this.logger.error(`Publishing failed for product ${productId}`, error)
      this.repo.setState(productId, ProductState.Failed, describeError(error))
    }
  }
}

function buildTitle(fields: { productName?: string; brand?: string; model?: string }): string {
  const parts = [fields.brand, fields.productName, fields.model].filter(Boolean) as string[]
  // Drop duplicate words, e.g. brand repeated inside the product name.
  const seen = new Set<string>()
  const words: string[] = []
  for (const word of parts.join(' ').split(/\s+/)) {
    const key = word.toLowerCase()
    if (word && !seen.has(key)) {
      seen.add(key)
      words.push(word)
    }
  }
  return words.join(' ')
}

function pruneEmpty(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== null && value !== undefined && value !== ''),
  )
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
