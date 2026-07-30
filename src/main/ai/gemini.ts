/**
 * Google Gemini implementation of the AI provider.
 *
 * Uses JSON response mode and validates every reply with Zod, so a
 * malformed or surprising answer fails loudly here instead of quietly
 * corrupting a listing. The free AI Studio tier is enough for
 * development; production use costs a few euros per month at 100+
 * products/day.
 */

import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'

import { GoogleGenAI, type Part } from '@google/genai'
import type { z } from 'zod'

import type { AppConfig } from '@main/config'

import { COPY_SYSTEM, IDENTIFY_SYSTEM, REVIEW_SYSTEM, identifyUserPrompt } from './prompts'
import type { AIProvider, IdentifyInput } from './provider'
import {
  listingCopySchema,
  listingReviewSchema,
  productIdentificationSchema,
  type ListingCopy,
  type ListingReview,
  type ProductIdentification,
} from './schemas'

const MAX_PHOTOS = 8

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

export class GeminiProvider implements AIProvider {
  private readonly client: GoogleGenAI
  private readonly model: string

  constructor(config: AppConfig) {
    if (!config.geminiApiKey) {
      throw new Error('EPAY_GEMINI_API_KEY is not configured.')
    }
    this.client = new GoogleGenAI({ apiKey: config.geminiApiKey })
    this.model = config.geminiModel
  }

  async identifyProduct(input: IdentifyInput): Promise<ProductIdentification> {
    const imageParts: Part[] = await Promise.all(
      input.photoPaths.slice(0, MAX_PHOTOS).map(async (path) => ({
        inlineData: {
          data: (await readFile(path)).toString('base64'),
          mimeType: MIME_TYPES[extname(path).toLowerCase()] ?? 'image/jpeg',
        },
      })),
    )
    const parts: Part[] = [
      ...imageParts,
      { text: identifyUserPrompt(input.known ?? {}, input.notes ?? null) },
    ]
    return this.generate(parts, IDENTIFY_SYSTEM, productIdentificationSchema)
  }

  async writeCopy(facts: Record<string, unknown>): Promise<ListingCopy> {
    const parts: Part[] = [{ text: `Produktdaten:\n${JSON.stringify(facts, null, 2)}` }]
    return this.generate(parts, COPY_SYSTEM, listingCopySchema)
  }

  async reviewListing(draft: Record<string, unknown>): Promise<ListingReview> {
    const parts: Part[] = [{ text: `Angebotsentwurf:\n${JSON.stringify(draft, null, 2)}` }]
    return this.generate(parts, REVIEW_SYSTEM, listingReviewSchema)
  }

  private async generate<T extends z.ZodTypeAny>(
    parts: Part[],
    systemInstruction: string,
    schema: T,
  ): Promise<z.infer<T>> {
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: [{ role: 'user', parts }],
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        temperature: 0.2,
      },
    })

    const text = response.text
    if (!text) throw new Error('The AI returned an empty response.')

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error(`The AI returned invalid JSON: ${text.slice(0, 200)}`)
    }
    return schema.parse(parsed)
  }
}
