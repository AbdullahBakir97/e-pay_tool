/** End-to-end pipeline behaviour with fake eBay + AI backends. */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { productIdentificationSchema } from '@main/ai/schemas'
import { Pipeline } from '@main/core/pipeline'
import type { ProductRepository } from '@main/db/products'
import type { Db } from '@main/db/schema'
import type { TokenSource } from '@main/ebay/client'
import { DataSource, ProductState } from '@shared/types'

import {
  FakeAI,
  FakeEbayClient,
  silentLogger,
  testConfig,
  testDb,
  type CannedResponses,
} from './helpers'

const CATALOG_HIT = {
  productSummaries: [
    {
      epid: '24053414',
      title: 'Apple iPhone 13 128GB Midnight',
      brand: 'Apple',
      image: { imageUrl: 'https://img/1.jpg' },
      categoryIds: ['9355'],
      aspects: [{ localizedName: 'Farbe', localizedValues: ['Midnight'] }],
    },
  ],
}
const CATALOG_MISS = { productSummaries: [] }
const BROWSE_HIT = {
  itemSummaries: [
    { price: { value: '400.00', currency: 'EUR' } },
    { price: { value: '420.00', currency: 'EUR' } },
    { price: { value: '380.00', currency: 'EUR' } },
  ],
}
const TREE = { categoryTreeId: '77' }
const SUGGESTIONS = {
  categorySuggestions: [{ category: { categoryId: '9355', categoryName: 'Handys' } }],
}
const NO_REQUIRED_ASPECTS = { aspects: [] }

const BASE_RESPONSES: CannedResponses = {
  'product_summary/search': CATALOG_HIT,
  'item_summary/search': BROWSE_HIT,
  get_default_category_tree_id: TREE,
  get_category_suggestions: SUGGESTIONS,
  get_item_aspects_for_category: NO_REQUIRED_ASPECTS,
}

const fakeAuth: TokenSource = {
  getUserToken: async () => 'user-token',
  getAppToken: async () => 'app-token',
}

let db: Db
let repo: ProductRepository

beforeEach(() => {
  const context = testDb()
  db = context.db
  repo = context.repo
})

afterEach(() => {
  db.close()
})

function buildPipeline(
  responses: CannedResponses = BASE_RESPONSES,
  ai = new FakeAI(),
  client = new FakeEbayClient(testConfig(), responses),
): { pipeline: Pipeline; ai: FakeAI; client: FakeEbayClient } {
  const pipeline = new Pipeline({
    config: testConfig(),
    client: client.asClient(),
    auth: fakeAuth,
    ai,
    repo,
    logger: silentLogger,
  })
  return { pipeline, ai, client }
}

describe('enrichment via the eBay catalog', () => {
  it('turns a barcode into a ready listing without calling the AI', async () => {
    const { pipeline, ai } = buildPipeline()
    const id = repo.create({ gtin: '0194252707975' })

    await pipeline.enrich(id)

    const product = repo.get(id)
    expect(product?.state).toBe(ProductState.Ready)
    expect(product?.source).toBe(DataSource.Catalog)
    expect(product?.brand).toBe('Apple')
    expect(product?.categoryId).toBe('9355')
    expect(product?.condition).toBe('NEW') // default applied
    expect(product?.price).toBeCloseTo(388.0) // median 400 minus 3%
    expect(product?.photos.map((p) => p.ebayUrl)).toEqual(['https://img/1.jpg'])
    // The catalog answered everything, so identification never ran.
    expect(ai.identifyCalls).toHaveLength(0)
  })

  it('keeps the exact catalog title and only generates the description', async () => {
    // Rewriting a catalog title would contradict the EPID the listing is
    // linked to, so the AI must not retitle a catalog match.
    const ai = new FakeAI(undefined, {
      title: 'Umgeschriebener Titel',
      descriptionHtml: '<p>Beschreibung</p>',
    })
    const { pipeline } = buildPipeline(BASE_RESPONSES, ai)
    const id = repo.create({ gtin: '0194252707975' })

    await pipeline.enrich(id)

    const product = repo.get(id)
    expect(product?.title).toBe('Apple iPhone 13 128GB Midnight')
    expect(product?.description).toBe('<p>Beschreibung</p>')
  })

  it('leaves the price unset and asks for info when there is no market data', async () => {
    const { pipeline } = buildPipeline({
      ...BASE_RESPONSES,
      'item_summary/search': { itemSummaries: [] },
    })
    const id = repo.create({ gtin: '0194252707975' })

    await pipeline.enrich(id)

    const product = repo.get(id)
    expect(product?.price).toBeNull()
    expect(product?.state).toBe(ProductState.NeedsInfo) // missing price is a blocker
  })

  it('ignores foreign-currency listings when pricing', async () => {
    const { pipeline } = buildPipeline({
      ...BASE_RESPONSES,
      'item_summary/search': {
        itemSummaries: [
          { price: { value: '400.00', currency: 'EUR' } },
          { price: { value: '10.00', currency: 'USD' } },
          { price: { value: '420.00', currency: 'EUR', convertedFromValue: '450.00' } },
        ],
      },
    })
    const id = repo.create({ gtin: '0194252707975' })

    await pipeline.enrich(id)

    expect(repo.get(id)?.priceStats?.sampleSize).toBe(1)
  })
})

