-- Brand / source registry -------------------------------------------------
CREATE TABLE sources (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  original_url          TEXT NOT NULL,
  canonical_url         TEXT,
  host                  TEXT,
  source_type           TEXT NOT NULL CHECK (source_type IN ('website','collection','social')),
  platform              TEXT,               -- shopify | woocommerce | instagram | unknown
  ingestion_method      TEXT,               -- shopify_products_json | woocommerce_store_api | manual
  scope                 TEXT NOT NULL DEFAULT 'store' CHECK (scope IN ('store','collection')),
  collection_handle     TEXT,
  status                TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','syncing','ok','partial','error','manual','unsupported')),
  status_detail         TEXT,               -- human-readable limitation or last error
  verified              INTEGER NOT NULL DEFAULT 0,
  logo_url              TEXT,
  sync_interval_hours   REAL,               -- NULL = use SYNC_INTERVAL_HOURS
  last_attempted_sync   TEXT,
  last_successful_sync  TEXT,
  baseline_completed_at TEXT,               -- first successful full sync; first-seen dates before it are not "new"
  product_count         INTEGER NOT NULL DEFAULT 0,
  is_demo               INTEGER NOT NULL DEFAULT 0,
  notes                 TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX idx_sources_host ON sources(host);

-- Product catalogue ---------------------------------------------------------
CREATE TABLE products (
  id                   TEXT PRIMARY KEY,         -- <source_id>:<external_id>
  source_id            TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  external_id          TEXT NOT NULL,            -- platform id (Shopify product id, Woo id, manual hash)
  handle               TEXT,
  name                 TEXT NOT NULL,
  description          TEXT,
  category             TEXT NOT NULL DEFAULT 'other',
  category_basis       TEXT,                     -- product_type | tags | title | none
  source_category      TEXT,                     -- original product_type / category names
  tags                 TEXT NOT NULL DEFAULT '[]',  -- JSON array
  vendor               TEXT,
  image_url            TEXT,
  image_urls           TEXT NOT NULL DEFAULT '[]',  -- JSON array
  url                  TEXT NOT NULL,            -- canonical product URL
  price                REAL,                     -- lowest variant price, source currency
  price_max            REAL,
  currency             TEXT,
  original_price       REAL,                     -- verified compare-at / regular price when on sale
  available            INTEGER,                  -- 1 / 0 / NULL (unknown)
  source_published_at  TEXT,                     -- as reported by the source
  source_created_at    TEXT,
  released_at          TEXT,                     -- date used for recency (see docs/INGESTION.md)
  released_basis       TEXT,                     -- published | created | first_seen | NULL
  first_seen_at        TEXT NOT NULL,
  last_checked_at      TEXT NOT NULL,
  removed_at           TEXT,                     -- no longer listed by the source (kept, hidden)
  source_type          TEXT NOT NULL,
  provenance           TEXT NOT NULL,            -- e.g. shopify_products_json:https://…
  last_ingest_status   TEXT NOT NULL DEFAULT 'ok',
  is_demo              INTEGER NOT NULL DEFAULT 0,
  raw                  TEXT,                     -- trimmed source record for debugging
  UNIQUE (source_id, external_id)
);
CREATE INDEX idx_products_source   ON products(source_id);
CREATE INDEX idx_products_category ON products(category);
CREATE INDEX idx_products_released ON products(released_at);
CREATE INDEX idx_products_first    ON products(first_seen_at);
CREATE INDEX idx_products_price    ON products(price);
CREATE INDEX idx_products_url      ON products(url);
CREATE INDEX idx_products_visible  ON products(removed_at, is_demo);

-- Full-text search over the catalogue (porter stemming: "trousers" ~ "trouser").
CREATE VIRTUAL TABLE products_fts USING fts5(
  name, brand, category, tags, description,
  product_id UNINDEXED,
  tokenize = 'porter unicode61 remove_diacritics 2'
);

-- Collections (release-level information where the source exposes it) ---------
CREATE TABLE collections (
  id             TEXT PRIMARY KEY,      -- <source_id>:<external_id>
  source_id      TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  external_id    TEXT NOT NULL,
  title          TEXT NOT NULL,
  handle         TEXT,
  url            TEXT NOT NULL,
  image_url      TEXT,
  products_count INTEGER,
  published_at   TEXT,
  first_seen_at  TEXT NOT NULL,
  last_checked_at TEXT NOT NULL,
  UNIQUE (source_id, external_id)
);
CREATE INDEX idx_collections_published ON collections(published_at);

-- Sync history & errors ------------------------------------------------------
CREATE TABLE sync_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id       TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  trigger         TEXT NOT NULL,        -- schedule | manual | add | cli
  started_at      TEXT NOT NULL,
  finished_at     TEXT,
  status          TEXT NOT NULL,        -- running | ok | partial | error | skipped
  products_seen   INTEGER NOT NULL DEFAULT 0,
  products_new    INTEGER NOT NULL DEFAULT 0,
  products_updated INTEGER NOT NULL DEFAULT 0,
  products_removed INTEGER NOT NULL DEFAULT 0,
  requests        INTEGER NOT NULL DEFAULT 0,
  error           TEXT,
  warnings        TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX idx_sync_runs_source ON sync_runs(source_id, started_at);

-- Saved items (single local user for now; user_id keeps it multi-user ready) --
CREATE TABLE saved_items (
  user_id    TEXT NOT NULL DEFAULT 'local',
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  saved_at   TEXT NOT NULL,
  PRIMARY KEY (user_id, product_id)
);

CREATE TABLE preferences (
  user_id TEXT NOT NULL DEFAULT 'local',
  key     TEXT NOT NULL,
  value   TEXT,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
