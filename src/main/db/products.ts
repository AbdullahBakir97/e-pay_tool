/** Repository for products and their photos. */

import { randomUUID } from 'node:crypto'

import { DataSource, ProductState, type Photo, type PriceStats, type Product } from '@shared/types'

import { transaction, type Db, type SqlValue } from './schema'

export function newSku(): string {
  return `EP-${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`
}

interface ProductRow {
  id: number
  sku: string
  state: string
  source: string | null
  gtin: string | null
  epid: string | null
  title: string | null
  brand: string | null
  mpn: string | null
  condition: string | null
  category_id: string | null
  aspects: string | null
  description: string | null
  user_notes: string | null
  price: number | null
  currency: string
  quantity: number
  price_stats: string | null
  ai_questions: string | null
  ai_suggestions: string | null
  ai_confidence: string | null
  offer_id: string | null
  listing_id: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

interface PhotoRow {
  id: number
  product_id: number
  path: string
  ebay_url: string | null
  position: number
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function toPhoto(row: PhotoRow): Photo {
  return {
    id: row.id,
    productId: row.product_id,
    path: row.path,
    ebayUrl: row.ebay_url,
    position: row.position,
  }
}

function toProduct(row: ProductRow, photos: Photo[]): Product {
  return {
    id: row.id,
    sku: row.sku,
    state: row.state as ProductState,
    source: row.source as DataSource | null,
    gtin: row.gtin,
    epid: row.epid,
    title: row.title,
    brand: row.brand,
    mpn: row.mpn,
    condition: row.condition,
    categoryId: row.category_id,
    aspects: parseJson<Record<string, string[]>>(row.aspects),
    description: row.description,
    userNotes: row.user_notes,
    price: row.price,
    currency: row.currency,
    quantity: row.quantity,
    priceStats: parseJson<PriceStats>(row.price_stats),
    aiQuestions: parseJson<string[]>(row.ai_questions),
    aiSuggestions: parseJson<string[]>(row.ai_suggestions),
    aiConfidence: parseJson<Record<string, number>>(row.ai_confidence),
    offerId: row.offer_id,
    listingId: row.listing_id,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    photos,
  }
}

/** Columns the pipeline and the UI may write, mapped to SQL column names. */
const WRITABLE_COLUMNS: Record<string, string> = {
  state: 'state',
  source: 'source',
  gtin: 'gtin',
  epid: 'epid',
  title: 'title',
  brand: 'brand',
  mpn: 'mpn',
  condition: 'condition',
  categoryId: 'category_id',
  aspects: 'aspects',
  description: 'description',
  userNotes: 'user_notes',
  price: 'price',
  currency: 'currency',
  quantity: 'quantity',
  priceStats: 'price_stats',
  aiQuestions: 'ai_questions',
  aiSuggestions: 'ai_suggestions',
  aiConfidence: 'ai_confidence',
  offerId: 'offer_id',
  listingId: 'listing_id',
  lastError: 'last_error',
}

const JSON_FIELDS = new Set([
  'aspects',
  'priceStats',
  'aiQuestions',
  'aiSuggestions',
  'aiConfidence',
])

export type ProductUpdate = Partial<
  Pick<
    Product,
    | 'state'
    | 'source'
    | 'gtin'
    | 'epid'
    | 'title'
    | 'brand'
    | 'mpn'
    | 'condition'
    | 'categoryId'
    | 'aspects'
    | 'description'
    | 'userNotes'
    | 'price'
    | 'currency'
    | 'quantity'
    | 'priceStats'
    | 'aiQuestions'
    | 'aiSuggestions'
    | 'aiConfidence'
    | 'offerId'
    | 'listingId'
    | 'lastError'
  >
>

/** SQLite accepts a narrow set of value types; normalise ours to it. */
function toSqlValue(value: unknown, isJson: boolean): SqlValue {
  if (value === null || value === undefined) return null
  if (isJson) return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'number' || typeof value === 'string') return value
  return String(value)
}

export class ProductRepository {
  constructor(private readonly db: Db) {}