describe('AI fallback when the catalog misses', () => {
  it('uses confident AI fields to build the listing', async () => {
    const ai = new FakeAI(
      productIdentificationSchema.parse({
        productName: { value: 'iPhone 13', confidence: 0.95 },
        brand: { value: 'Apple', confidence: 0.97 },
        model: { value: 'A2633', confidence: 0.9 },
        aspects: { Farbe: { value: 'Schwarz', confidence: 0.92 } },
      }),
      { title: 'Apple iPhone 13 128GB Schwarz', descriptionHtml: '<p>x</p>' },
    )
    const { pipeline } = buildPipeline(
      { ...BASE_RESPONSES, 'product_summary/search': CATALOG_MISS },
      ai,
    )
    const id = repo.create({ gtin: '0000000000000', photoPaths: ['/tmp/front.jpg'] })

    await pipeline.enrich(id)

    const product = repo.get(id)
    expect(product?.source).toBe(DataSource.Ai)
    expect(product?.brand).toBe('Apple')
    expect(product?.mpn).toBe('A2633')
    expect(product?.aspects?.Farbe).toEqual(['Schwarz'])
    expect(product?.categoryId).toBe('9355')
    expect(product?.state).toBe(ProductState.Ready)
    expect(ai.identifyCalls).toHaveLength(1)
    // Here the AI *may* retitle: the title is its own work, not the catalog's.
    expect(product?.title).toBe('Apple iPhone 13 128GB Schwarz')
  })

  it('asks a question instead of guessing when the photo cannot show the model', async () => {
    // The iPhone-from-the-front case.
    const ai = new FakeAI(
      productIdentificationSchema.parse({
        brand: { value: 'Apple', confidence: 0.98 },
        model: { value: 'iPhone 12 oder 13', confidence: 0.3 },
        questions: ['Bitte die Rückseite fotografieren, um das Modell zu bestimmen.'],
        photoSuggestions: ['Foto der Rückseite', 'Foto der Seriennummer'],
      }),
    )
    const { pipeline } = buildPipeline(
      { ...BASE_RESPONSES, 'product_summary/search': CATALOG_MISS },
      ai,
    )
    const id = repo.create({ photoPaths: ['/tmp/front.jpg'] })

    await pipeline.enrich(id)

    const product = repo.get(id)
    expect(product?.state).toBe(ProductState.NeedsInfo)
    expect(product?.aiQuestions).toEqual([
      'Bitte die Rückseite fotografieren, um das Modell zu bestimmen.',
    ])
    expect(product?.aiSuggestions).toHaveLength(2)
    // A 0.3-confidence guess must not reach the listing...
    expect(product?.mpn).toBeNull()
    expect(product?.title ?? '').not.toContain('iPhone 12 oder 13')
    // ...but the score is kept so the UI can show how sure the AI was.
    expect(product?.aiConfidence?.model).toBe(0.3)
  })

  it('does not call the AI when there are no photos to look at', async () => {
    const { pipeline, ai } = buildPipeline({
      ...BASE_RESPONSES,
      'product_summary/search': CATALOG_MISS,
    })
    const id = repo.create({ gtin: '0000000000000' })

    await pipeline.enrich(id)

    expect(ai.identifyCalls).toHaveLength(0)
    expect(repo.get(id)?.state).toBe(ProductState.NeedsInfo)
  })

  it('passes the barcode and the seller notes to the AI as context', async () => {
    const { pipeline, ai } = buildPipeline({
      ...BASE_RESPONSES,
      'product_summary/search': CATALOG_MISS,
    })
    const id = repo.create({ gtin: '123', photoPaths: ['/tmp/a.jpg'] })
    repo.update(id, { userNotes: 'Karton fehlt' })

    await pipeline.enrich(id)

    expect(ai.identifyCalls[0]?.known).toEqual({ gtin: '123' })
    expect(ai.identifyCalls[0]?.notes).toBe('Karton fehlt')
  })
})

