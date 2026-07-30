/**
 * Which eBay APIs this application is actually allowed to call.
 *
 * A normal developer account gets the Sell APIs and Taxonomy. The
 * Catalog API needs an extra OAuth scope, and the Browse API needs a
 * separate approval from eBay that can take days or be declined. Rather
 * than discovering that one product at a time, the app probes once and
 * degrades knowingly.
 */

import { findByGtin } from './catalog'
import { asCapabilityError, type EbayClient } from './client'

export type Capability = 'catalog' | 'browse' | 'taxonomy'

export type CapabilityMap = Record<Capability, boolean>

/** A GTIN that exists in the production catalog, used only as a probe. */
const PROBE_GTIN = '0194252707975'

export const ALL_AVAILABLE: CapabilityMap = { catalog: true, browse: true, taxonomy: true }

export interface CapabilityReport {
  available: CapabilityMap
  /** Human-readable reason per unavailable capability. */
  reasons: Partial<Record<Capability, string>>
}

/**
 * Probes each read-only API once. Network or server errors are treated
 * as "available": a temporary outage must not permanently disable a
 * feature for the whole session.
 */
export async function detectCapabilities(client: EbayClient): Promise<CapabilityReport> {
  const available: CapabilityMap = { ...ALL_AVAILABLE }
  const reasons: Partial<Record<Capability, string>> = {}

  const probes: Array<[Capability, () => Promise<unknown>]> = [
    ['taxonomy', () => import('./taxonomy').then((m) => m.suggestCategory(client, 'Test'))],
    ['catalog', () => findByGtin(client, PROBE_GTIN)],
    [
      'browse',
      () => import('./browse').then((m) => m.priceResearch(client, { gtin: PROBE_GTIN })),
    ],
  ]

  for (const [capability, probe] of probes) {
    try {
      await probe()
    } catch (error) {
      const unavailable = asCapabilityError(error, capability)
      if (unavailable) {
        available[capability] = false
        reasons[capability] = unavailable.message
      }
      // Anything else (timeout, 500, no results) leaves the capability on.
    }
  }

  return { available, reasons }
}

/** German explanation shown to the user for a missing capability. */
export const CAPABILITY_HINTS: Record<Capability, string> = {
  catalog:
    'Katalog-Zugriff fehlt: Barcodes können nicht automatisch aufgelöst werden. ' +
    'Im eBay-Entwicklerkonto den Scope "commerce.catalog.readonly" für die ' +
    'Anwendung freischalten lassen.',
  browse:
    'Marktpreis-Abfrage nicht freigeschaltet: Preise müssen manuell gesetzt werden. ' +
    'Der Button „Marktpreise prüfen“ öffnet die passende eBay-Suche. Für die ' +
    'automatische Variante ist eine Freigabe der Buy-APIs über das eBay Partner ' +
    'Network nötig.',
  taxonomy:
    'Kategorie-Dienst nicht erreichbar: Kategorien und Pflichtangaben müssen ' +
    'manuell gepflegt werden.',
}
