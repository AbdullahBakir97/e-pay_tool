/**
 * Connection diagnostics.
 *
 * Answers "is the app talking to eBay correctly?" as a sequence of small
 * checks, each proving exactly one thing and each carrying an actionable
 * hint when it fails. Ordered by dependency: a failure early on makes the
 * later checks meaningless, so they are skipped rather than reported as
 * broken.
 *
 * Everything here is read-only. The write test lives in its own export
 * and is never run automatically.
 */

import { isConfigured, type AppConfig } from '@main/config'
import type { PolicyIds } from '@shared/types'

import { CATALOG_SCOPES, type EbayAuth } from './auth'
import { asCapabilityError, type EbayClient } from './client'
import { findByGtin } from './catalog'
import { priceResearch } from './browse'
import { MERCHANT_LOCATION_KEY, listPolicies } from './inventory'
import { suggestCategory } from './taxonomy'

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skipped'

export interface CheckResult {
  id: string
  label: string
  status: CheckStatus
  detail: string
  /** Concrete next step, shown when the check did not pass. */
  hint?: string
}

export interface DiagnosticsDeps {
  config: AppConfig
  auth: Pick<EbayAuth, 'hasUserConsent' | 'getAppToken'>
  client: EbayClient
  policyIds: PolicyIds
}

