/**
 * Optional local AI provider via Ollama (offline / zero cost).
 *
 * Quality of fine-grained product identification is below Gemini - this
 * is a fallback mode, not the default. Requires a running Ollama server
 * with a vision-capable model (e.g. `ollama pull qwen2.5vl`).
 */

import { readFile } from 'node:fs/promises'

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

const MAX_PHOTOS = 4
const REQUEST_TIMEOUT_MS = 300_000

export class OllamaProvider implements AIProvider {
  private readonly url: string
  private readonly model: string

  constructor(config: AppConfig) {
    this.url = config.ollamaUrl.replace(/\/$/, '')
    this.model = config.ollamaModel
  }

  async identifyProduct(input: IdentifyInput): Promise<ProductIdentification> {
    const images = await Promise.all(
      input.photoPaths
        .slice(0, MAX_PHOTOS)
        .map(async (path) => (await readFile(path)).toString('base64')),
    )
    const prompt = `${IDENTIFY_SYSTEM}\n\n${identifyUserPrompt(
      input.known ?? {},
      input.notes ?? null,
    )}`
    return this.generate(prompt, productIdentificationSchema, images)
  }

  async writeCopy(facts: Record<string, unknown>): Promise<ListingCopy> {
    return this.generate(
      `${COPY_SYSTEM}\n\nProduktdaten:\n${JSON.stringify(facts)}`,
      listingCopySchema,
    )
  }

  async reviewListing(draft: Record<string, unknown>): Promise<ListingReview> {
    return this.generate(
      `${REVIEW_SYSTEM}\n\nEntwurf:\n${JSON.stringify(draft)}`,
      listingReviewSchema,
    )
  }

  private async generate<T extends z.ZodTypeAny>(
    prompt: string,
    schema: T,
    images?: string[],
  ): Promise<z.infer<T>> {
    const response = await fetch(`${this.url}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt,
        format: 'json',
        stream: false,
        ...(images?.length ? { images } : {}),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    if (!response.ok) {
      throw new Error(`Ollama request failed (${response.status}): ${await response.text()}`)
    }
    const body = (await response.json()) as { response?: string }
    if (!body.response) throw new Error('Ollama returned an empty response.')
    return schema.parse(JSON.parse(body.response))
  }
}
