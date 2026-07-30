import { describe, expect, it } from 'vitest'

import { buildMarketSearchUrl } from '@main/core/marketLink'

describe('buildMarketSearchUrl', () => {
  it('prefers the barcode, which matches far more precisely than words', () => {
    const url = buildMarketSearchUrl({ gtin: '0194252707975', title: 'Apple iPhone 13' })
    expect(url).toContain('_nkw=0194252707975')
  })

  it('asks for completed sales, so the seller sees achieved prices', () => {
    const url = buildMarketSearchUrl({ gtin: '123' }) as string
    expect(url).toContain('LH_Sold=1')
    expect(url).toContain('LH_Complete=1')
  })

  const term = (url: string | null): string | null =>
    url === null ? null : new URL(url).searchParams.get('_nkw')

  it('falls back to brand plus title without a barcode', () => {
    const url = buildMarketSearchUrl({ gtin: null, brand: 'Nike', title: 'Air Zoom Pegasus' })
    expect(term(url)).toBe('Nike Air Zoom Pegasus')
  })

  it('does not repeat a brand the title already contains', () => {
    const url = buildMarketSearchUrl({ brand: 'Apple', title: 'Apple iPhone 13' })
    expect(term(url)).toBe('Apple iPhone 13')
  })

  it('uses the right eBay site per marketplace', () => {
    expect(buildMarketSearchUrl({ gtin: '1' }, 'EBAY_DE')).toContain('www.ebay.de')
    expect(buildMarketSearchUrl({ gtin: '1' }, 'EBAY_AT')).toContain('www.ebay.at')
    // An unknown marketplace must still produce a usable link.
    expect(buildMarketSearchUrl({ gtin: '1' }, 'EBAY_XX')).toContain('www.ebay.de')
  })

  it('encodes characters that would otherwise break the URL', () => {
    const url = buildMarketSearchUrl({ title: 'Küche & Bad 50%' }) as string
    expect(() => new URL(url)).not.toThrow()
    // The ampersand must not be read as another query parameter.
    expect(new URL(url).searchParams.get('_nkw')).toBe('Küche & Bad 50%')
  })

  it('returns null when there is nothing to search for', () => {
    expect(buildMarketSearchUrl({})).toBeNull()
    expect(buildMarketSearchUrl({ gtin: '  ', title: '  ' })).toBeNull()
  })
})