/** A GTIN that exists in the production catalog, used only as a probe. */
const PROBE_GTIN = '0194252707975'

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export async function runDiagnostics(deps: DiagnosticsDeps): Promise<CheckResult[]> {
  const { config, auth, client, policyIds } = deps
  const results: CheckResult[] = []

  // ---- 1. Configuration -------------------------------------------------
  const configured = isConfigured(config)
  results.push({
    id: 'config',
    label: 'Zugangsdaten hinterlegt',
    status: configured ? 'ok' : 'fail',
    detail: configured
      ? `Umgebung: ${config.ebayEnv}, Marktplatz: ${config.ebayMarketplace}`
      : 'App-ID, Cert-ID oder RuName fehlen.',
    hint: configured
      ? undefined
      : 'Bitte .env nach dem Vorbild von .env.example ausfüllen und die App neu starten.',
  })

  if (!configured) {
    return [...results, ...skipRemaining(['app-token', 'taxonomy', 'catalog', 'browse'])]
  }

  // ---- 2. Application token --------------------------------------------
  let appTokenOk = false
  try {
    await auth.getAppToken()
    appTokenOk = true
    results.push({
      id: 'app-token',
      label: 'Anwendungs-Token (App-ID / Cert-ID)',
      status: 'ok',
      detail: 'Token erfolgreich abgerufen.',
    })
  } catch (error) {
    results.push({
      id: 'app-token',
      label: 'Anwendungs-Token (App-ID / Cert-ID)',
      status: 'fail',
      detail: describe(error),
      hint:
        'App-ID und Cert-ID prüfen. Achtung: Sandbox- und Produktiv-Schlüssel sind ' +
        'verschieden und dürfen nicht gemischt werden.',
    })
  }

  if (!appTokenOk) {
    return [...results, ...skipRemaining(['taxonomy', 'catalog', 'browse'])]
  }

  // ---- 3. Taxonomy ------------------------------------------------------
  results.push(
    await check({
      id: 'taxonomy',
      label: 'Kategorie-Dienst (Taxonomy API)',
      run: async () => {
        const suggestion = await suggestCategory(client, 'Apple iPhone')
        return suggestion
          ? `Kategorievorschlag erhalten: ${suggestion[1]} (${suggestion[0]})`
          : 'Erreichbar, aber kein Vorschlag erhalten.'
      },
      hint:
        'Grundzugriff auf die eBay-APIs fehlt oder der Marktplatz ist falsch ' +
        'gesetzt (EPAY_EBAY_MARKETPLACE).',
    }),
  )

  // ---- 4. Catalog (scope-gated) ----------------------------------------
  results.push(
    await check({
      id: 'catalog',
      label: 'Produktkatalog (Catalog API)',
      // Not fatal: without it, barcodes simply cannot be resolved.
      failStatus: 'warn',
      run: async () => {
        // Prove the extra scope is actually granted before searching.
        await deps.auth.getAppToken(CATALOG_SCOPES)
        const match = await findByGtin(client, PROBE_GTIN)
        return match
          ? `Treffer für Test-Barcode: ${match.title}`
          : 'Zugriff möglich, aber kein Treffer für den Test-Barcode ' +
              '(in der Sandbox normal – dort sind kaum Katalogdaten vorhanden).'
      },
      hint:
        'Der Scope "commerce.catalog.readonly" ist für diese Anwendung nicht ' +
        'freigeschaltet. Ohne ihn müssen Artikel über Fotos oder manuell erfasst ' +
        'werden. Freischaltung über einen Support-Fall im eBay-Entwicklerkonto.',
    }),
  )

  // ---- 5. Browse (approval-gated) --------------------------------------
  results.push(
    await check({
      id: 'browse',
      label: 'Marktpreise (Browse API)',
      failStatus: 'warn',
      run: async () => {
        const stats = await priceResearch(client, { gtin: PROBE_GTIN })
        return stats
          ? `Vergleichspreise erhalten: ${stats.sampleSize} Angebote, Median ${stats.median.toFixed(2)} ${stats.currency}`
          : 'Zugriff möglich, aber keine Vergleichsangebote gefunden.'
      },
      hint:
        'Die Buy-APIs sind für diese Anwendung nicht freigegeben. Preise müssen ' +
        'dann manuell gesetzt werden – der Button „Marktpreise prüfen“ öffnet die ' +
        'passende eBay-Suche. Freigabe über das eBay Partner Network beantragen.',
    }),
  )

  // ---- 6. User consent --------------------------------------------------
  const signedIn = auth.hasUserConsent
  results.push({
    id: 'consent',
    label: 'Verkäufer angemeldet',
    status: signedIn ? 'ok' : 'fail',
    detail: signedIn ? 'Zugriffstoken ist gespeichert.' : 'Noch keine eBay-Anmeldung.',
    hint: signedIn
      ? undefined
      : 'Im Hauptfenster auf „Jetzt anmelden“ klicken. Der Verkäufer meldet sich ' +
        'dabei direkt bei eBay an – sein Passwort sieht die Anwendung nie.',
  })

  if (!signedIn) {
    return [...results, ...skipRemaining(['policies', 'location', 'policy-selection'])]
  }

  // ---- 7. Business policies --------------------------------------------
  let policiesAvailable = false
  results.push(
    await check({
      id: 'policies',
      label: 'Verkaufsrichtlinien abrufbar',
      run: async () => {
        const policies = await listPolicies(client)
        const counts =
          `Versand: ${policies.fulfillment.length}, ` +
          `Zahlung: ${policies.payment.length}, ` +
          `Rücknahme: ${policies.return.length}`
        if (!policies.fulfillment.length || !policies.payment.length || !policies.return.length) {
          throw new Error(`Nicht alle Richtlinien vorhanden (${counts}).`)
        }
        policiesAvailable = true
        return counts
      },
      hint:
        'Im eBay-Konto müssen Verkaufsrichtlinien aktiviert und je eine Versand-, ' +
        'Zahlungs- und Rücknahmerichtlinie angelegt sein. ' +
        '(eBay: Mein eBay > Kontoeinstellungen > Verkaufsrichtlinien)',
    }),
  )

  // ---- 8. Merchant location --------------------------------------------
  results.push(
    await check({
      id: 'location',
      label: 'Lagerstandort angelegt',
      failStatus: 'warn',
      run: async () => {
        await client.get(`/sell/inventory/v1/location/${MERCHANT_LOCATION_KEY}`)
        return `Standort "${MERCHANT_LOCATION_KEY}" vorhanden.`
      },
      hint:
        'Ein Lagerstandort ist Voraussetzung für das Einstellen. Er wird beim ' +
        'ersten Veröffentlichen automatisch angelegt.',
    }),
  )

  // ---- 9. Policy selection in the app ----------------------------------
  const selected = Boolean(policyIds.fulfillment && policyIds.payment && policyIds.return)
  results.push({
    id: 'policy-selection',
    label: 'Richtlinien in den Einstellungen gewählt',
    status: selected ? 'ok' : policiesAvailable ? 'fail' : 'skipped',
    detail: selected
      ? 'Versand-, Zahlungs- und Rücknahmerichtlinie sind zugeordnet.'
      : 'Es ist noch keine vollständige Auswahl gespeichert.',
    hint: selected
      ? undefined
      : 'In den Einstellungen je eine Versand-, Zahlungs- und Rücknahmerichtlinie wählen.',
  })

  return results
}

