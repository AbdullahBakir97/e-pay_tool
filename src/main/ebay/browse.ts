/** eBay Browse API - market price research for a product. */

import { buildPriceStats } from '@main/core/pricing'
import type { PriceStats } from '@shared/types'

import type { EbayClient } from './client'

const SAMPLE_LIMIT = 50

interface ItemSummary {
  price?: { value?: string; currency?: string; convertedFromValue?: string }
}

/**
 * Collect current asking prices for comparable live listings.
 *
 * Prefers an exact GTIN match; falls back to a keyword search. Note these
 * are *asking* prices - actual sold prices need the Marketplace Insights
 * API (separate eBay approval), which can be plugged in here later
 * without changing anything downstream.
 */
export async function priceResearch(
  client: EbayClient,
  options: { gtin?: string | null; query?: string | null },
): Promise<PriceStats | null> {
  const params: Record<string, string | number> = { limit: SAMPLE_LIMIT }
  if (options.gtin) params.gtin = options.gtin
  else if (options.query) params.q = options.query
  else return null

  const data = await client.get<{ itemSummaries?: ItemSummary[] }>(
    '/buy/browse/v1/item_summary/search',
    { params, token: 'app' },
  )

  const currency = client.config.currency
  const prices: number[] = []
  for (const item of data.itemSummaries ?? []) {
    // Skip foreign-currency listings to keep the statistics comparable.
    if (item.price?.convertedFromValue) continue
    if (item.price?.currency !== currency) continue

    const value = Number(item.price.value)
    if (Number.isFinite(value) && value > 0) prices.push(value)
  }

  return prices.length > 0 ? buildPriceStats(prices, currency) : null
}
