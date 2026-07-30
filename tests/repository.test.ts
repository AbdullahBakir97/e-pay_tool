import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ProductRepository } from '@main/db/products'
import type { Db } from '@main/db/schema'
import { ProductState } from '@shared/types'

import { testDb } from './helpers'

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

describe('ProductRepository', () => {
  it('creates a product with a unique SKU', () => {
    const first = repo.get(repo.create({ gtin: '111' }))
    const second = repo.get(repo.create({ gtin: '222' }))

    expect(first?.sku).toMatch(/^EP-[0-9A-F]{12}$/)
    expect(first?.sku).not.toBe(second?.sku)
    expect(first?.state).toBe(ProductState.Scanned)
  })

  it('round-trips JSON columns', () => {
    const id = repo.create({ gtin: '111' })
    repo.update(id, {
      aspects: { Farbe: ['Schwarz'] },
      aiQuestions: ['Bitte Rückseite fotografieren.'],
      aiConfidence: { brand: 0.9 },
      priceStats: {
        minimum: 1,
        median: 2,
        maximum: 3,
        sampleSize: 3,
        currency: 'EUR',
        outliersRemoved: 0,
      },
    })

    const product = repo.get(id)
    expect(product?.aspects).toEqual({ Farbe: ['Schwarz'] })
    expect(product?.aiQuestions).toEqual(['Bitte Rückseite fotografieren.'])
    expect(product?.aiConfidence).toEqual({ brand: 0.9 })
    expect(product?.priceStats?.median).toBe(2)
  })

  it('clears a JSON column when set to null', () => {
    const id = repo.create()
    repo.update(id, { aiQuestions: ['offen'] })
    repo.update(id, { aiQuestions: null })
    expect(repo.get(id)?.aiQuestions).toBeNull()
  })

  it('ignores unknown keys instead of building broken SQL', () => {
    const id = repo.create()
    expect(() =>
      repo.update(id, { title: 'ok', notAColumn: 'x' } as never),
    ).not.toThrow()
    expect(repo.get(id)?.title).toBe('ok')
  })

  it('stores photos in order and keeps stock images separate from own photos', () => {
    const id = repo.create({ photoPaths: ['/a.jpg', '/b.jpg'] })
    repo.addPhotos(id, ['/c.jpg'])

    const photos = repo.get(id)?.photos ?? []
    expect(photos.map((p) => p.path)).toEqual(['/a.jpg', '/b.jpg', '/c.jpg'])
    expect(photos.map((p) => p.position)).toEqual([0, 1, 2])

    const stockId = repo.create({ gtin: '999' })
    repo.addStockPhotos(stockId, ['https://img/1.jpg'])
    const stock = repo.get(stockId)?.photos ?? []
    expect(stock[0]?.path).toBe('')
    expect(stock[0]?.ebayUrl).toBe('https://img/1.jpg')
  })

  it('lists products newest first with their photos attached', () => {
    const first = repo.create({ gtin: '111', photoPaths: ['/a.jpg'] })
    const second = repo.create({ gtin: '222' })

    const listed = repo.list()
    expect(listed.map((p) => p.id)).toEqual([second, first])
    expect(listed[1]?.photos).toHaveLength(1)
    expect(listed[0]?.photos).toHaveLength(0)
  })

  it('finds ids by state', () => {
    const ready = repo.create({ gtin: '111' })
    repo.create({ gtin: '222' })
    repo.setState(ready, ProductState.Ready)

    expect(repo.idsByState(ProductState.Ready)).toEqual([ready])
  })

  it('deletes photos along with their product', () => {
    const id = repo.create({ photoPaths: ['/a.jpg'] })
    db.prepare('DELETE FROM products WHERE id = ?').run(id)

    const orphans = db.prepare('SELECT COUNT(*) AS n FROM photos').get() as { n: number }
    expect(orphans.n).toBe(0)
  })

  it('records the eBay URL after an upload', () => {
    const id = repo.create({ photoPaths: ['/a.jpg'] })
    const photo = repo.get(id)?.photos[0]
    repo.setPhotoUrl(photo?.id as number, 'https://img/uploaded.jpg')

    expect(repo.get(id)?.photos[0]?.ebayUrl).toBe('https://img/uploaded.jpg')
  })
})
