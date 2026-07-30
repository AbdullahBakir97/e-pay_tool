/**
 * Local database.
 *
 * The queue of products being prepared for listing lives entirely in a
 * local SQLite database, so a batch of 100+ scans survives app restarts
 * and the user can work through the review grid at their own pace.
 *
 * WAL journaling lets the UI read while enrichment writes, and the busy
 * timeout makes a brief lock wait instead of failing a product with
 * "database is locked".
 *
 * Uses Node's built-in SQLite rather than a native npm module: no
 * ABI-specific rebuild between the test runner and Electron, nothing to
 * unpack from the asar archive, and no extra binary to code-sign. The
 * API is still marked experimental upstream, which is why every call is
 * confined to this directory - swapping in better-sqlite3 later would
 * touch only these two files.
 */

/**
 * Loaded through `process.getBuiltinModule` rather than a static import:
 * Node does not list `sqlite` in `builtinModules`, so bundlers try to
 * resolve it as a package on disk and fail. This fetches the real
 * builtin at runtime and stays invisible to the bundler, while the
 * type-only reference below keeps everything fully typed.
 */
type SqliteModule = typeof import('node:sqlite')

const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as SqliteModule

export type Db = InstanceType<SqliteModule['DatabaseSync']>
export type SqlValue = null | number | bigint | string

export const BUSY_TIMEOUT_MS = 30_000

const SCHEMA = `
CREATE TABLE IF NOT EXISTS products (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sku           TEXT    NOT NULL UNIQUE,
  state         TEXT    NOT NULL DEFAULT 'SCANNED',
  source        TEXT,

  gtin          TEXT,
  epid          TEXT,
  title         TEXT,
  brand         TEXT,
  mpn           TEXT,
  condition     TEXT,
  category_id   TEXT,
  aspects       TEXT,
  description   TEXT,
  user_notes    TEXT,

  price         REAL,
  currency      TEXT    NOT NULL DEFAULT 'EUR',
  quantity      INTEGER NOT NULL DEFAULT 1,
  price_stats   TEXT,

  ai_questions   TEXT,
  ai_suggestions TEXT,
  ai_confidence  TEXT,

  offer_id      TEXT,
  listing_id    TEXT,
  last_error    TEXT,

  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_products_state ON products(state);
CREATE INDEX IF NOT EXISTS idx_products_gtin  ON products(gtin);

CREATE TABLE IF NOT EXISTS photos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  path       TEXT    NOT NULL DEFAULT '',
  ebay_url   TEXT,
  position   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_photos_product ON photos(product_id);
`

export function openDatabase(path: string): Db {
  const db = new DatabaseSync(path)
  // An in-memory database has a single connection, where WAL is both
  // pointless and unsupported.
  if (path !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL')
  }
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`)
  db.exec(SCHEMA)
  return db
}

/**
 * Run `work` inside a transaction, rolling back if it throws.
 *
 * Node's SQLite has no transaction helper of its own, and a half-written
 * product (rows in `photos` with no parent, say) would be worse than a
 * failed scan.
 */
export function transaction<T>(db: Db, work: () => T): T {
  db.exec('BEGIN')
  try {
    const result = work()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
