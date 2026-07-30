import { describe, expect, it } from 'vitest'

import { checkDraft, hasBlockers } from '@main/core/quality'
import type { AspectRequirement } from '@main/ebay/taxonomy'
import type { Photo, Product } from '@shared/types'

type Draft = Parameters<typeof checkDraft>[0]

function photo(id: number, path = `/tmp/${id}.jpg`): Photo {
  return { id, productId: 1, path, ebayUrl: null, position: id }
}

function completeDraft(overrides: Partial<Product> = {}): Draft {
  return {
    title: 'Apple iPhone 13 128GB Schwarz',
    price: 399,
    categoryId: '9355',
    condition: 'USED_GOOD',
    description: '<p>Guter Zustand</p>',
    aspects: { Marke: ['Apple'] },
    photos: [photo(1), photo(2), photo(3)],
    ...overrides,
  } as Draft
}

describe('checkDraft', () => {
  it('accepts a complete draft', () => {
    expect(hasBlockers(checkDraft(completeDraft()))).toBe(false)
  })

  it('blocks on a missing price and category', () => {
    const issues = checkDraft(completeDraft({ price: null, categoryId: null }))
    expect(hasBlockers(issues)).toBe(true)
    expect(issues.map((i) => i.message)).toEqual(
      expect.arrayContaining([expect.stringContaining('Preis'), expect.stringContaining('Kategorie')]),
    )
  })

  it('blocks a title over the eBay 80-character limit', () => {
    expect(hasBlockers(checkDraft(completeDraft({ title: 'x'.repeat(81) })))).toBe(true)
  })

  it('blocks a zero or negative price', () => {
    expect(hasBlockers(checkDraft(completeDraft({ price: 0 })))).toBe(true)
    expect(hasBlockers(checkDraft(completeDraft({ price: -5 })))).toBe(true)
  })

  it('blocks with no photos but only warns with few photos', () => {
    expect(hasBlockers(checkDraft(completeDraft({ photos: [] })))).toBe(true)

    const issues = checkDraft(completeDraft({ photos: [photo(1)] }))
    expect(hasBlockers(issues)).toBe(false)
    expect(issues.some((i) => i.severity === 'WARNING')).toBe(true)
  })

  it('warns when a used item has only eBay stock images', () => {
    const stockOnly = completeDraft({
      condition: 'USED_GOOD',
      photos: [{ id: 1, productId: 1, path: '', ebayUrl: 'https://img/1.jpg', position: 0 }],
    })
    const issues = checkDraft(stockOnly)
    expect(hasBlockers(issues)).toBe(false)
    expect(issues.some((i) => i.message.includes('eigene Fotos'))).toBe(true)
  })

  it('does not warn about stock images for new goods', () => {
    const newItem = completeDraft({
      condition: 'NEW',
      photos: [
        { id: 1, productId: 1, path: '', ebayUrl: 'https://img/1.jpg', position: 0 },
        { id: 2, productId: 1, path: '', ebayUrl: 'https://img/2.jpg', position: 1 },
        { id: 3, productId: 1, path: '', ebayUrl: 'https://img/3.jpg', position: 2 },
      ],
    })
    expect(checkDraft(newItem).some((i) => i.message.includes('eigene Fotos'))).toBe(false)
  })

  it('blocks when a category-required aspect is missing', () => {
    const required: AspectRequirement[] = [
      { name: 'Speicherkapazität', required: true, allowedValues: ['128 GB'] },
      { name: 'Farbe', required: false, allowedValues: ['Schwarz'] },
    ]
    expect(hasBlockers(checkDraft(completeDraft(), required))).toBe(true)

    const filled = completeDraft({
      aspects: { Marke: ['Apple'], 'Speicherkapazität': ['128 GB'] },
    })
    expect(hasBlockers(checkDraft(filled, required))).toBe(false)
  })

  it('treats an empty aspect array as missing', () => {
    const required: AspectRequirement[] = [
      { name: 'Farbe', required: true, allowedValues: [] },
    ]
    const draft = completeDraft({ aspects: { Farbe: [] } })
    expect(hasBlockers(checkDraft(draft, required))).toBe(true)
  })
})