/**
 * Creates a real inventory item and an **unpublished** offer, then
 * deletes both. Proves the whole publishing path without ever putting
 * anything in front of a buyer.
 *
 * Run only on explicit request.
 */
export async function runPublishDryRun(deps: DiagnosticsDeps): Promise<CheckResult[]> {
  const { client, config, policyIds } = deps
  const results: CheckResult[] = []
  const sku = 'EP-DIAGNOSE-TEST'

  if (!policyIds.fulfillment || !policyIds.payment || !policyIds.return) {
    return [
      {
        id: 'dry-run',
        label: 'Testangebot',
        status: 'fail',
        detail: 'Es sind noch nicht alle Richtlinien gewählt.',
        hint: 'Zuerst in den Einstellungen die drei Richtlinien auswählen.',
      },
    ]
  }

  let inventoryCreated = false
  let offerId: string | null = null

  try {
    await client.put(`/sell/inventory/v1/inventory_item/${sku}`, {
      body: {
        condition: 'NEW',
        availability: { shipToLocationAvailability: { quantity: 1 } },
        // No images on purpose: eBay only requires them to *publish*, and
        // this test never publishes. Inventing an image URL here would
        // make the check fail for the wrong reason.
        product: {
          title: 'ePay Tool Verbindungstest (wird sofort gelöscht)',
          description: 'Automatisch erzeugter Testeintrag. Wird nicht veröffentlicht.',
        },
      },
      headers: { 'Content-Language': config.contentLanguage },
    })
    inventoryCreated = true
    results.push({
      id: 'dry-run-inventory',
      label: 'Testartikel anlegen',
      status: 'ok',
      detail: `Artikel "${sku}" wurde angelegt.`,
    })

    const offer = await client.post<{ offerId: string }>('/sell/inventory/v1/offer', {
      body: {
        sku,
        marketplaceId: config.ebayMarketplace,
        format: 'FIXED_PRICE',
        availableQuantity: 1,
        categoryId: await probeCategoryId(client),
        merchantLocationKey: MERCHANT_LOCATION_KEY,
        pricingSummary: { price: { value: '9.99', currency: config.currency } },
        listingPolicies: {
          fulfillmentPolicyId: policyIds.fulfillment,
          paymentPolicyId: policyIds.payment,
          returnPolicyId: policyIds.return,
        },
      },
    })
    offerId = offer.offerId
    results.push({
      id: 'dry-run-offer',
      label: 'Testangebot anlegen (unveröffentlicht)',
      status: 'ok',
      detail:
        `Angebot ${offerId} wurde als Entwurf angelegt. ` +
        'Es wurde NICHT veröffentlicht und ist für Käufer nicht sichtbar.',
    })
  } catch (error) {
    results.push({
      id: offerId === null && inventoryCreated ? 'dry-run-offer' : 'dry-run-inventory',
      label: 'Testangebot anlegen',
      status: 'fail',
      detail: describe(error),
      hint:
        'Die Meldung von eBay zeigt, was fehlt – meist eine Richtlinie, der ' +
        'Lagerstandort oder eine Pflichtangabe der Kategorie.',
    })
  } finally {
    // Clean up in reverse order, whatever happened above.
    results.push(...(await cleanUp(client, sku, offerId, inventoryCreated)))
  }

  return results
}

