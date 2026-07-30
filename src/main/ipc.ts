/**
 * IPC handlers - the only entry points the renderer can call.
 *
 * Long-running work (enrichment, publishing) is dispatched onto a
 * bounded queue and reported back with a `productsChanged` event, so the
 * renderer never awaits a 100-item batch.
 */

import { BrowserWindow, dialog, ipcMain, shell } from 'electron'

import { isConfigured, type AppConfig } from '@main/config'
import { buildMarketSearchUrl } from '@main/core/marketLink'
import type { Pipeline } from '@main/core/pipeline'
import { checkDraft } from '@main/core/quality'
import type { TaskQueue } from '@main/core/queue'
import type { ProductRepository } from '@main/db/products'
import type { EbayAuth } from '@main/ebay/auth'
import { CAPABILITY_HINTS } from '@main/ebay/capabilities'
import type { EbayClient } from '@main/ebay/client'
import { runDiagnostics, runPublishDryRun } from '@main/ebay/diagnostics'
import { listPolicies } from '@main/ebay/inventory'
import { aspectsForCategory } from '@main/ebay/taxonomy'
import { getPolicyIds, hasCompletePolicies, setPolicyIds } from '@main/prefs'
import { IPC } from '@shared/ipc'
import { ProductState, type PolicyIds, type ProductEdit } from '@shared/types'

export interface IpcDeps {
  config: AppConfig
  repo: ProductRepository
  pipeline: Pipeline
  queue: TaskQueue
  auth: EbayAuth
  client: EbayClient
  /** Why AI is unavailable, if it is; null when the provider started. */
  aiError: string | null
  getWindow: () => BrowserWindow | null
}

export function registerIpcHandlers(deps: IpcDeps): void {
  const { config, repo, pipeline, queue, auth, client, getWindow } = deps

  const notifyChanged = (): void => {
    getWindow()?.webContents.send(IPC.productsChanged)
  }

  /** Runs pipeline work in the background and pushes updates to the UI. */
  const dispatch = (task: () => Promise<void>): void => {
    void queue
      .run(task)
      .catch((error: unknown) => console.error('Background task failed', error))
      .finally(notifyChanged)
    notifyChanged()
  }

  ipcMain.handle(IPC.listProducts, () => repo.list())

  ipcMain.handle(IPC.getProduct, (_event, id: number) => repo.get(id))

  ipcMain.handle(IPC.scanBarcode, (_event, code: string) => {
    const gtin = code.trim()
    if (!gtin) throw new Error('Leerer Barcode.')
    const id = repo.create({ gtin })
    dispatch(() => pipeline.enrich(id))
    return id
  })

  ipcMain.handle(IPC.createFromPhotos, (_event, paths: string[]) => {
    const id = repo.create({ photoPaths: paths })
    dispatch(() => pipeline.enrich(id))
    return id
  })

  ipcMain.handle(IPC.updateProduct, (_event, id: number, edit: ProductEdit) => {
    // Answering the AI's questions clears them; the pipeline may raise new
    // ones on the next pass.
    repo.update(id, { ...edit, aiQuestions: null })
    notifyChanged()
  })

  ipcMain.handle(IPC.addPhotos, (_event, id: number, paths: string[]) => {
    repo.addPhotos(id, paths)
    notifyChanged()
  })

  ipcMain.handle(IPC.enrichProduct, (_event, id: number) => {
    dispatch(() => pipeline.enrich(id))
  })

  ipcMain.handle(IPC.publishProduct, (_event, id: number) => {
    const policies = requirePolicies()
    dispatch(() => pipeline.publish(id, policies))
  })

  ipcMain.handle(IPC.publishAllReady, () => {
    const policies = requirePolicies()
    const ids = repo.idsByState(ProductState.Ready)
    for (const id of ids) {
      dispatch(() => pipeline.publish(id, policies))
    }
    return ids.length
  })

  ipcMain.handle(IPC.checkProduct, async (_event, id: number) => {
    const product = repo.get(id)
    if (!product) return []
    if (!product.categoryId) return checkDraft(product)
    try {
      return checkDraft(product, await aspectsForCategory(client, product.categoryId))
    } catch {
      return checkDraft(product)
    }
  })

  ipcMain.handle(IPC.pickPhotos, async () => {
    const window = getWindow()
    if (!window) return []
    const result = await dialog.showOpenDialog(window, {
      title: 'Produktfotos wählen',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Bilder', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle(IPC.getStatus, () => ({
    configured: isConfigured(config),
    signedIn: auth.hasUserConsent,
    environment: config.ebayEnv,
    marketplace: config.ebayMarketplace,
    aiProvider: deps.aiError ? 'none' : config.aiProvider,
    aiError: deps.aiError,
    missingCapabilities: pipeline.missingCapabilities.map((capability) => ({
      capability,
      hint: CAPABILITY_HINTS[capability],
    })),
  }))

  ipcMain.handle(IPC.runDiagnostics, () =>
    runDiagnostics({ config, auth, client, policyIds: getPolicyIds() }),
  )

  ipcMain.handle(IPC.runWriteTest, () =>
    runPublishDryRun({ config, auth, client, policyIds: getPolicyIds() }),
  )

  ipcMain.handle(IPC.openMarketSearch, async (_event, productId: number) => {
    const product = repo.get(productId)
    if (!product) return false
    const url = buildMarketSearchUrl(product, config.ebayMarketplace)
    if (!url) return false
    await shell.openExternal(url)
    return true
  })

  ipcMain.handle(IPC.signIn, async () => {
    await auth.interactiveLogin()
  })

  ipcMain.handle(IPC.getPolicies, () => listPolicies(client))

  ipcMain.handle(IPC.getPolicyIds, () => getPolicyIds())

  ipcMain.handle(IPC.setPolicyIds, (_event, ids: PolicyIds) => {
    setPolicyIds(ids)
  })

  // Open external links (e.g. a published listing) in the real browser
  // rather than inside the app window.
  ipcMain.on('open-external', (_event, url: string) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
  })
}

function requirePolicies(): { fulfillment: string; payment: string; return: string } {
  const ids = getPolicyIds()
  if (!hasCompletePolicies(ids)) {
    throw new Error(
      'Bitte zuerst in den Einstellungen Zahlungs-, Versand- und Rücknahme-Richtlinien wählen.',
    )
  }
  return {
    fulfillment: ids.fulfillment as string,
    payment: ids.payment as string,
    return: ids.return as string,
  }
}
