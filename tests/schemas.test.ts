import { describe, expect, it } from 'vitest'

import {
  confidenceMap,
  confidentAspects,
  confidentFields,
  listingCopySchema,
  productIdentificationSchema,
} from '@main/ai/schemas'

describe('confidentFields', () => {
  it('keeps confident values and drops uncertain ones', () => {
    const identification = productIdentificationSchema.parse({
      productName: { value: 'iPhone 13', confidence: 0.95 },
      brand: { value: 'Apple', confidence: 0.99 },
      // A front photo genuinely cannot show the model number.
      model: { value: 'A2633', confidence: 0.2 },
    })

    expect(confidentFields(identification)).toEqual({
      productName: 'iPhone 13',
      brand: 'Apple',
    })
  })

  it('honours a custom threshold', () => {
    const identification = productIdentificationSchema.parse({
      brand: { value: 'Apple', confidence: 0.5 },
    })
    expect(confidentFields(identification, 0.4).brand).toBe('Apple')
    expect(confidentFields(identification, 0.6).brand).toBeUndefined()
  })
})

describe('confidentAspects', () => {
  it('returns only confident aspects, in eBay array form', () => {
    const identification = productIdentificationSchema.parse({
      aspects: {
        Farbe: { value: 'Schwarz', confidence: 0.92 },
        'Speicherkapazität': { value: '128 GB', confidence: 0.4 },
      },
    })
    expect(confidentAspects(identification)).toEqual({ Farbe: ['Schwarz'] })
  })
})

describe('confidenceMap', () => {
  it('keeps every score, including the rejected ones', () => {
    const identification = productIdentificationSchema.parse({
      brand: { value: 'Apple', confidence: 0.98 },
      model: { value: 'iPhone 12 oder 13', confidence: 0.3 },
      aspects: { Farbe: { value: 'Schwarz', confidence: 0.7 } },
    })
    expect(confidenceMap(identification)).toEqual({
      brand: 0.98,
      model: 0.3,
      Farbe: 0.7,
    })
  })
})

describe('schema validation', () => {
  it('rejects a confidence outside 0..1', () => {
    expect(() =>
      productIdentificationSchema.parse({ brand: { value: 'x', confidence: 1.5 } }),
    ).toThrow()
  })

  it('rejects a title over the eBay limit', () => {
    expect(() =>
      listingCopySchema.parse({ title: 'x'.repeat(81), descriptionHtml: '<p>x</p>' }),
    ).toThrow()
  })

  it('defaults the optional collections so callers never see undefined', () => {
    const parsed = productIdentificationSchema.parse({})
    expect(parsed.aspects).toEqual({})
    expect(parsed.questions).toEqual([])
    expect(parsed.photoSuggestions).toEqual([])
  })
})