  create(input: { gtin?: string | null; photoPaths?: string[] } = {}): number {
    return transaction(this.db, () => {
      const info = this.db
        .prepare('INSERT INTO products (sku, gtin) VALUES (?, ?)')
        .run(newSku(), input.gtin ?? null)
      const productId = Number(info.lastInsertRowid)

      const insertPhoto = this.db.prepare(
        'INSERT INTO photos (product_id, path, position) VALUES (?, ?, ?)',
      )
      ;(input.photoPaths ?? []).forEach((path, index) => insertPhoto.run(productId, path, index))
      return productId
    })
  }

  get(id: number): Product | null {
    const row = this.db.prepare('SELECT * FROM products WHERE id = ?').get(id) as
      | ProductRow
      | undefined
    if (!row) return null
    return toProduct(row, this.photosFor(id))
  }

  list(limit = 500): Product[] {
    const rows = this.db
      .prepare('SELECT * FROM products ORDER BY created_at DESC, id DESC LIMIT ?')
      .all(limit) as unknown as ProductRow[]
    if (rows.length === 0) return []

    // One query for all photos rather than one per product, so a 500-row
    // grid refresh stays a constant number of statements.
    const photoRows = this.db
      .prepare('SELECT * FROM photos ORDER BY position, id')
      .all() as unknown as PhotoRow[]

    const byProduct = new Map<number, Photo[]>()
    for (const photoRow of photoRows) {
      const list = byProduct.get(photoRow.product_id) ?? []
      list.push(toPhoto(photoRow))
      byProduct.set(photoRow.product_id, list)
    }

    return rows.map((row) => toProduct(row, byProduct.get(row.id) ?? []))
  }

  idsByState(state: ProductState): number[] {
    const rows = this.db
      .prepare('SELECT id FROM products WHERE state = ?')
      .all(state) as unknown as Array<{ id: number }>
    return rows.map((row) => row.id)
  }

  update(id: number, changes: ProductUpdate): void {
    const assignments: string[] = []
    const values: SqlValue[] = []

    for (const [key, value] of Object.entries(changes)) {
      const column = WRITABLE_COLUMNS[key]
      if (!column) continue
      assignments.push(`${column} = ?`)
      values.push(toSqlValue(value, JSON_FIELDS.has(key)))
    }
    if (assignments.length === 0) return

    values.push(id)
    this.db
      .prepare(
        `UPDATE products SET ${assignments.join(', ')}, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(...values)
  }

  setState(id: number, state: ProductState, lastError: string | null = null): void {
    this.update(id, { state, lastError })
  }

  photosFor(productId: number): Photo[] {
    const rows = this.db
      .prepare('SELECT * FROM photos WHERE product_id = ? ORDER BY position, id')
      .all(productId) as unknown as PhotoRow[]
    return rows.map(toPhoto)
  }

  addPhotos(productId: number, paths: string[]): void {
    const offset = this.photosFor(productId).length
    const insert = this.db.prepare(
      'INSERT INTO photos (product_id, path, position) VALUES (?, ?, ?)',
    )
    transaction(this.db, () => {
      paths.forEach((path, index) => insert.run(productId, path, offset + index))
    })
  }

  /** Store eBay-hosted stock images for a product that has no photos yet. */
  addStockPhotos(productId: number, urls: string[]): void {
    const insert = this.db.prepare(
      'INSERT INTO photos (product_id, path, ebay_url, position) VALUES (?, ?, ?, ?)',
    )
    transaction(this.db, () => {
      urls.forEach((url, index) => insert.run(productId, '', url, index))
    })
  }

  setPhotoUrl(photoId: number, url: string): void {
    this.db.prepare('UPDATE photos SET ebay_url = ? WHERE id = ?').run(url, photoId)
  }
}
