/**
 * Deterministic completeness checks for a listing draft.
 *
 * These rules (not the AI) decide whether a product is READY or
 * NEEDS_INFO. The AI adds *soft* suggestions on top; hard requirements
 * are code, so the app's behaviour is reproducible and testable.
 */

import type { Issue, Product } from '@shared/types'
import type { AspectRequirement } from '@main/ebay/taxonomy'

export const MAX_TITLE_LENGTH = 80
export const RECOMMENDED_MIN_PHOTOS = 3

export function checkDraft(
  product: Pick<
    Product,
    'title' | 'price' | 'categoryId' | 'condition' | 'description' | 'aspects' | 'photos'
  >,
  requiredAspects: AspectRequirement[] = [],
): Issue[] {
  const issues: Issue[] = []

  if (!product.title) {
    issues.push({ severity: 'BLOCKER', message: 'Titel fehlt.' })
  } else if (product.title.length > MAX_TITLE_LENGTH) {
    issues.push({
      severity: 'BLOCKER',
      message: `Titel ist länger als ${MAX_TITLE_LENGTH} Zeichen.`,
    })
  }

  if (product.price === null || product.price === undefined || product.price <= 0) {
    issues.push({ severity: 'BLOCKER', message: 'Preis fehlt.' })
  }
  if (!product.categoryId) {
    issues.push({ severity: 'BLOCKER', message: 'Kategorie fehlt.' })
  }
  if (!product.condition) {
    issues.push({ severity: 'BLOCKER', message: 'Artikelzustand fehlt.' })
  }
  if (!product.description) {
    issues.push({ severity: 'WARNING', message: 'Beschreibung fehlt.' })
  }

  const photoCount = product.photos.length
  const ownPhotos = product.photos.filter((p) => p.path)
  if (photoCount === 0) {
    issues.push({ severity: 'BLOCKER', message: 'Mindestens ein Foto wird benötigt.' })
  } else if (photoCount < RECOMMENDED_MIN_PHOTOS) {
    issues.push({
      severity: 'WARNING',
      message: `Nur ${photoCount} Foto(s) – empfohlen sind alle Seiten des Artikels.`,
    })
  }

  // Stock images may not represent a used item's actual condition.
  if (product.condition && product.condition !== 'NEW' && ownPhotos.length === 0) {
    issues.push({
      severity: 'WARNING',
      message: 'Gebrauchtartikel ohne eigene Fotos – bitte echte Fotos des Artikels ergänzen.',
    })
  }

  const aspects = product.aspects ?? {}
  for (const requirement of requiredAspects) {
    if (requirement.required && !aspects[requirement.name]?.length) {
      issues.push({ severity: 'BLOCKER', message: `Pflichtangabe fehlt: ${requirement.name}` })
    }
  }

  return issues
}

export function hasBlockers(issues: Issue[]): boolean {
  return issues.some((issue) => issue.severity === 'BLOCKER')
}
