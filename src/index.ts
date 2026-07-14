import { Hono } from 'hono';

type Bindings = {
  DB: D1Database;
};

type Market = 'US' | 'IL';

type Holding = {
  id: number;
  ticker: string;
  market: Market;
  shares: number;
  purchase_price: number;
  amount_invested: number;
  purchase_date: string | null;
  notes: string | null;
};

type DividendPayment = {
  id: number;
  ticker: string;
  amount_per_share: number;
  payment_date: string;
  status: 'expected' | 'paid';
  shares_at_payment: number | null;
};

const QUOTE_CACHE_TTL_MS = 15 * 60 * 1000;
const YAHOO_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
const FALLBACK_USD_ILS = 3.7;

const app = new Hono<{ Bindings: Bindings }>();

function normalizeTicker(rawTicker: string, market: Market): string {
  const t = rawTicker.trim().toUpperCase();
  return market === 'IL' && !t.endsWith('.TA') ? `${t}.TA` : t;
}

function currencyForTicker(ticker: string): 'ILS' | 'USD' {
  return ticker.endsWith('.TA') ? 'ILS' : 'USD';
}

// Tel Aviv Stock Exchange feeds (including Yahoo's) quote prices in Agorot, not Shekels.
function toNativePrice(ticker: string, rawPrice: number): number {
  return ticker.endsWith('.TA') ? rawPrice / 100 : rawPrice;
}

async function fetchYahooChart(ticker: string, range: string, events?: 'div'): Promise<any | null> {
  try {
    const eventsParam = events ? `&events=${events}` : '';
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=1d${eventsParam}`;
    const res = await fetch(url, { headers: YAHOO_HEADERS });
    if (!res.ok) return null;
    const data = await res.json<any>();
    return data?.chart?.result?.[0] ?? null;
  } catch {
    return null;
  }
}

async function getQuote(env: Bindings, ticker: string): Promise<number | null> {
  const cached = await env.DB.prepare(
    'SELECT price, updated_at FROM quote_cache WHERE ticker = ?'
  ).bind(ticker).first<{ price: number; updated_at: string }>();

  if (cached && Date.now() - new Date(cached.updated_at).getTime() < QUOTE_CACHE_TTL_MS) {
    return cached.price;
  }

  const result = await fetchYahooChart(ticker, '5d');
  const raw = result?.meta?.regularMarketPrice;
  if (typeof raw !== 'number') return cached?.price ?? null;
  const price = toNativePrice(ticker, raw);

  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO quote_cache (ticker, price, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(ticker) DO UPDATE SET price = excluded.price, updated_at = excluded.updated_at`
  ).bind(ticker, price, now).run();

  return price;
}

async function getUsdIlsRate(env: Bindings): Promise<number> {
  const rate = await getQuote(env, 'ILS=X');
  return rate ?? FALLBACK_USD_ILS;
}

type HistoryMatch = { date: string; price: number };

async function findHistoricalDates(ticker: string, targetPrice: number): Promise<HistoryMatch[]> {
  const result = await fetchYahooChart(ticker, '10y');
  if (!result) return [];

  const timestamps: number[] = result.timestamp ?? [];
  const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
  const tolerance = 0.03;

  const matches: HistoryMatch[] = [];
  let cooldown = 0;
  for (let i = 0; i < timestamps.length; i++) {
    if (cooldown > 0) {
      cooldown--;
      continue;
    }
    const raw = closes[i];
    if (raw == null) continue;
    const price = toNativePrice(ticker, raw);
    if (Math.abs(price - targetPrice) / targetPrice <= tolerance) {
      matches.push({ date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10), price });
      cooldown = 15; // skip ahead so a flat stretch doesn't return the same plateau dozens of times
    }
  }

  return matches.reverse().slice(0, 12);
}

// ---------- Dividend auto-discovery ----------

type DivPoint = { date: string; amount: number };

