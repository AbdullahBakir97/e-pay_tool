import { useEffect, useState } from 'react'

import { EBAY_CONDITIONS, ProductState, type Product, type ProductEdit } from '@shared/types'

import { api } from '../api'

interface Props {
  product: Product | null
  onChanged: () => void
}

interface FormState {
  title: string
  brand: string
  condition: string
  price: string
  userNotes: string
  description: string
}

function toForm(product: Product): FormState {
  return {
    title: product.title ?? '',
    brand: product.brand ?? '',
    condition: product.condition ?? '',
    price: product.price === null ? '' : String(product.price),
    userNotes: product.userNotes ?? '',
    description: product.description ?? '',
  }
}

function toEdit(form: FormState): ProductEdit {
  const price = Number.parseFloat(form.price)
  return {
    title: form.title.trim() || null,
    brand: form.brand.trim() || null,
    condition: form.condition.trim() || null,
    price: Number.isFinite(price) && price > 0 ? price : null,
    userNotes: form.userNotes.trim() || null,
    description: form.description.trim() || null,
  }
}

export function DetailPanel({ product, onChanged }: Props): JSX.Element {
  const [form, setForm] = useState<FormState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reload the form when a different product is selected, but do not
  // clobber what the user is typing while background jobs refresh the list.
  useEffect(() => {
    setForm(product ? toForm(product) : null)
    setError(null)
  }, [product?.id])

  if (!product || !form) {
    return <div className="empty">Wählen Sie einen Artikel aus der Liste.</div>
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void =>
    setForm((current) => (current ? { ...current, [key]: value } : current))

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await action()
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const save = (): Promise<void> =>
    run(async () => {
      await api.updateProduct(product.id, toEdit(form))
    })

  const saveAndRecheck = (): Promise<void> =>
    run(async () => {
      await api.updateProduct(product.id, toEdit(form))
      await api.enrichProduct(product.id)
    })

  const publish = (): Promise<void> =>
    run(async () => {
      await api.updateProduct(product.id, toEdit(form))
      await api.publishProduct(product.id)
    })

  const addPhotos = (): Promise<void> =>
    run(async () => {
      const paths = await api.pickPhotos()
      if (paths.length > 0) await api.addPhotos(product.id, paths)
    })

  const questions = product.aiQuestions ?? []
  const suggestions = product.aiSuggestions ?? []
  const stats = product.priceStats
  const previews = product.photos.filter((photo) => photo.ebayUrl).slice(0, 6)

  return (
    <div>
      {(questions.length > 0 || suggestions.length > 0) && (
        <div className="card card--questions">
          <h3>Offene Fragen &amp; Hinweise</h3>
          <ul>
            {questions.map((question) => (
              <li key={question}>{question}</li>
            ))}
            {suggestions.map((suggestion) => (
              <li key={suggestion}>Tipp: {suggestion}</li>
            ))}
          </ul>
        </div>
      )}

      {product.lastError && (
        <div className="card card--error">
          <h3>Letzter Fehler</h3>
          <div>{product.lastError}</div>
        </div>
      )}

      {previews.length > 0 && (
        <div className="thumbs">
          {previews.map((photo) => (
            <img key={photo.id} src={photo.ebayUrl as string} alt="" />
          ))}
        </div>
      )}

      <div className="field">
        <label htmlFor="title">Titel</label>
        <input
          id="title"
          value={form.title}
          maxLength={80}
          onChange={(event) => set('title', event.target.value)}
        />
        <span className="hint">{form.title.length}/80 Zeichen</span>
      </div>

      <div className="field">
        <label htmlFor="brand">Marke</label>
        <input id="brand" value={form.brand} onChange={(event) => set('brand', event.target.value)} />
      </div>

      <div className="field">
        <label htmlFor="condition">Zustand</label>
        <select
          id="condition"
          value={form.condition}
          onChange={(event) => set('condition', event.target.value)}
        >
          <option value="">– bitte wählen –</option>
          {EBAY_CONDITIONS.map((condition) => (
            <option key={condition.code} value={condition.code}>
              {condition.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="price">Preis (€)</label>
        <input
          id="price"
          type="number"
          step="0.01"
          min="0"
          value={form.price}
          onChange={(event) => set('price', event.target.value)}
        />
        {stats ? (
          <span className="hint">
            Markt: {stats.minimum.toFixed(2)}–{stats.maximum.toFixed(2)} {stats.currency}, Median{' '}
            {stats.median.toFixed(2)} ({stats.sampleSize} Angebote
            {stats.outliersRemoved > 0 && `, ${stats.outliersRemoved} Ausreißer entfernt`})
          </span>
        ) : (
          <span className="hint">Keine automatische Marktrecherche verfügbar.</span>
        )}
        <div className="actions">
          <button type="button" onClick={() => void api.openMarketSearch(product.id)}>
            Marktpreise prüfen (verkaufte Artikel)
          </button>
        </div>
      </div>

      <div className="field">
        <label htmlFor="notes">Notizen / Antworten</label>
        <textarea
          id="notes"
          rows={3}
          value={form.userNotes}
          placeholder="Antworten auf die Fragen oder zusätzliche Infos – beim erneuten Prüfen wertet die KI sie aus."
          onChange={(event) => set('userNotes', event.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="description">Beschreibung</label>
        <textarea
          id="description"
          rows={7}
          value={form.description}
          onChange={(event) => set('description', event.target.value)}
        />
      </div>

      {error && (
        <div className="card card--error">
          <div>{error}</div>
        </div>
      )}

      <div className="actions">
        <button type="button" onClick={addPhotos} disabled={busy}>
          Fotos hinzufügen
        </button>
        <button type="button" onClick={save} disabled={busy}>
          Speichern
        </button>
        <button type="button" onClick={saveAndRecheck} disabled={busy}>
          Speichern &amp; neu prüfen
        </button>
        <button
          type="button"
          className="primary"
          onClick={publish}
          disabled={busy || product.state === ProductState.Posted}
        >
          {product.state === ProductState.Posted ? 'Eingestellt' : 'Jetzt einstellen'}
        </button>
      </div>
    </div>
  )
}
