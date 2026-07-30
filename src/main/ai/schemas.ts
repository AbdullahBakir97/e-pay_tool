/**
 * Structured AI output contracts.
 *
 * Every AI call returns JSON validated against these schemas. Per-field
 * confidence plus explicit open questions is what turns the AI from a
 * guesser into an assistant that *asks* when it cannot know (e.g. an
 * iPhone photographed only from the front).
 */

import { z } from 'zod'

export const CONFIDENCE_THRESHOLD = 0.8

export const fieldGuessSchema = z.object({
  value: z.string(),
  /** 0 = pure guess, 1 = certain. */
  confidence: z.number().min(0).max(1),
})

export type FieldGuess = z.infer<typeof fieldGuessSchema>

export const productIdentificationSchema = z.object({
  productName: fieldGuessSchema.nullable().optional(),
  brand: fieldGuessSchema.nullable().optional(),
  model: fieldGuessSchema.nullable().optional(),
  /** Short product category, e.g. 'Smartphone', 'Herren-Sneaker'. */
  categoryHint: z.string().nullable().optional(),
  /** Item specifics such as Farbe, Größe, Speicherkapazität. */
  aspects: z.record(fieldGuessSchema).default({}),
  /** Visible condition, e.g. 'gebraucht, Kratzer am Gehäuse'. */
  conditionHint: z.string().nullable().optional(),
  /** Questions for anything the photos cannot answer. */
  questions: z.array(z.string()).default([]),
  /** Concrete suggestions for additional/better photos. */
  photoSuggestions: z.array(z.string()).default([]),
})

export type ProductIdentification = z.infer<typeof productIdentificationSchema>

export const listingCopySchema = z.object({
  /** eBay title, max 80 characters, keyword-rich. */
  title: z.string().max(80),
  /** Clean HTML description in German. */
  descriptionHtml: z.string(),
})

export type ListingCopy = z.infer<typeof listingCopySchema>

export const listingReviewSchema = z.object({
  issues: z.array(z.string()).default([]),
  suggestions: z.array(z.string()).default([]),
})

export type ListingReview = z.infer<typeof listingReviewSchema>

/**
 * Fields safe to auto-fill. Anything below the threshold is deliberately
 * dropped so it becomes a question to the user instead of a fabricated
 * value in a live listing.
 */
export function confidentFields(
  identification: ProductIdentification,
  threshold = CONFIDENCE_THRESHOLD,
): { productName?: string; brand?: string; model?: string } {
  const result: { productName?: string; brand?: string; model?: string } = {}
  const entries = [
    ['productName', identification.productName],
    ['brand', identification.brand],
    ['model', identification.model],
  ] as const

  for (const [key, guess] of entries) {
    if (guess && guess.confidence >= threshold) {
      result[key] = guess.value
    }
  }
  return result
}

/** Confident item specifics, in the shape eBay expects. */
export function confidentAspects(
  identification: ProductIdentification,
  threshold = CONFIDENCE_THRESHOLD,
): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  for (const [name, guess] of Object.entries(identification.aspects)) {
    if (guess.confidence >= threshold) {
      result[name] = [guess.value]
    }
  }
  return result
}

/** Every confidence score, kept so the UI can show how sure the AI was. */
export function confidenceMap(identification: ProductIdentification): Record<string, number> {
  const result: Record<string, number> = {}
  const named: Array<[string, FieldGuess | null | undefined]> = [
    ['productName', identification.productName],
    ['brand', identification.brand],
    ['model', identification.model],
  ]
  for (const [name, guess] of named) {
    if (guess) result[name] = guess.confidence
  }
  for (const [name, guess] of Object.entries(identification.aspects)) {
    result[name] = guess.confidence
  }
  return result
}
