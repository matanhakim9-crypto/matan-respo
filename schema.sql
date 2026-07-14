CREATE TABLE IF NOT EXISTS holdings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  market TEXT NOT NULL DEFAULT 'US',
  shares REAL NOT NULL,
  purchase_price REAL NOT NULL,
  amount_invested REAL NOT NULL,
  purchase_date TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS dividend_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  amount_per_share REAL NOT NULL,
  payment_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'expected',
  shares_at_payment REAL
);

CREATE TABLE IF NOT EXISTS quote_cache (
  ticker TEXT PRIMARY KEY,
  price REAL NOT NULL,
  updated_at TEXT NOT NULL
);