async function fetchDividendHistory(ticker: string): Promise<DivPoint[]> {
  const result = await fetchYahooChart(ticker, '10y', 'div');
  const raw = result?.events?.dividends;
  if (!raw) return [];
  return Object.values(raw as Record<string, { amount: number; date: number }>)
    .map((p) => ({ date: new Date(p.date * 1000).toISOString().slice(0, 10), amount: toNativePrice(ticker, p.amount) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Companies usually keep a steady per-share amount and cadence between
// payments, so the next expected dividend is estimated from the gap and
// amount of the last two historical payments rather than a separate,
// less-reliable Yahoo endpoint.
function projectNextDividend(history: DivPoint[]): DivPoint | null {
  if (history.length < 2) return null;
  const last = history[history.length - 1];
  const prev = history[history.length - 2];
  const intervalMs = new Date(last.date).getTime() - new Date(prev.date).getTime();
  if (intervalMs <= 0) return null;
  const nextMs = new Date(last.date).getTime() + intervalMs;
  if (nextMs < Date.now()) return null;
  return { date: new Date(nextMs).toISOString().slice(0, 10), amount: last.amount };
}

async function syncDividendsForHolding(env: Bindings, ticker: string, shares: number): Promise<void> {
  const history = await fetchDividendHistory(ticker);

  for (const point of history) {
    const existing = await env.DB.prepare(
      'SELECT id FROM dividend_payments WHERE ticker = ? AND payment_date = ?'
    ).bind(ticker, point.date).first<{ id: number }>();
    if (existing) {
      await env.DB.prepare(
        "UPDATE dividend_payments SET amount_per_share = ?, shares_at_payment = ?, status = 'paid' WHERE id = ?"
      ).bind(point.amount, shares, existing.id).run();
    } else {
      await env.DB.prepare(
        `INSERT INTO dividend_payments (ticker, amount_per_share, payment_date, status, shares_at_payment)
         VALUES (?, ?, ?, 'paid', ?)`
      ).bind(ticker, point.amount, point.date, shares).run();
    }
  }

  const next = projectNextDividend(history);
  if (next) {
    const existing = await env.DB.prepare(
      'SELECT id FROM dividend_payments WHERE ticker = ? AND payment_date = ?'
    ).bind(ticker, next.date).first<{ id: number }>();
    if (!existing) {
      await env.DB.prepare(
        `INSERT INTO dividend_payments (ticker, amount_per_share, payment_date, status, shares_at_payment)
         VALUES (?, ?, ?, 'expected', ?)`
      ).bind(ticker, next.amount, next.date, shares).run();
    }
  }
}

// ---------- Holdings ----------

app.get('/api/holdings', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM holdings ORDER BY ticker').all<Holding>();
  return c.json(results);
});

app.post('/api/holdings', async (c) => {
  const body = await c.req.json<Partial<Holding> & { market?: string }>();
  const { ticker, shares, purchase_price, purchase_date, notes } = body;
  const market: Market = body.market === 'IL' ? 'IL' : 'US';
  if (!ticker || !shares || !purchase_price) {
    return c.json({ error: 'ticker, shares and purchase_price are required' }, 400);
  }
  const normalizedTicker = normalizeTicker(ticker, market);
  const amount_invested = shares * purchase_price;
  const result = await c.env.DB.prepare(
    `INSERT INTO holdings (ticker, market, shares, purchase_price, amount_invested, purchase_date, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(normalizedTicker, market, shares, purchase_price, amount_invested, purchase_date ?? null, notes ?? null).run();

  await syncDividendsForHolding(c.env, normalizedTicker, shares).catch(() => {});

  return c.json({ id: result.meta.last_row_id }, 201);
});

app.patch('/api/holdings/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM holdings WHERE id = ?').bind(id).first<Holding>();
  if (!existing) return c.json({ error: 'holding not found' }, 404);

  const body = await c.req.json<Partial<Holding> & { market?: string }>();
  const market: Market = body.market === 'IL' || body.market === 'US' ? body.market : existing.market;
  const shares = body.shares ?? existing.shares;
  const purchase_price = body.purchase_price ?? existing.purchase_price;
  const ticker = body.ticker ? normalizeTicker(body.ticker, market) : existing.ticker;
  const purchase_date = body.purchase_date !== undefined ? body.purchase_date : existing.purchase_date;
  const notes = body.notes !== undefined ? body.notes : existing.notes;

  if (!ticker || !shares || !purchase_price) {
    return c.json({ error: 'ticker, shares and purchase_price are required' }, 400);
  }
  const amount_invested = shares * purchase_price;

  await c.env.DB.prepare(
    `UPDATE holdings SET ticker = ?, market = ?, shares = ?, purchase_price = ?, amount_invested = ?, purchase_date = ?, notes = ?
     WHERE id = ?`
  ).bind(ticker, market, shares, purchase_price, amount_invested, purchase_date, notes, id).run();

  await syncDividendsForHolding(c.env, ticker, shares).catch(() => {});

  return c.json({ ok: true });
});

app.delete('/api/holdings/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM holdings WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

// ---------- Dividend payments ----------

app.get('/api/dividends', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM dividend_payments ORDER BY payment_date'
  ).all<DividendPayment>();
  return c.json(results);
});

app.get('/api/dividends/upcoming', async (c) => {
  const today = new Date().toISOString().slice(0, 10);
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM dividend_payments WHERE payment_date >= ? AND status = 'expected' ORDER BY payment_date"
  ).bind(today).all<DividendPayment>();
  return c.json(results);
});

app.post('/api/dividends', async (c) => {
  const body = await c.req.json<Partial<DividendPayment> & { market?: string }>();
  const { ticker, amount_per_share, payment_date, status, shares_at_payment } = body;
  const market: Market = body.market === 'IL' ? 'IL' : 'US';
  if (!ticker || !amount_per_share || !payment_date) {
    return c.json({ error: 'ticker, amount_per_share and payment_date are required' }, 400);
  }
  const normalizedTicker = normalizeTicker(ticker, market);
  const result = await c.env.DB.prepare(
    `INSERT INTO dividend_payments (ticker, amount_per_share, payment_date, status, shares_at_payment)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(
    normalizedTicker,
    amount_per_share,
    payment_date,
    status ?? 'expected',
    shares_at_payment ?? null
  ).run();
  return c.json({ id: result.meta.last_row_id }, 201);
});

app.patch('/api/dividends/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<Partial<DividendPayment>>();
  if (!body.status) return c.json({ error: 'status is required' }, 400);
  await c.env.DB.prepare('UPDATE dividend_payments SET status = ? WHERE id = ?').bind(body.status, id).run();
  return c.json({ ok: true });
});

app.delete('/api/dividends/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM dividend_payments WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

app.post('/api/dividends/sync-all', async (c) => {
  const { results: holdings } = await c.env.DB.prepare('SELECT ticker, shares FROM holdings').all<{ ticker: string; shares: number }>();
  for (const h of holdings) {
    await syncDividendsForHolding(c.env, h.ticker, h.shares).catch(() => {});
  }
  return c.json({ ok: true, synced: holdings.length });
});

// ---------- Live quote ----------

app.get('/api/quote/:ticker', async (c) => {
  const market: Market = c.req.query('market') === 'IL' ? 'IL' : 'US';
  const ticker = normalizeTicker(c.req.param('ticker'), market);
  const price = await getQuote(c.env, ticker);
  if (price === null) return c.json({ error: 'quote unavailable' }, 502);
  return c.json({ ticker, price, currency: currencyForTicker(ticker) });
});

// ---------- Historical price -> date lookup ----------

app.get('/api/history/:ticker', async (c) => {
  const market: Market = c.req.query('market') === 'IL' ? 'IL' : 'US';
  const ticker = normalizeTicker(c.req.param('ticker'), market);
  const price = parseFloat(c.req.query('price') ?? '');
  if (!price || Number.isNaN(price) || price <= 0) {
    return c.json({ error: 'a positive price query param is required' }, 400);
  }
  const matches = await findHistoricalDates(ticker, price);
  return c.json({ ticker, matches });
});

// ---------- Portfolio summary ----------

app.get('/api/summary', async (c) => {
  const { results: holdings } = await c.env.DB.prepare('SELECT * FROM holdings').all<Holding>();
  const fxRate = await getUsdIlsRate(c.env);

  let totalInvested = 0;
  let currentValue = 0;
  const holdingsWithPrice = [];
  for (const h of holdings) {
    const currency = currencyForTicker(h.ticker);
    const toILS = currency === 'USD' ? fxRate : 1;
    const price = await getQuote(c.env, h.ticker);
    const nativeValue = (price ?? 0) * h.shares;

    currentValue += nativeValue * toILS;
    totalInvested += h.amount_invested * toILS;
    holdingsWithPrice.push({ ...h, currency, currentPrice: price, currentValue: nativeValue });
  }

  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const { results: paidLastYear } = await c.env.DB.prepare(
    "SELECT ticker, amount_per_share, shares_at_payment FROM dividend_payments WHERE status = 'paid' AND payment_date >= ?"
  ).bind(oneYearAgo.toISOString().slice(0, 10)).all<{ ticker: string; amount_per_share: number; shares_at_payment: number | null }>();

  const annualDividendIncome = paidLastYear.reduce((sum, p) => {
    const toILS = currencyForTicker(p.ticker) === 'USD' ? fxRate : 1;
    return sum + p.amount_per_share * (p.shares_at_payment ?? 0) * toILS;
  }, 0);

  const annualYieldPct = totalInvested > 0 ? (annualDividendIncome / totalInvested) * 100 : 0;
  const monthlyAvgIncome = annualDividendIncome / 12;

  return c.json({
    totalInvested,
    currentValue,
    gainLoss: currentValue - totalInvested,
    annualDividendIncome,
    annualYieldPct,
    monthlyAvgIncome,
    fxRate,
    holdings: holdingsWithPrice,
  });
});

export default app;
