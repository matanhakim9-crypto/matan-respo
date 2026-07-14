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

// Tel Aviv Stock Exchange feeds (including Yahoo's) quote prices in Agorot
// (ILA), not Shekels — and that's also how Israeli users think and enter
// numbers for TASE stocks, so the app keeps everything in Agorot natively
// for .TA tickers instead of converting to Shekels.
function currencyForTicker(ticker: string): 'ILA' | 'USD' {
  return ticker.endsWith('.TA') ? 'ILA' : 'USD';
}

// ILA -> ILS is a flat /100; USD -> ILS uses the live FX rate.
function toILSFactor(currency: 'ILA' | 'USD', fxRate: number): number {
  if (currency === 'USD') return fxRate;
  return 0.01;
}

type ChartTimeframe = { range: string } | { period1: number; period2: number };

async function fetchYahooChart(ticker: string, timeframe: ChartTimeframe, events?: 'div'): Promise<any | null> {
  try {
    const eventsParam = events ? `&events=${events}` : '';
    const timeParam = 'range' in timeframe
      ? `range=${timeframe.range}`
      : `period1=${timeframe.period1}&period2=${timeframe.period2}`;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?${timeParam}&interval=1d${eventsParam}`;
    const res = await fetch(url, { headers: YAHOO_HEADERS });
    if (!res.ok) return null;
    const data = await res.json<any>();
    return data?.chart?.result?.[0] ?? null;
  } catch {
    return null;
  }
}

type TickerSuggestion = { symbol: string; name: string; market: Market };

async function searchTickers(query: string): Promise<TickerSuggestion[]> {
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0`;
    const res = await fetch(url, { headers: YAHOO_HEADERS });
    if (!res.ok) return [];
    const data = await res.json<any>();
    const quotes: any[] = data?.quotes ?? [];
    return quotes
      .filter((q) => q.symbol && (q.quoteType === 'EQUITY' || q.quoteType === 'ETF'))
      .map((q) => ({
        symbol: q.symbol as string,
        name: (q.shortname || q.longname || q.symbol) as string,
        market: (q.symbol as string).endsWith('.TA') || q.exchange === 'TLV' ? 'IL' : 'US',
      }));
  } catch {
    return [];
  }
}

