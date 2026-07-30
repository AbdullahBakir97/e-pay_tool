import { describe, expect, it } from 'vitest'

import { findByGtin } from '@main/ebay/catalog'

import { FakeEbayClient, testConfig } from './helpers'

const SUMMARY_RESPONSE = {
  productSummaries: [
    {
      epid: '24053414',
      title: 'Apple iPhone 13 128GB Midnight',
      brand: 'Apple',
      mpn: ['MLPF3ZD/A'],
      image: { imageUrl: 'https://img/1.jpg' },
      additionalImages: [{ imageUrl: 'https://img/2.jpg' }],
      categoryIds: ['9355'],
      aspects: [
        { localizedName: 'Farbe', localizedValues: ['Midnight'] },
        { localizedName: 'Speicherkapazität', localizedValues: ['128 GB'] },
      ],
    },
  ],
}

describe('findByGtin', () => {
  it('parses a catalog match', async () => {
    const client = new FakeEbayClient(testConfig(), {
      'product_summary/search': SUMMARY_RESPONSE,
    })
    const match = await findByGtin(client.asClient(), '0194252707975')

    expect(match).not.toBeNull()
    expect(match?.epid).toBe('24053414')
    expect(match?.brand).toBe('Apple')
    expect(match?.mpn).toBe('MLPF3ZD/A')
    expect(match?.categoryIds).toEqual(['9355'])
    expect(match?.aspects['Speicherkapazität']).toEqual(['128 GB'])
    expect(match?.imageUrls).toEqual(['https://img/1.jpg', 'https://img/2.jpg'])
  })

  it('returns null when the catalog has no entry', async () => {
    const client = new FakeEbayClient(testConfig(), {
      'product_summary/search': { productSummaries: [] },
    })
    expect(await findByGtin(client.asClient(), '0000000000000')).toBeNull()
  })

  it('accepts a plain string mpn as well as a list', async () => {
    const client = new FakeEbayClient(testConfig(), {
      'product_summary/search': { productSummaries: [{ title: 'X', mpn: 'ABC-1' }] },
    })
    expect((await findByGtin(client.asClient(), '1'))?.mpn).toBe('ABC-1')
  })

  it('truncates an over-long catalog title to the eBay limit', async () => {
    const client = new FakeEbayClient(testConfig(), {
      'product_summary/search': { productSummaries: [{ title: 'A'.repeat(120) }] },
    })
    expect((await findByGtin(client.asClient(), '1'))?.title).toHaveLength(80)
  })

  it('sends the barcode as a gtin query and uses the app token', async () => {
    const client = new FakeEbayClient(testConfig(), {
      'product_summary/search': SUMMARY_RESPONSE,
    })
    await findByGtin(client.asClient(), '0194252707975')

    expect(client.calls[0]?.options.params?.gtin).toBe('0194252707975')
    expect(client.calls[0]?.options.token).toBe('app')
  })
})