describe('required aspects', () => {
  it('moves a product to NEEDS_INFO when a required aspect is missing', async () => {
    const { pipeline } = buildPipeline({
      ...BASE_RESPONSES,
      get_item_aspects_for_category: {
        aspects: [
          {
            localizedAspectName: 'Speicherkapazität',
            aspectConstraint: { aspectRequired: true },
            aspectValues: [{ localizedValue: '128 GB' }],
          },
        ],
      },
    })
    const id = repo.create({ gtin: '0194252707975' })

    await pipeline.enrich(id)

    expect(repo.get(id)?.state).toBe(ProductState.NeedsInfo)
  })

  it('still publishes-ready when the taxonomy lookup itself fails', async () => {
    // A taxonomy hiccup must not fail the product outright.
    const client = new FakeEbayClient(testConfig(), BASE_RESPONSES)
    const original = client.request.bind(client)
    client.request = async (method, path, options) => {
      if (path.includes('get_item_aspects_for_category')) throw new Error('taxonomy down')
      return original(method, path, options)
    }

    const { pipeline } = buildPipeline(BASE_RESPONSES, new FakeAI(), client)
    const id = repo.create({ gtin: '0194252707975' })

    await pipeline.enrich(id)

    expect(repo.get(id)?.state).toBe(ProductState.Ready)
  })
})

describe('failure handling', () => {
  it('marks a product FAILED without throwing, so a batch keeps going', async () => {
    const client = new FakeEbayClient(testConfig(), BASE_RESPONSES)
    client.request = async () => {
      throw new Error('eBay down')
    }
    const { pipeline } = buildPipeline(BASE_RESPONSES, new FakeAI(), client)
    const id = repo.create({ gtin: '123' })

    await expect(pipeline.enrich(id)).resolves.toBeUndefined()

    const product = repo.get(id)
    expect(product?.state).toBe(ProductState.Failed)
    expect(product?.lastError).toContain('eBay down')
  })

  it('clears the old error on a successful retry', async () => {
    let failing = true
    const client = new FakeEbayClient(testConfig(), BASE_RESPONSES)
    const original = client.request.bind(client)
    client.request = async (method, path, options) => {
      if (failing) throw new Error('temporary outage')
      return original(method, path, options)
    }

    const { pipeline } = buildPipeline(BASE_RESPONSES, new FakeAI(), client)
    const id = repo.create({ gtin: '0194252707975' })

    await pipeline.enrich(id)
    expect(repo.get(id)?.state).toBe(ProductState.Failed)

    failing = false
    await pipeline.enrich(id)

    const product = repo.get(id)
    expect(product?.state).toBe(ProductState.Ready)
    expect(product?.lastError).toBeNull()
  })

  it('does nothing for an unknown product id', async () => {
    const { pipeline } = buildPipeline()
    await expect(pipeline.enrich(9999)).resolves.toBeUndefined()
  })
})

describe('publishing', () => {
  const PUBLISH_RESPONSES: CannedResponses = {
    ...BASE_RESPONSES,
    '/sell/inventory/v1/offer': { offerId: 'OFFER-1' },
    'OFFER-1/publish': { listingId: 'LISTING-1' },
  }

  it('reuses eBay-hosted stock images instead of uploading them', async () => {
    const client = new FakeEbayClient(testConfig(), PUBLISH_RESPONSES)
    const { pipeline } = buildPipeline(PUBLISH_RESPONSES, new FakeAI(), client)

    const id = repo.create({ gtin: '0194252707975' })
    await pipeline.enrich(id)
    await pipeline.publish(id, { fulfillment: 'F', payment: 'P', return: 'R' })

    const product = repo.get(id)
    expect(product?.state).toBe(ProductState.Posted)
    expect(product?.offerId).toBe('OFFER-1')
    expect(product?.listingId).toBe('LISTING-1')

    const inventoryCall = client.calls.find((call) =>
      call.path.includes('/sell/inventory/v1/inventory_item/'),
    )
    const body = inventoryCall?.options.body as { product: { imageUrls: string[] } }
    expect(body.product.imageUrls).toEqual(['https://img/1.jpg'])
  })

  it('records a publishing failure without losing the draft', async () => {
    const client = new FakeEbayClient(testConfig(), PUBLISH_RESPONSES)
    const { pipeline } = buildPipeline(PUBLISH_RESPONSES, new FakeAI(), client)

    const id = repo.create({ gtin: '0194252707975' })
    await pipeline.enrich(id)

    client.request = async () => {
      throw new Error('Angebot abgelehnt')
    }
    await pipeline.publish(id, { fulfillment: 'F', payment: 'P', return: 'R' })

    const product = repo.get(id)
    expect(product?.state).toBe(ProductState.Failed)
    expect(product?.lastError).toContain('Angebot abgelehnt')
    expect(product?.title).toBe('Apple iPhone 13 128GB Midnight') // draft intact
  })
})
