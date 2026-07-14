import { Hono } from 'hono';

type Bindings = {
  DB: D1Database;
  ALPHA_VANTAGE_API_KEY: string;
};

type Holding = {
  id: number;
  ticker: string;
  shares: number;
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

const app = new Hono<{ Bindings: Bindings }>();

async function getQuote(env: Bindings, ticker: string): Promise<number | null> {
  const cached = await env.DB.prepare(
    'SELECT price, updated_at FROM quote_cache WHERE ticker = ?'
  ).bind(ticker).first<{ price: number; updated_at: string }>();

  if (cached && Date.now() - new Date(cached.updated_at).getTime() < QUOTE_CACHE_TTL_MS) {
    return cached.price;
  }

  if (!env.ALPHA_VANTAGE_API_KEY) {
    return cached?.price ?? null;
  }

  try {
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(ticker)}&apikey=${env.ALPHA_VANTAGE_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return cached?.price ?? null;
    const data = await res.json<any>();
    const price = parseFloat(data?.['Global Quote']?.['05. price']);
    if (!price || Number.isNaN(price)) return cached?.price ?? null;

    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO quote_cache (ticker, price, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(ticker) DO UPDATE SET price = excluded.price, updated_at = excluded.updated_at`
    ).bind(ticker, price, now).run();

    return price;
  } catch {
    return cached?.price ?? null;
  }
}

// ---------- Holdings ----------

app.get('/api/holdings', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM holdings ORDER BY ticker').all<Holding>();
  return c.json(results);
});

app.post('/api/holdings', async (c) => {
  const body = await c.req.json<Partial<Holding>>();
  const { ticker, shares, amount_invested, purchase_date, notes } = body;
  if (!ticker || !shares || !amount_invested) {
    return c.json({ error: 'ticker, shares and amount_invested are required' }, 400);
  }
  const result = await c.env.DB.prepare(
    'INSERT INTO holdings (ticker, shares, amount_invested, purchase_date, notes) VALUES (?, ?, ?, ?, ?)'
  ).bind(ticker.toUpperCase(), shares, amount_invested, purchase_date ?? null, notes ?? null).run();
  return c.json({ id: result.meta.last_row_id }, 201);
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
  const body = await c.req.json<Partial<DividendPayment>>();
  const { ticker, amount_per_share, payment_date, status, shares_at_payment } = body;
  if (!ticker || !amount_per_share || !payment_date) {
    return c.json({ error: 'ticker, amount_per_share and payment_date are required' }, 400);
  }
  const result = await c.env.DB.prepare(
    `INSERT INTO dividend_payments (ticker, amount_per_share, payment_date, status, shares_at_payment)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(
    ticker.toUpperCase(),
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

// ---------- Live quote ----------

app.get('/api/quote/:ticker', async (c) => {
  const ticker = c.req.param('ticker').toUpperCase();
  const price = await getQuote(c.env, ticker);
  if (price === null) return c.json({ error: 'quote unavailable' }, 502);
  return c.json({ ticker, price });
});

// ---------- Portfolio summary ----------

app.get('/api/summary', async (c) => {
  const { results: holdings } = await c.env.DB.prepare('SELECT * FROM holdings').all<Holding>();

  const totalInvested = holdings.reduce((sum, h) => sum + h.amount_invested, 0);

  let currentValue = 0;
  const holdingsWithPrice = [];
  for (const h of holdings) {
    const price = await getQuote(c.env, h.ticker);
    const value = (price ?? 0) * h.shares;
    currentValue += value;
    holdingsWithPrice.push({ ...h, currentPrice: price, currentValue: value });
  }

  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const { results: paidLastYear } = await c.env.DB.prepare(
    "SELECT amount_per_share, shares_at_payment FROM dividend_payments WHERE status = 'paid' AND payment_date >= ?"
  ).bind(oneYearAgo.toISOString().slice(0, 10)).all<{ amount_per_share: number; shares_at_payment: number | null }>();

  const annualDividendIncome = paidLastYear.reduce(
    (sum, p) => sum + p.amount_per_share * (p.shares_at_payment ?? 0),
    0
  );

  const annualYieldPct = totalInvested > 0 ? (annualDividendIncome / totalInvested) * 100 : 0;
  const monthlyAvgIncome = annualDividendIncome / 12;

  return c.json({
    totalInvested,
    currentValue,
    gainLoss: currentValue - totalInvested,
    annualDividendIncome,
    annualYieldPct,
    monthlyAvgIncome,
    holdings: holdingsWithPrice,
  });
});

export default app;
