-- Sagur — schema for Cloudflare D1 (SQLite).
-- Safe to re-run: every statement is IF NOT EXISTS.
-- All monetary columns are INTEGER agorot (1 shekel = 100 agorot) so that
-- totals never drift through floating point.

CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  password_salt  TEXT NOT NULL,
  plan           TEXT NOT NULL DEFAULT 'free',   -- 'free' | 'pro'
  trial_ends_at  TEXT,                            -- ISO date; Pro entitlements until then
  plan_until     TEXT,                            -- ISO date; set by billing, NULL = open ended
  billing_ref    TEXT,                            -- provider customer/subscription reference
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- One business profile per user: what the customer sees at the top of a quote.
CREATE TABLE IF NOT EXISTS businesses (
  user_id           INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL DEFAULT '',
  owner_name        TEXT NOT NULL DEFAULT '',
  phone             TEXT NOT NULL DEFAULT '',
  email             TEXT NOT NULL DEFAULT '',
  tax_id            TEXT NOT NULL DEFAULT '',
  address           TEXT NOT NULL DEFAULT '',
  logo_data_url     TEXT,
  accent_color      TEXT NOT NULL DEFAULT '#1f6feb',
  vat_rate          REAL NOT NULL DEFAULT 18,
  validity_days     INTEGER NOT NULL DEFAULT 14,
  default_terms     TEXT NOT NULL DEFAULT '',
  quote_prefix      TEXT NOT NULL DEFAULT '',
  next_quote_number INTEGER NOT NULL DEFAULT 1,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  contact_name TEXT NOT NULL DEFAULT '',
  phone        TEXT NOT NULL DEFAULT '',
  email        TEXT NOT NULL DEFAULT '',
  address      TEXT NOT NULL DEFAULT '',
  notes        TEXT NOT NULL DEFAULT '',
  archived     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customers_user ON customers(user_id, archived);

-- Reusable price list. Picking from it is what makes a quote take 60 seconds.
CREATE TABLE IF NOT EXISTS catalog_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  details     TEXT NOT NULL DEFAULT '',
  unit        TEXT NOT NULL DEFAULT 'יח׳',
  unit_price  INTEGER NOT NULL DEFAULT 0,   -- agorot
  use_count   INTEGER NOT NULL DEFAULT 0,
  archived    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_catalog_user ON catalog_items(user_id, archived);

CREATE TABLE IF NOT EXISTS quotes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_id     INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  number          TEXT NOT NULL,
  title           TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'draft', -- draft|sent|viewed|approved|declined|cancelled
  issue_date      TEXT NOT NULL,
  valid_until     TEXT,
  notes           TEXT NOT NULL DEFAULT '',
  terms           TEXT NOT NULL DEFAULT '',
  discount_type   TEXT NOT NULL DEFAULT 'none',  -- none|percent|amount
  discount_value  REAL NOT NULL DEFAULT 0,       -- percent points, or agorot when 'amount'
  vat_rate        REAL NOT NULL DEFAULT 18,
  subtotal        INTEGER NOT NULL DEFAULT 0,
  discount_amount INTEGER NOT NULL DEFAULT 0,
  vat_amount      INTEGER NOT NULL DEFAULT 0,
  total           INTEGER NOT NULL DEFAULT 0,
  public_token    TEXT NOT NULL UNIQUE,
  sent_at         TEXT,
  first_viewed_at TEXT,
  last_viewed_at  TEXT,
  view_count      INTEGER NOT NULL DEFAULT 0,
  decided_at      TEXT,
  decline_reason  TEXT,
  signer_name     TEXT,
  signature_image TEXT,                          -- data: URL of the drawn signature
  signer_ip       TEXT,
  signer_agent    TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quotes_user ON quotes(user_id, status);
CREATE INDEX IF NOT EXISTS idx_quotes_customer ON quotes(customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_quotes_number ON quotes(user_id, number);

CREATE TABLE IF NOT EXISTS quote_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id    INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  details     TEXT NOT NULL DEFAULT '',
  unit        TEXT NOT NULL DEFAULT 'יח׳',
  quantity    REAL NOT NULL DEFAULT 1,
  unit_price  INTEGER NOT NULL DEFAULT 0,   -- agorot
  line_total  INTEGER NOT NULL DEFAULT 0,   -- agorot
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON quote_items(quote_id, sort_order);

-- Redeemed Pro codes. The primary key is what makes each code single-use.
CREATE TABLE IF NOT EXISTS license_redemptions (
  code        TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redeemed_at TEXT NOT NULL
);

-- Audit trail. This is what gives the digital signature its weight: who opened
-- the quote, when, and from where.
CREATE TABLE IF NOT EXISTS quote_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id   INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,   -- created|sent|viewed|approved|declined|reopened|cancelled
  detail     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quote_events_quote ON quote_events(quote_id, id);