async function getQuote(env: Bindings, ticker: string): Promise<number | null> {
  const cached = await env.DB.prepare(
    'SELECT price, updated_at FROM quote_cache WHERE ticker = ?'
  ).bind(ticker).first<{ price: number; updated_at: string }>();

  if (cached && Date.now() - new Date(cached.updated_at).getTime() < QUOTE_CACHE_TTL_MS) {
    return cached.price;
  }

  const result = await fetchYahooChart(ticker, { range: '5d' });
  const price = result?.meta?.regularMarketPrice;
  if (typeof price !== 'number') return cached?.price ?? null;

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

// Tries increasingly loose tolerances so a precise price still returns a
// short, relevant list instead of either nothing or a wall of loose matches.
const PRICE_TOLERANCES = [0.008, 0.02, 0.04];

async function findHistoricalDates(ticker: string, targetPrice: number, year?: number): Promise<HistoryMatch[]> {
  const timeframe: ChartTimeframe = year
    ? {
        period1: Math.floor(new Date(Date.UTC(year, 0, 1)).getTime() / 1000),
        period2: Math.min(Math.floor(new Date(Date.UTC(year, 11, 31)).getTime() / 1000), Math.floor(Date.now() / 1000)),
      }
    : { range: '10y' };

  const result = await fetchYahooChart(ticker, timeframe);
  if (!result) return [];

  const timestamps: number[] = result.timestamp ?? [];
  const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
  const points = timestamps
    .map((ts, i) => (closes[i] == null ? null : { date: new Date(ts * 1000).toISOString().slice(0, 10), price: closes[i]! }))
    .filter((p): p is HistoryMatch => p !== null);

  for (const tolerance of PRICE_TOLERANCES) {
    const matches: HistoryMatch[] = [];
    let cooldown = 0;
    for (const point of points) {
      if (cooldown > 0) {
        cooldown--;
        continue;
      }
      if (Math.abs(point.price - targetPrice) / targetPrice <= tolerance) {
        matches.push(point);
        cooldown = year ? 3 : 15; // a narrow one-year window needs less spacing than a decade
      }
    }
    if (matches.length > 0) {
      matches.sort((a, b) => Math.abs(a.price - targetPrice) - Math.abs(b.price - targetPrice));
      return matches.slice(0, 8);
    }
  }

  return [];
}

// ---------- Dividend auto-discovery ----------

type DivPoint = { date: string; amount: number };

async function fetchDividendHistory(ticker: string): Promise<DivPoint[]> {
  const result = await fetchYahooChart(ticker, { range: '10y' }, 'div');
  const raw = result?.events?.dividends;
  if (!raw) return [];
  return Object.values(raw as Record<string, { amount: number; date: number }>)
    .map((p) => ({ date: new Date(p.date * 1000).toISOString().slice(0, 10), amount: p.amount }))
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
  if (history.length === 0) return;

  // Batched into one round trip (rather than a read-then-write per payment)
  // since a decade of quarterly dividends is ~40 statements.
  const statements = history.map((point) =>
    env.DB.prepare(
      `INSERT INTO dividend_payments (ticker, amount_per_share, payment_date, status, shares_at_payment)
       VALUES (?, ?, ?, 'paid', ?)
       ON CONFLICT(ticker, payment_date) DO UPDATE SET
         amount_per_share = excluded.amount_per_share,
         status = 'paid',
         shares_at_payment = excluded.shares_at_payment`
    ).bind(ticker, point.amount, point.date, shares)
  );

  const next = projectNextDividend(history);
  if (next) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO dividend_payments (ticker, amount_per_share, payment_date, status, shares_at_payment)
         VALUES (?, ?, ?, 'expected', ?)
         ON CONFLICT(ticker, payment_date) DO NOTHING`
      ).bind(ticker, next.amount, next.date, shares)
    );
  }

  await env.DB.batch(statements);
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

  // Runs after the response is sent so adding a holding feels instant;
  // dividend history shows up moments later on the next refresh.
  c.executionCtx.waitUntil(syncDividendsForHolding(c.env, normalizedTicker, shares).catch(() => {}));

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

  c.executionCtx.waitUntil(syncDividendsForHolding(c.env, ticker, shares).catch(() => {}));

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

app.post('/api/dividends/sync-all', async (c) => {
  const { results: holdings } = await c.env.DB.prepare('SELECT ticker, shares FROM holdings').all<{ ticker: string; shares: number }>();
  for (const h of holdings) {
    await syncDividendsForHolding(c.env, h.ticker, h.shares).catch(() => {});
  }
  return c.json({ ok: true, synced: holdings.length });
});

// ---------- Ticker/name search (also resolves the market automatically) ----------

app.get('/api/search-ticker', async (c) => {
  const q = c.req.query('q')?.trim() ?? '';
  if (q.length < 2) return c.json({ results: [] });
  const results = await searchTickers(q);
  return c.json({ results });
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
  const yearParam = c.req.query('year');
  const year = yearParam ? parseInt(yearParam, 10) : undefined;
  if (year !== undefined && (Number.isNaN(year) || year < 1980 || year > new Date().getFullYear())) {
    return c.json({ error: 'year must be a valid past year' }, 400);
  }
  const matches = await findHistoricalDates(ticker, price, year);
  return c.json({ ticker, matches });
});

// ---------- Portfolio summary ----------

app.get('/api/summary', async (c) => {
  const { results: holdings } = await c.env.DB.prepare('SELECT * FROM holdings').all<Holding>();
  const fxRate = await getUsdIlsRate(c.env);

  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  // Only count dividends paid on/after each stock's purchase date — otherwise
  // a stock's dividend history from before it was ever bought gets counted
  // as if it were income the user actually received.
  const { results: paidLastYear } = await c.env.DB.prepare(
    `SELECT dp.ticker, dp.amount_per_share, dp.shares_at_payment
     FROM dividend_payments dp
     LEFT JOIN holdings h ON h.ticker = dp.ticker
     WHERE dp.status = 'paid' AND dp.payment_date >= ?
       AND (h.purchase_date IS NULL OR dp.payment_date >= h.purchase_date)`
  ).bind(oneYearAgo.toISOString().slice(0, 10)).all<{ ticker: string; amount_per_share: number; shares_at_payment: number | null }>();

  const dividendIncomeByTicker = new Map<string, number>();
  for (const p of paidLastYear) {
    const amount = p.amount_per_share * (p.shares_at_payment ?? 0);
    dividendIncomeByTicker.set(p.ticker, (dividendIncomeByTicker.get(p.ticker) ?? 0) + amount);
  }

  let totalInvested = 0;
  let currentValue = 0;
  const holdingsWithPrice = [];
  for (const h of holdings) {
    const currency = currencyForTicker(h.ticker);
    const toILS = toILSFactor(currency, fxRate);
    const price = await getQuote(c.env, h.ticker);
    const nativeValue = (price ?? 0) * h.shares;

    currentValue += nativeValue * toILS;
    totalInvested += h.amount_invested * toILS;
    const gainPct = h.amount_invested > 0 ? ((nativeValue - h.amount_invested) / h.amount_invested) * 100 : 0;
    // Trailing-12-month dividend income relative to current market value
    // (standard dividend yield, not yield on cost).
    const stockDividendIncome = dividendIncomeByTicker.get(h.ticker) ?? 0;
    const dividendYieldPct = nativeValue > 0 ? (stockDividendIncome / nativeValue) * 100 : 0;
    holdingsWithPrice.push({ ...h, currency, currentPrice: price, currentValue: nativeValue, gainPct, dividendYieldPct });
  }

  const annualDividendIncome = paidLastYear.reduce((sum, p) => {
    const toILS = toILSFactor(currencyForTicker(p.ticker), fxRate);
    return sum + p.amount_per_share * (p.shares_at_payment ?? 0) * toILS;
  }, 0);

  const annualYieldPct = totalInvested > 0 ? (annualDividendIncome / totalInvested) * 100 : 0;
  const monthlyAvgIncome = annualDividendIncome / 12;
  const gainLoss = currentValue - totalInvested;
  const gainLossPct = totalInvested > 0 ? (gainLoss / totalInvested) * 100 : 0;

  return c.json({
    totalInvested,
    currentValue,
    gainLoss,
    gainLossPct,
    annualDividendIncome,
    annualYieldPct,
    monthlyAvgIncome,
    fxRate,
    holdings: holdingsWithPrice,
  });
});

// ---------- Dividend income growth (month over month, year over year) ----------

app.get('/api/dividends/income-growth', async (c) => {
  const { results: paid } = await c.env.DB.prepare(
    `SELECT dp.ticker, dp.amount_per_share, dp.payment_date, dp.shares_at_payment
     FROM dividend_payments dp
     LEFT JOIN holdings h ON h.ticker = dp.ticker
     WHERE dp.status = 'paid' AND (h.purchase_date IS NULL OR dp.payment_date >= h.purchase_date)
     ORDER BY dp.payment_date`
  ).all<{ ticker: string; amount_per_share: number; payment_date: string; shares_at_payment: number | null }>();
  const fxRate = await getUsdIlsRate(c.env);

  const byMonth = new Map<string, number>();
  const byYear = new Map<string, number>();
  for (const p of paid) {
    const toILS = toILSFactor(currencyForTicker(p.ticker), fxRate);
    const amountILS = p.amount_per_share * (p.shares_at_payment ?? 0) * toILS;
    const month = p.payment_date.slice(0, 7);
    const year = p.payment_date.slice(0, 4);
    byMonth.set(month, (byMonth.get(month) ?? 0) + amountILS);
    byYear.set(year, (byYear.get(year) ?? 0) + amountILS);
  }

  const toSeries = (map: Map<string, number>) => {
    const entries = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    let prev: number | null = null;
    return entries.map(([period, total]) => {
      const growthPct = prev != null && prev > 0 ? ((total - prev) / prev) * 100 : null;
      prev = total;
      return { period, total, growthPct };
    });
  };

  return c.json({ monthly: toSeries(byMonth), yearly: toSeries(byYear) });
});

export default app;
