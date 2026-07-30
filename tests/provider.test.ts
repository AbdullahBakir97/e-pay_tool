import { describe, expect, it } from 'vitest'

import { NullProvider, createProvider } from '@main/ai/provider'

import { testConfig } from './helpers'

describe('createProvider', () => {
  it('falls back to the null provider when the API key is missing', async () => {
    // A missing key must not stop the app: barcode lookups go through
    // eBay's catalog and need no AI at all.
    const { provider, error } = await createProvider(
      testConfig({ aiProvider: 'gemini', geminiApiKey: '' }),
    )

    expect(provider).toBeInstanceOf(NullProvider)
    expect(error).toContain('GEMINI_API_KEY')
  })

  it('reports no error when AI is switched off deliberately', async () => {
    const { provider, error } = await createProvider(testConfig({ aiProvider: 'none' }))

    expect(provider).toBeInstanceOf(NullProvider)
    expect(error).toBeNull()
  })

  it('builds a working provider when configured', async () => {
    const { provider, error } = await createProvider(
      testConfig({ aiProvider: 'gemini', geminiApiKey: 'test-key' }),
    )

    expect(error).toBeNull()
    expect(provider).not.toBeInstanceOf(NullProvider)
  })
})

describe('NullProvider', () => {
  it('explains that AI is off instead of silently returning nothing', async () => {
    const identification = await new NullProvider().identifyProduct()
    expect(identification.questions[0]).toMatch(/deaktiviert/)
  })

  it('still produces a usable title and description from known facts', async () => {
    const copy = await new NullProvider().writeCopy({ title: 'Apple iPhone 13' })
    expect(copy.title).toBe('Apple iPhone 13')
    expect(copy.descriptionHtml).toContain('Apple iPhone 13')
  })

  it('caps a long fallback title at the eBay limit', async () => {
    const copy = await new NullProvider().writeCopy({ title: 'x'.repeat(120) })
    expect(copy.title).toHaveLength(80)
  })
})
