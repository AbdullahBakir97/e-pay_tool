/**
 * Pre-filled eBay search links for manual price research.
 *
 * The Browse API needs a separate eBay approval that a normal developer
 * account does not get, and the API for *sold* prices is restricted
 * outright. The browser has no such limitation: a sold-and-completed
 * search shows real achieved prices in one click.
 *
 * This is the deliberate fallback for automatic pricing - the app never
 * invents a price it cannot source.
 */

/** eBay site domains per marketplace id. */
const MARKETPLACE_DOMAINS: Record<string, string> = {
  EBAY_DE: 'www.ebay.de',
  EBAY_AT: 'www.ebay.at',
  EBAY_CH: 'www.ebay.ch',
  EBAY_GB: 'www.ebay.co.uk',
  EBAY_US: 'www.ebay.com',
  EBAY_FR: 'www.ebay.fr',
  EBAY_IT: 'www.ebay.it',
  EBAY_ES: 'www.ebay.es',
  EBAY_NL: 'www.ebay.nl',
}

const DEFAULT_DOMAIN = 'www.ebay.de'

export interface MarketSearchInput {
  gtin?: string | null
  title?: string | null
  brand?: string | null
}

/**
 * Builds a sold-listings search URL. Prefers the barcode, which matches
 * far more precisely than words; falls back to brand plus title.
 *
 * Returns null when there is nothing to search for, so callers can hide
 * the button rather than open a useless page.
 */
export function buildMarketSearchUrl(
  product: MarketSearchInput,
  marketplace = 'EBAY_DE',
): string | null {
  const query = searchTerm(product)
  if (!query) return null

  const domain = MARKETPLACE_DOMAINS[marketplace] ?? DEFAULT_DOMAIN
  const params = new URLSearchParams({
    _nkw: query,
    LH_Sold: '1', // completed sales only
    LH_Complete: '1',
    _sop: '13', // newest first, so stale prices do not lead
  })
  return `https://${domain}/sch/i.html?${params}`
}

function searchTerm(product: MarketSearchInput): string | null {
  const gtin = product.gtin?.trim()
  if (gtin) return gtin

  const title = product.title?.trim()
  if (!title) return null

  const brand = product.brand?.trim()
  // Avoid "Apple Apple iPhone" when the title already carries the brand.
  if (brand && !title.toLowerCase().includes(brand.toLowerCase())) {
    return `${brand} ${title}`
  }
  return title
}
