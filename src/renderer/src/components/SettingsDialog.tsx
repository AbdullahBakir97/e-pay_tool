import { useEffect, useState } from 'react'

import type { PolicyIds, PolicyOptions } from '@shared/types'

import { api } from '../api'

interface Props {
  onClose: () => void
}

const FIELDS: ReadonlyArray<{ key: keyof PolicyIds; label: string }> = [
  { key: 'fulfillment', label: 'Versandrichtlinie' },
  { key: 'payment', label: 'Zahlungsrichtlinie' },
  { key: 'return', label: 'Rücknahmerichtlinie' },
]

/**
 * eBay requires a payment, shipping and return policy on every offer. The
 * seller configures these once on eBay; here they only pick which ones
 * this app should use.
 */
export function SettingsDialog({ onClose }: Props): JSX.Element {
  const [options, setOptions] = useState<PolicyOptions | null>(null)
  const [selected, setSelected] = useState<PolicyIds>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [available, current] = await Promise.all([api.getPolicies(), api.getPolicyIds()])
        if (cancelled) return
        setOptions(available)
        setSelected(current)
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      await api.setPolicyIds(selected)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h2>Einstellungen – eBay-Richtlinien</h2>
        <p className="hint">
          Diese Richtlinien werden für alle neuen Angebote verwendet. Sie stammen aus Ihrem
          eBay-Verkäuferkonto.
        </p>

        {error && (
          <div className="card card--error">
            <div>{error}</div>
          </div>
        )}

        {FIELDS.map((field) => (
          <div className="field" key={field.key}>
            <label htmlFor={field.key}>{field.label}</label>
            <select
              id={field.key}
              value={selected[field.key] ?? ''}
              disabled={busy || !options}
              onChange={(event) =>
                setSelected((current) => ({ ...current, [field.key]: event.target.value }))
              }
            >
              <option value="">– bitte wählen –</option>
              {(options?.[field.key] ?? []).map((policy) => (
                <option key={policy.id} value={policy.id}>
                  {policy.name}
                </option>
              ))}
            </select>
          </div>
        ))}

        <div className="actions">
          <button type="button" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="primary" onClick={save} disabled={busy}>
            Speichern
          </button>
        </div>
      </div>
    </div>
  )
}
