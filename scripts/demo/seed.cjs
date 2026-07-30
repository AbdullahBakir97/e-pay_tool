/**
 * Seeds a throwaway user-data directory with demo products, so the app
 * can be screenshotted in every queue state without touching a real eBay
 * account. Runs under Electron because storing the (fake) eBay token
 * needs safeStorage.
 *
 * The schema is NOT created here - the app is launched once beforehand
 * so it creates its own tables, which keeps this script free of a
 * duplicated copy of the schema that could drift.
 *
 *   electron scripts/demo/seed.cjs --user-data-dir=<dir> --password-store=basic
 */

const { join } = require('node:path')
const { mkdirSync, writeFileSync } = require('node:fs')

const { app, safeStorage } = require('electron')

/** Neutral placeholder tiles - no real product photography is invented. */
function placeholder(label, hue) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160">
    <rect width="160" height="160" fill="hsl(${hue},30%,88%)"/>
    <rect x="8" y="8" width="144" height="144" fill="none" stroke="hsl(${hue},30%,62%)" stroke-width="2"/>
    <text x="80" y="86" font-family="sans-serif" font-size="15" fill="hsl(${hue},25%,35%)"
          text-anchor="middle">${label}</text>
  </svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

const PRODUCTS = [
  {
    sku: 'EP-4A91C0DE7742',
    state: 'NEEDS_INFO',
    source: 'AI',
    gtin: null,
    title: null,
    brand: 'Apple',
    condition: 'USED_GOOD',
    category_id: '9355',
    price: null,
    ai_questions: [
      'Bitte die Rückseite fotografieren, um das genaue Modell zu bestimmen. ' +
        'Die Modellnummer (z.B. A2633) steht auf der Rückseite oder unter ' +
        'Einstellungen > Allgemein > Info.',
      'Wie groß ist der Speicher (64 GB, 128 GB oder 256 GB)?',
    ],
    ai_suggestions: [
      'Foto der Rückseite ergänzen',
      'Foto des eingeschalteten Displays ergänzen',
      'Sichtbare Kratzer separat fotografieren',
    ],
    ai_confidence: { brand: 0.98, productName: 0.61, model: 0.3 },
    photos: [{ path: '/fotos/front.jpg', url: placeholder('Eigenes Foto', 210) }],
  },
  {
    sku: 'EP-7B22F1AA9013',
    state: 'READY',
    source: 'CATALOG',
    gtin: '0194252707975',
    title: 'Apple iPhone 13 128GB Midnight',
    brand: 'Apple',
    mpn: 'MLPF3ZD/A',
    epid: '24053414',
    condition: 'NEW',
    category_id: '9355',
    price: 388.0,
    description:
      '<p><strong>Apple iPhone 13 128GB Midnight</strong></p><ul>' +
      '<li>6,1" Super Retina XDR Display</li><li>128 GB Speicher</li>' +
      '<li>Farbe: Midnight</li><li>Zustand: Neu, originalverpackt</li></ul>',
    aspects: { Marke: ['Apple'], Farbe: ['Midnight'], Speicherkapazität: ['128 GB'] },
    price_stats: {
      minimum: 369.0,
      median: 400.0,
      maximum: 449.0,
      sampleSize: 37,
      currency: 'EUR',
      outliersRemoved: 4,
    },
    photos: [
      { path: '', url: placeholder('Katalogbild 1', 210) },
      { path: '', url: placeholder('Katalogbild 2', 210) },
      { path: '', url: placeholder('Katalogbild 3', 210) },
    ],
  },
  {
    sku: 'EP-C5D80E14BB36',
    state: 'READY',
    source: 'CATALOG',
    gtin: '4059952512891',
    title: 'Bosch PSB 1800 LI-2 Akku-Schlagbohrschrauber 18V',
    brand: 'Bosch',
    condition: 'NEW',
    category_id: '42346',
    price: 79.9,
    description: '<p>Akku-Schlagbohrschrauber inkl. Ladegerät und Koffer.</p>',
    price_stats: {
      minimum: 74.5,
      median: 82.4,
      maximum: 99.0,
      sampleSize: 21,
      currency: 'EUR',
      outliersRemoved: 2,
    },
    photos: [
      { path: '', url: placeholder('Katalogbild 1', 30) },
      { path: '', url: placeholder('Katalogbild 2', 30) },
    ],
  },
  {
    sku: 'EP-9E37A2C41D58',
    state: 'NEEDS_INFO',
    source: 'AI',
    gtin: null,
    title: 'Nike Air Zoom Pegasus Herren Laufschuh',
    brand: 'Nike',
    condition: 'USED_EXCELLENT',
    category_id: '15709',
    price: 54.0,
    ai_questions: [
      'Welche Schuhgröße? Bitte das Etikett an der Innenseite der Zunge fotografieren.',
    ],
    ai_suggestions: ['Foto der Sohle ergänzen (zeigt den Abnutzungsgrad)'],
    ai_confidence: { brand: 0.96, productName: 0.88, Größe: 0.22 },
    price_stats: {
      minimum: 39.0,
      median: 55.7,
      maximum: 78.0,
      sampleSize: 44,
      currency: 'EUR',
      outliersRemoved: 6,
    },
    photos: [
      { path: '/fotos/schuh-1.jpg', url: placeholder('Eigenes Foto', 100) },
      { path: '/fotos/schuh-2.jpg', url: placeholder('Eigenes Foto', 100) },
    ],
  },
  {
    sku: 'EP-1F60B8D2E4A7',
    state: 'POSTED',
    source: 'CATALOG',
    gtin: '5702016914696',
    title: 'LEGO Technic 42115 Lamborghini Sián FKP 37',
    brand: 'LEGO',
    condition: 'NEW',
    category_id: '19006',
    price: 289.0,
    offer_id: '8472619304',
    listing_id: '295812470031',
    description: '<p>LEGO Technic Lamborghini Sián FKP 37, 3696 Teile.</p>',
    photos: [{ path: '', url: placeholder('Katalogbild 1', 60) }],
  },
  {
    sku: 'EP-2D45E7F9C831',
    state: 'FAILED',
    source: 'CATALOG',
    gtin: '4006381333931',
    title: 'Staedtler Noris 120 Bleistift 12er-Pack',
    brand: 'Staedtler',
    condition: 'NEW',
    category_id: '11720',
    price: 4.49,
    last_error:
      'eBay API error 400: Der Artikelzustand "Neu" ist für diese Kategorie nicht zulässig. ' +
      'Bitte Kategorie oder Zustand korrigieren.',
    photos: [{ path: '', url: placeholder('Katalogbild 1', 340) }],
  },
  {
    sku: 'EP-6C1930AB5F72',
    state: 'ENRICHING',
    gtin: '8806094926019',
    photos: [],
  },
  {
    sku: 'EP-8A72D4E10C95',
    state: 'SCANNED',
    gtin: '4548736141537',
    photos: [],
  },
]

