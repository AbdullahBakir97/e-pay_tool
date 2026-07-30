/**
 * Price suggestion from market data.
 *
 * A GTIN search on eBay returns more than the product itself: phone cases
 * listed under the phone's barcode, broken units, multi-packs. Those
 * outliers are trimmed before any statistic is computed, otherwise a
 * single 5-euro accessory drags the suggested price for a 400-euro phone
 * down.
 */

import type { PriceStats } from '@shared/types'

// Kept wide on purpose: only obvious non-comparables are removed, and the
// median is robust enough to absorb the rest.
export const LOW_FACTOR = 0.25
export const HIGH_FACTOR = 4.0
export const MIN_SAMPLE_FOR_TRIM = 4

export function median(values: number[]): number {
  if (values.length === 0) throw new Error('Cannot take the median of an empty sample.')
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2 : (sorted[mid] as number)
}

/** Drop prices far away from the median of the raw sample. */
export function trimOutliers(
  prices: number[],
  lowFactor = LOW_FACTOR,
  highFactor = HIGH_FACTOR,
): number[] {
  const sorted = [...prices].sort((a, b) => a - b)
  if (sorted.length < MIN_SAMPLE_FOR_TRIM) return sorted

  const anchor = median(sorted)
  if (anchor <= 0) return sorted

  const kept = sorted.filter((p) => p >= lowFactor * anchor && p <= highFactor * anchor)
  return kept.length > 0 ? kept : sorted
}

export function buildPriceStats(prices: number[], currency: string): PriceStats {
  if (prices.length === 0) {
    throw new Error('Cannot build price statistics from an empty sample.')
  }
  const kept = trimOutliers(prices)
  return {
    minimum: Math.min(...kept),
    median: median(kept),
    maximum: Math.max(...kept),
    sampleSize: kept.length,
    currency,
    outliersRemoved: prices.length - kept.length,
  }
}

/**
 * Slightly undercut the median asking price, never below the cheapest.
 *
 * The median (not the mean) is the anchor so that remaining outliers
 * barely move the result; the floor at the cheapest comparable listing
 * keeps an aggressive undercut setting from suggesting a loss-making
 * price.
 */
export function suggestPrice(stats: PriceStats, undercutPercent = 3.0): number {
  const candidate = stats.median * (1 - undercutPercent / 100)
  return Math.round(Math.max(candidate, stats.minimum) * 100) / 100
}
