/**
 * eBay Taxonomy API - category suggestions and required item aspects.
 *
 * The list of *required* aspects for a category is what lets the app
 * decide deterministically whether a draft is complete or must go to
 * NEEDS_INFO.
 */

import type { EbayClient } from './client'

export interface AspectRequirement {
  name: string
  required: boolean
  allowedValues: string[]
}

const MAX_ALLOWED_VALUES = 50

/** The category tree id is per marketplace and never changes; cache it. */
const treeIdCache = new WeakMap<EbayClient, Promise<string>>()

export function clearTaxonomyCache(client: EbayClient): void {
  treeIdCache.delete(client)
}

async function getTreeId(client: EbayClient): Promise<string> {
  const cached = treeIdCache.get(client)
  if (cached) return cached

  const pending = client
    .get<{ categoryTreeId: string }>('/commerce/taxonomy/v1/get_default_category_tree_id', {
      params: { marketplace_id: client.config.ebayMarketplace },
      token: 'app',
    })
    .then((data) => data.categoryTreeId)
    .catch((error: unknown) => {
      // Do not cache a failure: the next enrichment should retry.
      treeIdCache.delete(client)
      throw error
    })

  treeIdCache.set(client, pending)
  return pending
}

/** Best [categoryId, categoryName] suggestion for a product title. */
export async function suggestCategory(
  client: EbayClient,
  query: string,
): Promise<[string, string] | null> {
  const treeId = await getTreeId(client)
  const data = await client.get<{
    categorySuggestions?: Array<{ category?: { categoryId?: string; categoryName?: string } }>
  }>(`/commerce/taxonomy/v1/category_tree/${treeId}/get_category_suggestions`, {
    params: { q: query },
    token: 'app',
  })

  const category = data.categorySuggestions?.[0]?.category
  if (!category?.categoryId) return null
  return [category.categoryId, category.categoryName ?? '']
}

export async function aspectsForCategory(
  client: EbayClient,
  categoryId: string,
): Promise<AspectRequirement[]> {
  const treeId = await getTreeId(client)
  const data = await client.get<{
    aspects?: Array<{
      localizedAspectName?: string
      aspectConstraint?: { aspectRequired?: boolean }
      aspectValues?: Array<{ localizedValue?: string }>
    }>
  }>(`/commerce/taxonomy/v1/category_tree/${treeId}/get_item_aspects_for_category`, {
    params: { category_id: categoryId },
    token: 'app',
  })

  return (data.aspects ?? [])
    .filter((aspect) => aspect.localizedAspectName)
    .map((aspect) => ({
      name: aspect.localizedAspectName as string,
      required: aspect.aspectConstraint?.aspectRequired ?? false,
      allowedValues: (aspect.aspectValues ?? [])
        .slice(0, MAX_ALLOWED_VALUES)
        .map((value) => value.localizedValue ?? '')
        .filter(Boolean),
    }))
}