function seed() {
  const dbPath = join(app.getPath('userData'), 'epay.db')
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
  const db = new DatabaseSync(dbPath)

  db.exec('DELETE FROM photos')
  db.exec('DELETE FROM products')

  const insertProduct = db.prepare(`
    INSERT INTO products (
      sku, state, source, gtin, epid, title, brand, mpn, condition, category_id,
      aspects, description, price, currency, quantity, price_stats,
      ai_questions, ai_suggestions, ai_confidence, offer_id, listing_id, last_error,
      created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `)
  const insertPhoto = db.prepare(
    'INSERT INTO photos (product_id, path, ebay_url, position) VALUES (?, ?, ?, ?)',
  )

  const json = (value) => (value === undefined || value === null ? null : JSON.stringify(value))

  // Newest first in the grid: seed in reverse so the list reads naturally.
  PRODUCTS.forEach((product, index) => {
    const stamp = `2026-07-30 09:${String(10 + PRODUCTS.length - index).padStart(2, '0')}:00`
    const info = insertProduct.run(
      product.sku,
      product.state,
      product.source ?? null,
      product.gtin ?? null,
      product.epid ?? null,
      product.title ?? null,
      product.brand ?? null,
      product.mpn ?? null,
      product.condition ?? null,
      product.category_id ?? null,
      json(product.aspects),
      product.description ?? null,
      product.price ?? null,
      'EUR',
      1,
      json(product.price_stats),
      json(product.ai_questions),
      json(product.ai_suggestions),
      json(product.ai_confidence),
      product.offer_id ?? null,
      product.listing_id ?? null,
      product.last_error ?? null,
      stamp,
      stamp,
    )
    const productId = Number(info.lastInsertRowid)
    product.photos.forEach((photo, position) =>
      insertPhoto.run(productId, photo.path, photo.url, position),
    )
  })

  db.close()

  // A placeholder refresh token so the app renders as signed in.
  if (safeStorage.isEncryptionAvailable()) {
    const dir = join(app.getPath('userData'), 'secrets')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'ebay_refresh_token_sandbox.bin'),
      safeStorage.encryptString('demo-refresh-token'),
      { mode: 0o600 },
    )
    console.log('SEED: token stored')
  } else {
    console.log('SEED: safeStorage unavailable, app will show the sign-in banner')
  }

  console.log(`SEED: ${PRODUCTS.length} products written to ${dbPath}`)
}

app.whenReady()
  .then(seed)
  .catch((error) => console.error('SEED FAILED', error))
  .finally(() => app.exit(0))
