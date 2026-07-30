/** Electron main process: window lifecycle and dependency wiring. */

import { join } from 'node:path'

import { BrowserWindow, app, shell } from 'electron'

import { createProvider } from '@main/ai/provider'
import { loadConfig } from '@main/config'
import { Pipeline } from '@main/core/pipeline'
import { TaskQueue } from '@main/core/queue'
import { ProductRepository } from '@main/db/products'
import { openDatabase, type Db } from '@main/db/schema'
import { EbayAuth } from '@main/ebay/auth'
import { EbayClient } from '@main/ebay/client'
import { registerIpcHandlers } from '@main/ipc'
import { loadSecret, storeSecret } from '@main/secrets'

const ENRICHMENT_CONCURRENCY = 4

let mainWindow: BrowserWindow | null = null
let db: Db | null = null

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1360,
    height: 820,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'ePay Tool',
    webPreferences: {
      // Built as ESM (.mjs), which Electron only loads when the renderer
      // is not sandboxed - hence `sandbox: false` below.
      preload: join(__dirname, '../preload/index.mjs'),
      // The renderer is untrusted UI code: no Node, no shared context.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  window.once('ready-to-show', () => window.show())

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

function bootstrap(): void {
  const config = loadConfig(app.getAppPath())

  db = openDatabase(join(app.getPath('userData'), 'epay.db'))
  const repo = new ProductRepository(db)

  const auth = new EbayAuth(
    config,
    { store: storeSecret, load: loadSecret },
    { open: (url: string) => shell.openExternal(url) },
  )
  const client = new EbayClient(config, auth)
  const queue = new TaskQueue(ENRICHMENT_CONCURRENCY)

  void createProvider(config)
    .then(({ provider, error }) => {
      if (error) console.warn(`AI provider unavailable, continuing without it: ${error}`)

      const pipeline = new Pipeline({ config, client, auth, ai: provider, repo })
      registerIpcHandlers({
        config,
        repo,
        pipeline,
        queue,
        auth,
        client,
        aiError: error,
        getWindow: () => mainWindow,
      })
      mainWindow = createWindow()
    })
    .catch((error: unknown) => {
      console.error('Failed to start ePay Tool', error)
      app.quit()
    })
}

app.whenReady().then(bootstrap).catch((error: unknown) => {
  console.error('Failed to start ePay Tool', error)
  app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  db?.close()
  db = null
})
