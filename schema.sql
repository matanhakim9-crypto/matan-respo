CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS holdings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  ticker TEXT NOT NULL,
  market TEXT NOT NULL DEFAULT 'US',
  company_name TEXT,
  shares REAL NOT NULL,
  purchase_price REAL NOT NULL,
  amount_invested REAL NOT NULL,
  purchase_date TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS dividend_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  ticker TEXT NOT NULL,
  amount_per_share REAL NOT NULL,
  payment_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'expected',
  shares_at_payment REAL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dividend_user_ticker_date ON dividend_payments(user_id, ticker, payment_date);

CREATE TABLE IF NOT EXISTS quote_cache (
  ticker TEXT PRIMARY KEY,
  price REAL NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ticker_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT NOT NULL,
  symbol TEXT NOT NULL,
  display_name TEXT NOT NULL,
  market TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ticker_alias_query_symbol ON ticker_aliases(query, symbol);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fmp_debug_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  info TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dividend_pay_date_cache (
  ticker TEXT NOT NULL,
  ex_date TEXT NOT NULL,
  pay_date TEXT NOT NULL,
  PRIMARY KEY (ticker, ex_date)
);

CREATE TABLE IF NOT EXISTS trek_plan_cache (
  cache_key TEXT PRIMARY KEY,
  response TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trek_library (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  country TEXT NOT NULL,
  region TEXT NOT NULL,
  days INTEGER NOT NULL,
  distance INTEGER NOT NULL,
  gain INTEGER NOT NULL,
  difficulty TEXT NOT NULL,
  lodging TEXT NOT NULL,
  blurb TEXT NOT NULL,
  stages TEXT NOT NULL,
  day_plan TEXT NOT NULL,
  photos TEXT,
  created_at TEXT NOT NULL
);
