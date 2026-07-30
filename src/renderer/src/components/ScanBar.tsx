import { useEffect, useRef, useState } from 'react'

interface Props {
  onScan: (code: string) => void
  onAddFromPhotos: () => void
  onPublishAllReady: () => void
  onOpenSettings: () => void
  onOpenDiagnostics: () => void
  readyCount: number
  busy: boolean
}

/**
 * The barcode field keeps focus so a USB scanner - which simply types the
 * digits and presses Enter - can drive the whole session without the user
 * touching the mouse.
 */
export function ScanBar({
  onScan,
  onAddFromPhotos,
  onPublishAllReady,
  onOpenSettings,
  onOpenDiagnostics,
  readyCount,
  busy,
}: Props): JSX.Element {
  const [code, setCode] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const submit = (event: React.FormEvent): void => {
    event.preventDefault()
    const trimmed = code.trim()
    setCode('')
    if (trimmed) onScan(trimmed)
    inputRef.current?.focus()
  }

  return (
    <form className="scanbar" onSubmit={submit}>
      <label htmlFor="scan">Barcode scannen:</label>
      <input
        id="scan"
        ref={inputRef}
        value={code}
        onChange={(event) => setCode(event.target.value)}
        placeholder="Barcode scannen oder eintippen und Enter drücken…"
        autoComplete="off"
      />
      <button type="button" onClick={onAddFromPhotos}>
        Artikel nur mit Fotos
      </button>
      <button type="button" onClick={onPublishAllReady} disabled={readyCount === 0 || busy}>
        {readyCount > 0 ? `${readyCount} Artikel einstellen` : 'Alle „Bereit“ einstellen'}
      </button>
      <button type="button" onClick={onOpenDiagnostics}>
        Verbindung prüfen
      </button>
      <button type="button" onClick={onOpenSettings}>
        Einstellungen
      </button>
    </form>
  )
}
