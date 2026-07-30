/**
 * eBay Inventory API - create drafts and publish listings.
 *
 * Flow per product: inventory item (PUT by SKU) -> offer (price,
 * category, policies) -> publish. Offers stay unpublished until the user
 * clicks "Post", which is exactly the one-click review step of the app.
 */

import type { PolicyOptions, Product } from '@shared/types'

import type { EbayClient } from './client'

export const MERCHANT_LOCATION_KEY = 'DEFAULT_LOCATION'

export interface PublishPolicies {
  fulfillmentPolicyId: string
  paymentPolicyId: string
  returnPolicyId: string
}

/** Create the default merchant location if it does not exist yet. */
export async function ensureLocation(
  client: EbayClient,
  address: { postalCode: string; city: string; country?: string },
): Promise<void> {
  try {
    await client.get(`/sell/inventory/v1/location/${MERCHANT_LOCATION_KEY}`)
    return
  } catch {
    // Not found - fall through and create it.
  }
  await client.post(`/sell/inventory/v1/location/${MERCHANT_LOCATION_KEY}`, {
    body: {
      location: {
        address: {
          postalCode: address.postalCode,
          city: address.city,
          country: address.country ?? 'DE',
        },
      },
      locationTypes: ['WAREHOUSE'],
      merchantLocationStatus: 'ENABLED',
      name: 'Standardstandort',
    },
  })
}

export function buildInventoryItem(product: Product, imageUrls: string[]): Record<string, unknown> {
  const item: Record<string, unknown> = {
    condition: product.condition ?? 'NEW',
    availability: { shipToLocationAvailability: { quantity: product.quantity } },
    product: {
      title: product.title,
      description: product.description ?? product.title,
      imageUrls,
      ...(product.brand ? { brand: product.brand } : {}),
      ...(product.mpn ? { mpn: product.mpn } : {}),
      ...(product.gtin ? { ean: [product.gtin] } : {}),
      ...(product.epid ? { epid: product.epid } : {}),
      ...(product.aspects ? { aspects: product.aspects } : {}),
    },
  }
  return item
}

export async function upsertInventoryItem(
  client: EbayClient,
  product: Product,
  imageUrls: string[],
): Promise<void> {
  await client.put(`/sell/inventory/v1/inventory_item/${product.sku}`, {
    body: buildInventoryItem(product, imageUrls),
    headers: { 'Content-Language': client.config.contentLanguage },
  })
}

/** Create (or update) the offer for a SKU. Returns the offer id. */
export async function createOrUpdateOffer(
  client: EbayClient,
  product: Product,
  policies: PublishPolicies,
): Promise<string> {
  if (product.price === null) {
    throw new Error(`Produkt ${product.sku} hat keinen Preis.`)
  }

  const offer = {
    sku: product.sku,
    marketplaceId: client.config.ebayMarketplace,
    format: 'FIXED_PRICE',
    availableQuantity: product.quantity,
    categoryId: product.categoryId,
    merchantLocationKey: MERCHANT_LOCATION_KEY,
    pricingSummary: {
      price: { value: product.price.toFixed(2), currency: product.currency },
    },
    listingPolicies: {
      fulfillmentPolicyId: policies.fulfillmentPolicyId,
      paymentPolicyId: policies.paymentPolicyId,
      returnPolicyId: policies.returnPolicyId,
    },
  }

  if (product.offerId) {
    await client.put(`/sell/inventory/v1/offer/${product.offerId}`, { body: offer })
    return product.offerId
  }
  const data = await client.post<{ offerId: string }>('/sell/inventory/v1/offer', { body: offer })
  return data.offerId
}

/** Publish the offer. Returns the live eBay listing id. */
export async function publishOffer(client: EbayClient, offerId: string): Promise<string> {
  const data = await client.post<{ listingId: string }>(
    `/sell/inventory/v1/offer/${offerId}/publish`,
  )
  return data.listingId
}

/** Fetch the seller's business policies so the UI can offer a picker. */
export async function listPolicies(client: EbayClient): Promise<PolicyOptions> {
  const marketplaceId = client.config.ebayMarketplace

  const [fulfillment, payment, returns] = await Promise.all([
    client.get<{ fulfillmentPolicies?: Array<{ fulfillmentPolicyId?: string; name?: string }> }>(
      '/sell/account/v1/fulfillment_policy',
      { params: { marketplace_id: marketplaceId } },
    ),
    client.get<{ paymentPolicies?: Array<{ paymentPolicyId?: string; name?: string }> }>(
      '/sell/account/v1/payment_policy',
      { params: { marketplace_id: marketplaceId } },
    ),
    client.get<{ returnPolicies?: Array<{ returnPolicyId?: string; name?: string }> }>(
      '/sell/account/v1/return_policy',
      { params: { marketplace_id: marketplaceId } },
    ),
  ])

  return {
    fulfillment: (fulfillment.fulfillmentPolicies ?? []).map((policy) => ({
      id: policy.fulfillmentPolicyId ?? '',
      name: policy.name ?? '(ohne Namen)',
    })),
    payment: (payment.paymentPolicies ?? []).map((policy) => ({
      id: policy.paymentPolicyId ?? '',
      name: policy.name ?? '(ohne Namen)',
    })),
    return: (returns.returnPolicies ?? []).map((policy) => ({
      id: policy.returnPolicyId ?? '',
      name: policy.name ?? '(ohne Namen)',
    })),
  }
}
