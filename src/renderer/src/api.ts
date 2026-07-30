/** Typed handle on the preload bridge. */

import type { EpayApi } from '@shared/ipc'

declare global {
  interface Window {
    epay: EpayApi
  }
}

export const api: EpayApi = window.epay
