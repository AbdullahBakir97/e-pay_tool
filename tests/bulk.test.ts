/** Bulk behaviour: a large batch must finish without losing or blocking items. */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Pipeline } from '@main/core/pipeline'
import { TaskQueue } from '@main/core/queue'
import type { ProductRepository } from '@main/db/products'
import type { Db } from '@main/db/schema'
import type { TokenSource } from '@main/ebay/client'
import { ProductState } from '@shared/types'

import { FakeAI, FakeEbayClient, silentLogger, testConfig, testDb } from './helpers'

const BATCH_SIZE = 60
const POISON_GTIN = '6666666666666'

const RESPONSES = {
  'product_summary/search': {
    productSummaries: [
      {
        epid: '1',
        title: 'Testprodukt',
        brand: 'Marke',
        image: { imageUrl: 'https://img/1.jpg' },
        categoryIds: ['9355'],
      },
    ],
  },
  'item_summary/search': {
    itemSummaries: [
      { price: { value: '100.00', currency: 'EUR' } },
      { price: { value: '110.00', currency: 'EUR' } },
      { price: { value: '90.00', currency: 'EUR' } },
    ],
  },
  get_default_category_tree_id: { categoryTreeId: '77' },
  get_item_aspects_for_category: { aspects: [] },
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

function buildPipeline(client: FakeEbayClient): Pipeline {
  return new Pipeline({
    config: testConfig(),
    client: client.asClient(),
    auth: fakeAuth,
    ai: new FakeAI(),
    repo,
    logger: silentLogger,
  })
}

describe('bulk enrichment', () => {
  it('enriches a 60-item batch completely', async () => {
    const pipeline = buildPipeline(new FakeEbayClient(testConfig(), RESPONSES))
    const ids = Array.from({ length: BATCH_SIZE }, (_, index) =>
      repo.create({ gtin: String(index).padStart(13, '0') }),
    )

    // Same bounded parallelism the app uses.
    const queue = new TaskQueue(4)
    await queue.runAll(ids.map((id) => () => pipeline.enrich(id)))

    const states = ids.map((id) => repo.get(id)?.state)
    expect(states).toHaveLength(BATCH_SIZE)
    expect(states.every((state) => state === ProductState.Ready)).toBe(true)
  })

  it('keeps going when one item fails', async () => {
    const client = new FakeEbayClient(testConfig(), RESPONSES)
    const original = client.request.bind(client)
    client.request = async (method, path, options) => {
      if (options?.params?.gtin === POISON_GTIN) {
        throw new Error('eBay rejected this request')
      }
      return original(method, path, options)
    }

    const pipeline = buildPipeline(client)
    const goodIds = Array.from({ length: 10 }, (_, index) =>
      repo.create({ gtin: String(index).padStart(13, '0') }),
    )
    const poisonId = repo.create({ gtin: POISON_GTIN })

    const queue = new TaskQueue(4)
    await queue.runAll([...goodIds, poisonId].map((id) => () => pipeline.enrich(id)))

    expect(repo.get(poisonId)?.state).toBe(ProductState.Failed)
    expect(goodIds.every((id) => repo.get(id)?.state === ProductState.Ready)).toBe(true)
  })

  it('holds concurrent writers to the configured limit', async () => {
    let inFlight = 0
    let peak = 0

    const client = new FakeEbayClient(testConfig(), RESPONSES)
    const original = client.request.bind(client)
    client.request = async (method, path, options) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight -= 1
      return original(method, path, options)
    }

    const pipeline = buildPipeline(client)
    const ids = Array.from({ length: 20 }, (_, index) =>
      repo.create({ gtin: String(index).padStart(13, '0') }),
    )

    const queue = new TaskQueue(4)
    await queue.runAll(ids.map((id) => () => pipeline.enrich(id)))

    // Four pipelines in flight, each issuing one request at a time.
    expect(peak).toBeLessThanOrEqual(4)
    expect(ids.every((id) => repo.get(id)?.state === ProductState.Ready)).toBe(true)
  })
})
