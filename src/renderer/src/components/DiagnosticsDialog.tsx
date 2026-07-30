import { useEffect, useState } from 'react'

import type { CheckResult, CheckStatus } from '@shared/types'

import { api } from '../api'

interface Props {
  onClose: () => void
}

const SYMBOL: Record<CheckStatus, string> = {
  ok: '✓',
  warn: '!',
  fail: '✕',
  skipped: '–',
}

const STATUS_LABEL: Record<CheckStatus, string> = {
  ok: 'In Ordnung',
  warn: 'Hinweis',
  fail: 'Fehler',
  skipped: 'Übersprungen',
}

function CheckRow({ result }: { result: CheckResult }): JSX.Element {
  return (
    <li className={`check check--${result.status}`}>
      <span className="check__icon" aria-label={STATUS_LABEL[result.status]}>
        {SYMBOL[result.status]}
      </span>
      <div>
        <div className="check__label">{result.label}</div>
        <div className="check__detail">{result.detail}</div>
        {result.hint && result.status !== 'ok' && (
          <div className="check__hint">→ {result.hint}</div>
        )}
      </div>
    </li>
  )
}

export function DiagnosticsDialog({ onClose }: Props): JSX.Element {
  const [results, setResults] = useState<CheckResult[]>([])
  const [writeResults, setWriteResults] = useState<CheckResult[]>([])
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const run = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setResults(await api.runDiagnostics())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void run()
  }, [])

  const runWriteTest = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setWriteResults(await api.runWriteTest())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const copyReport = async (): Promise<void> => {
    const all = [...results, ...writeResults]
      .map((r) => `${STATUS_LABEL[r.status]}: ${r.label} – ${r.detail}`)
      .join('\n')
    await navigator.clipboard.writeText(all)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  const failed = results.filter((r) => r.status === 'fail').length
  const warned = results.filter((r) => r.status === 'warn').length
  const canWriteTest = results.length > 0 && failed === 0

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--wide" onClick={(event) => event.stopPropagation()}>
        <h2>Verbindung zu eBay prüfen</h2>

        {busy && <p className="hint">Prüfung läuft…</p>}

        {!busy && results.length > 0 && (
          <p className={failed ? 'summary summary--fail' : warned ? 'summary summary--warn' : 'summary summary--ok'}>
            {failed > 0
              ? `${failed} Fehler – die Anwendung kann so nicht bei eBay einstellen.`
              : warned > 0
                ? `Alles Nötige funktioniert, ${warned} Einschränkung(en) siehe unten.`
                : 'Alle Prüfungen bestanden.'}
          </p>
        )}

        {error && (
          <div className="card card--error">
            <div>{error}</div>
          </div>
        )}

        <ul className="checks">
          {results.map((result) => (
            <CheckRow key={result.id} result={result} />
          ))}
        </ul>

        {writeResults.length > 0 && (
          <>
            <h3 className="section">Testangebot</h3>
            <ul className="checks">
              {writeResults.map((result) => (
                <CheckRow key={result.id} result={result} />
              ))}
            </ul>
          </>
        )}

        <div className="card">
          <h3>Vollständiger Test (optional)</h3>
          <p className="hint">
            Legt ein echtes Testangebot im eBay-Konto an und löscht es sofort wieder. Es wird
            <strong> nicht veröffentlicht</strong> und ist für Käufer nie sichtbar. Nur so lässt
            sich das Einstellen prüfen, ohne einen echten Artikel zu riskieren.
          </p>
          <div className="actions">
            <button type="button" onClick={() => void runWriteTest()} disabled={busy || !canWriteTest}>
              Testangebot anlegen und wieder löschen
            </button>
          </div>
          {!canWriteTest && !busy && (
            <p className="hint">Zuerst müssen die Prüfungen oben fehlerfrei sein.</p>
          )}
        </div>

        <div className="actions">
          <button type="button" onClick={() => void run()} disabled={busy}>
            Erneut prüfen
          </button>
          <button type="button" onClick={() => void copyReport()} disabled={busy || !results.length}>
            {copied ? 'Kopiert' : 'Bericht kopieren'}
          </button>
          <button type="button" className="primary" onClick={onClose}>
            Schließen
          </button>
        </div>
      </div>
    </div>
  )
}
