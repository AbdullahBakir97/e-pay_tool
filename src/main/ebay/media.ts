/** Image upload to eBay Picture Services (Media API). */

import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

import { mediaBase, type AppConfig } from '@main/config'

import { EbayApiError, type TokenSource } from './client'

const UPLOAD_TIMEOUT_MS = 60_000

/** Upload a local image; returns the eBay-hosted image URL. */
export async function uploadImage(
  config: AppConfig,
  auth: TokenSource,
  path: string,
): Promise<string> {
  const token = await auth.getUserToken()
  const bytes = await readFile(path)

  const form = new FormData()
  form.append('image', new Blob([bytes]), basename(path))

  const response = await fetch(`${mediaBase(config)}/commerce/media/v1/image`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new EbayApiError(
      response.status,
      `Bild-Upload fehlgeschlagen: ${(await response.text()).slice(0, 300)}`,
    )
  }

  // The created image URL comes back either in the body or via Location.
  const text = await response.text()
  if (text) {
    const body = JSON.parse(text) as { imageUrl?: string }
    if (body.imageUrl) return body.imageUrl
  }

  const location = response.headers.get('Location')
  if (!location) {
    throw new EbayApiError(response.status, 'eBay hat keine Bild-URL zurückgegeben.')
  }

  const imageId = location.replace(/\/$/, '').split('/').pop()
  const info = await fetch(`${mediaBase(config)}/commerce/media/v1/image/${imageId}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  })
  const parsed = (await info.json()) as { imageUrl?: string }
  if (!parsed.imageUrl) {
    throw new EbayApiError(info.status, 'eBay hat keine Bild-URL zurückgegeben.')
  }
  return parsed.imageUrl
}
