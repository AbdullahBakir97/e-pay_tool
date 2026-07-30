import { STATE_LABELS, type Product } from '@shared/types'

interface Props {
  products: Product[]
  selectedId: number | null
  onSelect: (id: number) => void
}

function formatPrice(product: Product): string {
  return product.price === null ? '–' : `${product.price.toFixed(2)} ${product.currency}`
}

export function ProductGrid({ products, selectedId, onSelect }: Props): JSX.Element {
  if (products.length === 0) {
    return (
      <div className="empty">
        Noch keine Artikel. Scannen Sie einen Barcode, um zu beginnen.
      </div>
    )
  }

  return (
    <table>
      <thead>
        <tr>
          <th>SKU</th>
          <th>Barcode</th>
          <th>Titel</th>
          <th>Preis</th>
          <th>Fotos</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {products.map((product) => (
          <tr
            key={product.id}
            className={`state-${product.state}${product.id === selectedId ? ' selected' : ''}`}
            onClick={() => onSelect(product.id)}
          >
            <td>{product.sku}</td>
            <td>{product.gtin ?? '–'}</td>
            <td title={product.title ?? ''}>{product.title ?? '–'}</td>
            <td>{formatPrice(product)}</td>
            <td>{product.photos.length}</td>
            <td>{STATE_LABELS[product.state]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