/**
 * A valid category for the throwaway offer. Asked for rather than
 * hardcoded, because category ids differ per marketplace and an invalid
 * one would fail the test for a reason that has nothing to do with the
 * connection.
 */
async function probeCategoryId(client: EbayClient): Promise<string> {
  try {
    const suggestion = await suggestCategory(client, 'Handy')
    if (suggestion) return suggestion[0]
  } catch {
    // Fall through to the eBay.de mobile phones category.
  }
  return '9355'
}

async function cleanUp(
  client: EbayClient,
  sku: string,
  offerId: string | null,
  inventoryCreated: boolean,
): Promise<CheckResult[]> {
  const removed: string[] = []
  const problems: string[] = []

  if (offerId) {
    try {
      await client.delete(`/sell/inventory/v1/offer/${offerId}`)
      removed.push('Angebot')
    } catch (error) {
      problems.push(`Angebot ${offerId}: ${describe(error)}`)
    }
  }
  if (inventoryCreated) {
    try {
      await client.delete(`/sell/inventory/v1/inventory_item/${sku}`)
      removed.push('Testartikel')
    } catch (error) {
      problems.push(`Artikel ${sku}: ${describe(error)}`)
    }
  }

  if (!removed.length && !problems.length) return []

  return [
    {
      id: 'dry-run-cleanup',
      label: 'Testdaten wieder entfernen',
      status: problems.length ? 'warn' : 'ok',
      detail: problems.length
        ? `Nicht alles konnte entfernt werden: ${problems.join('; ')}`
        : `${removed.join(' und ')} wieder gelöscht.`,
      hint: problems.length
        ? `Bitte den Eintrag "${sku}" im eBay-Konto manuell prüfen und entfernen.`
        : undefined,
    },
  ]
}

interface CheckSpec {
  id: string
  label: string
  run: () => Promise<string>
  hint: string
  /** Status when the call is refused; defaults to a hard failure. */
  failStatus?: CheckStatus
}

async function check(spec: CheckSpec): Promise<CheckResult> {
  try {
    return { id: spec.id, label: spec.label, status: 'ok', detail: await spec.run() }
  } catch (error) {
    // A refused entitlement is an expected, survivable state for some
    // APIs; a timeout or a 500 is a real fault and always reads as such.
    const refused = asCapabilityError(error, spec.id) !== null
    return {
      id: spec.id,
      label: spec.label,
      status: refused ? (spec.failStatus ?? 'fail') : 'fail',
      detail: describe(error),
      hint: spec.hint,
    }
  }
}

function skipRemaining(ids: string[]): CheckResult[] {
  return ids.map((id) => ({
    id,
    label: LABELS[id] ?? id,
    status: 'skipped' as const,
    detail: 'Übersprungen, weil eine vorherige Prüfung fehlgeschlagen ist.',
  }))
}

const LABELS: Record<string, string> = {
  'app-token': 'Anwendungs-Token (App-ID / Cert-ID)',
  taxonomy: 'Kategorie-Dienst (Taxonomy API)',
  catalog: 'Produktkatalog (Catalog API)',
  browse: 'Marktpreise (Browse API)',
  policies: 'Verkaufsrichtlinien abrufbar',
  location: 'Lagerstandort angelegt',
  'policy-selection': 'Richtlinien in den Einstellungen gewählt',
}

/** Plain-text report for pasting into a support request. */
export function formatReport(results: CheckResult[]): string {
  const symbol: Record<CheckStatus, string> = {
    ok: '[ OK ]',
    warn: '[WARN]',
    fail: '[FAIL]',
    skipped: '[ -- ]',
  }
  return results
    .map((result) => {
      const head = `${symbol[result.status]} ${result.label}: ${result.detail}`
      return result.hint && result.status !== 'ok' ? `${head}\n        -> ${result.hint}` : head
    })
    .join('\n')
}
