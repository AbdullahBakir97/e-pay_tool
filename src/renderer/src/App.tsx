import { useCallback, useEffect, useMemo, useState } from 'react'

import { ProductState, STATE_LABELS, type AppStatus, type Product } from '@shared/types'

import { api } from './api'
import { DetailPanel } from './components/DetailPanel'
import { DiagnosticsDialog } from './components/DiagnosticsDialog'
import { ProductGrid } from './components/ProductGrid'
import { ScanBar } from './components/ScanBar'
import { SettingsDialog } from './components/SettingsDialog'

export function App(): JSX.Element {
  const [products, setProducts] = useState<Product[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [status, setStatus] = useState<AppStatus | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setProducts(await api.listProducts())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    void refresh()
    void api.getStatus().then(setStatus)
    // The main process pushes an event whenever background work changes
    // something, so the grid stays live without polling.
    return api.onProductsChanged(() => void refresh())
  }, [refresh])

  const guard = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await action()
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const onScan = (code: string): Promise<void> =>
    guard(async () => {
      setSelectedId(await api.scanBarcode(code))
    })

  const onAddFromPhotos = (): Promise<void> =>
    guard(async () => {
      const paths = await api.pickPhotos()
      if (paths.length > 0) setSelectedId(await api.createFromPhotos(paths))
    })

  const onPublishAllReady = (): Promise<void> =>
    guard(async () => {
      const count = await api.publishAllReady()
      if (count === 0) setError('Keine Artikel im Status „Bereit“.')
    })

  const onSignIn = (): Promise<void> =>
    guard(async () => {
      await api.signIn()
      setStatus(await api.getStatus())
    })

  const counts = useMemo(() => {
    const result = new Map<ProductState, number>()
    for (const product of products) {
      result.set(product.state, (result.get(product.state) ?? 0) + 1)
    }
    return result
  }, [products])

  const selected = products.find((product) => product.id === selectedId) ?? null
  const readyCount = counts.get(ProductState.Ready) ?? 0

  return (
    <div className="app">
      {status && !status.configured && (
        <div className="banner banner--error">
          eBay-Zugangsdaten fehlen – bitte .env nach dem Vorbild von .env.example anlegen.
        </div>
      )}
      {status?.missingCapabilities.map((missing) => (
        <div className="banner banner--warning" key={missing.capability}>
          {missing.hint}
        </div>
      ))}
      {status?.aiError && (
        <div className="banner banner--warning">
          KI nicht verfügbar ({status.aiError}). Barcode-Artikel funktionieren weiterhin; Artikel
          ohne Katalogtreffer müssen manuell ergänzt werden.
        </div>
      )}
      {status?.configured && !status.signedIn && (
        <div className="banner banner--warning">
          <span>Noch nicht bei eBay angemeldet.</span>
          <button type="button" className="primary" onClick={onSignIn} disabled={busy}>
            Jetzt anmelden
          </button>
        </div>
      )}
      {error && (
        <div className="banner banner--error">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>
            Schließen
          </button>
        </div>
      )}

      <ScanBar
        onScan={(code) => void onScan(code)}
        onAddFromPhotos={() => void onAddFromPhotos()}
        onPublishAllReady={() => void onPublishAllReady()}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenDiagnostics={() => setDiagnosticsOpen(true)}
        readyCount={readyCount}
        busy={busy}
      />

      <div className="main">
        <div className="grid-pane">
          <ProductGrid products={products} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
        <div className="detail-pane">
          <DetailPanel product={selected} onChanged={() => void refresh()} />
        </div>
      </div>

      <div className="statusbar">
        {products.length === 0 ? (
          <span>Bereit zum Scannen.</span>
        ) : (
          [...counts.entries()].map(([state, count]) => (
            <span key={state}>
              {STATE_LABELS[state]}: {count}
            </span>
          ))
        )}
        {status && (
          <span style={{ marginLeft: 'auto' }}>
            {status.marketplace} · {status.environment} · KI: {status.aiProvider}
          </span>
        )}
      </div>

      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {diagnosticsOpen && (
        <DiagnosticsDialog
          onClose={() => {
            setDiagnosticsOpen(false)
            void api.getStatus().then(setStatus)
          }}
        />
      )}
    </div>
  )
}
