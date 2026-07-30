import { describe, expect, it } from 'vitest'

import { buildPriceStats, median, suggestPrice, trimOutliers } from '@main/core/pricing'

describe('median', () => {
  it('handles odd and even sample sizes', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })

  it('rejects an empty sample', () => {
    expect(() => median([])).toThrow()
  })
})

describe('trimOutliers', () => {
  it('drops an accessory listed under the product barcode', () => {
    // A 5-euro phone case must not set the price of a 400-euro phone.
    expect(trimOutliers([5, 380, 400, 420])).toEqual([380, 400, 420])
  })

  it('drops a wholesale bundle', () => {
    expect(trimOutliers([380, 400, 420, 5000])).toEqual([380, 400, 420])
  })

  it('leaves small samples alone, where trimming would be guesswork', () => {
    expect(trimOutliers([5, 400])).toEqual([5, 400])
  })

  it('keeps the raw sample when every value would be trimmed', () => {
    expect(trimOutliers([1, 1, 1, 1])).toEqual([1, 1, 1, 1])
  })
})

describe('buildPriceStats', () => {
  it('reports how many outliers were removed', () => {
    const stats = buildPriceStats([5, 380, 400, 420], 'EUR')
    expect(stats.minimum).toBe(380)
    expect(stats.median).toBe(400)
    expect(stats.outliersRemoved).toBe(1)
    expect(stats.sampleSize).toBe(3)
  })

  it('rejects an empty sample', () => {
    expect(() => buildPriceStats([], 'EUR')).toThrow(/empty sample/)
  })
})

describe('suggestPrice', () => {
  it('undercuts the median', () => {
    expect(suggestPrice(buildPriceStats([90, 100, 110], 'EUR'), 10)).toBe(90)
  })

  it('never goes below the cheapest comparable listing', () => {
    const stats = buildPriceStats([380, 400, 400, 420], 'EUR')
    expect(suggestPrice(stats, 90)).toBe(380)
  })

  it('rounds to whole cents', () => {
    const stats = buildPriceStats([99.99, 100.01, 100.0], 'EUR')
    expect(Number.isInteger(suggestPrice(stats, 3) * 100)).toBe(true)
  })
})
