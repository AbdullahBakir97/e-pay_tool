/**
 * eBay Catalog API - identify a product from its barcode (GTIN/EAN/UPC).
 *
 * This is the primary enrichment path: for most retail products a single
 * call returns the exact catalog entry with title, brand, aspects and
 * stock images - no AI involved.
 */

import type { EbayClient } from './client'

export const MAX_TITLE_LENGTH = 80

export interface CatalogMatch {
  epid: string
  title: string
  brand: string | null
  mpn: string | null
  imageUrls: string[]
  aspects: Record<string, string[]>
  categoryIds: string[]
}

interface ProductSummary {
  epid?: string
  productId?: string
  title?: string
  brand?: string
  mpn?: string | string[]
  image?: { imageUrl?: string }
  additionalImages?: Array<{ imageUrl?: string }>
  categoryIds?: string[]
  aspects?: Array<{ localizedName?: string; localizedValues?: string[] }>
}

/** The catalog returns the manufacturer part number as a string or a list. */
function firstMpn(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

/** Search the eBay catalog by barcode. Returns the best match or null. */
export async function findByGtin(client: EbayClient, gtin: string): Promise<CatalogMatch | null> {
  const data = await client.get<{ productSummaries?: ProductSummary[] }>(
    '/commerce/catalog/v1/product_summary/search',
    { params: { gtin, limit: 5 }, token: 'app' },
  )

  const best = data.productSummaries?.[0]
  if (!best) return null

  const aspects: Record<string, string[]> = {}
  for (const aspect of best.aspects ?? []) {
    if (aspect.localizedName && aspect.localizedValues?.length) {
      aspects[aspect.localizedName] = aspect.localizedValues
    }
  }

  const imageUrls = [best.image, ...(best.additionalImages ?? [])]
    .map((image) => image?.imageUrl)
    .filter((url): url is string => Boolean(url))

  return {
    epid: best.epid ?? best.productId ?? '',
    title: (best.title ?? '').slice(0, MAX_TITLE_LENGTH),
    brand: best.brand ?? null,
    mpn: firstMpn(best.mpn),
    imageUrls,
    aspects,
    categoryIds: best.categoryIds ?? [],
  }
}
