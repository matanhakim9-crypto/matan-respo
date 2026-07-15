import { Hono } from 'hono';

type Bindings = {
  DB: D1Database;
};

type Market = 'US' | 'IL';

type Holding = {
  id: number;
  ticker: string;
  market: Market;
  company_name: string | null;
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

// Yahoo's free-text search doesn't reliably match Hebrew company names, so
// well-known TASE stocks are also matched against this local alias list.
// Every candidate from here is verified with a live quote before being
// suggested (see searchTickers), so a stale/wrong guess here is filtered
// out silently rather than shown as real.
const ISRAELI_STOCK_ALIASES: { names: string[]; symbol: string; displayName: string }[] = [
  // Banks
  { names: ['בנק הפועלים', 'הפועלים', 'poalim'], symbol: 'POLI.TA', displayName: 'בנק הפועלים' },
  { names: ['בנק לאומי', 'לאומי', 'leumi'], symbol: 'LUMI.TA', displayName: 'בנק לאומי' },
  { names: ['בנק דיסקונט', 'דיסקונט', 'discount bank'], symbol: 'DSCT.TA', displayName: 'בנק דיסקונט' },
  { names: ['מזרחי טפחות', 'מזרחי', 'טפחות', 'mizrahi'], symbol: 'MZTF.TA', displayName: 'מזרחי טפחות' },
  { names: ['בנק בינלאומי', 'הבינלאומי', 'בינלאומי', 'בנלאומי', 'פיבי', 'fibi'], symbol: 'FIBI.TA', displayName: 'הבנק הבינלאומי' },
  { names: ['בנק ירושלים', 'ירושלים', 'jerusalem bank'], symbol: 'JBNK.TA', displayName: 'בנק ירושלים' },
  { names: ['בנק אגוד', 'איגוד'], symbol: 'UNON.TA', displayName: 'בנק אגוד' },
  // Insurance
  { names: ['הראל השקעות', 'הראל', 'harel'], symbol: 'HARL.TA', displayName: 'הראל השקעות' },
  { names: ['כלל החזקות', 'כלל ביטוח', 'כלל', 'clal'], symbol: 'CLIS.TA', displayName: 'כלל החזקות' },
  { names: ['מגדל ביטוח', 'מגדל אחזקות', 'מגדל', 'migdal'], symbol: 'MGDL.TA', displayName: 'מגדל ביטוח' },
  { names: ['הפניקס', 'phoenix'], symbol: 'PHOE1.TA', displayName: 'הפניקס' },
  { names: ['מנורה מבטחים', 'מנורה', 'menora'], symbol: 'MMHD.TA', displayName: 'מנורה מבטחים' },
  { names: ['איילון ביטוח', 'איילון', 'ayalon'], symbol: 'AYAL.TA', displayName: 'איילון ביטוח' },
  // Real estate / malls
  { names: ['עזריאלי', 'azrieli'], symbol: 'AZRG.TA', displayName: 'עזריאלי' },
  { names: ['מליסרון', 'melisron'], symbol: 'MLSR.TA', displayName: 'מליסרון' },
  { names: ['גזית גלוב', 'gazit'], symbol: 'GZT.TA', displayName: 'גזית גלוב' },
  { names: ['אלוני חץ', 'alony hetz'], symbol: 'ALHE.TA', displayName: 'אלוני חץ' },
  { names: ['אמות השקעות', 'אמות', 'amot'], symbol: 'AMOT.TA', displayName: 'אמות השקעות' },
  { names: ['ביג מרכזי קניות', 'ביג', 'big shopping'], symbol: 'BIG.TA', displayName: 'ביג מרכזי קניות' },
  { names: ['דמרי', 'demri'], symbol: 'DMRI.TA', displayName: 'דמרי' },
  { names: ['אשטרום נכסים', 'אשטרום', 'ashtrom'], symbol: 'ASPR.TA', displayName: 'אשטרום נכסים' },
  { names: ['שיכון ובינוי', 'shikun binui'], symbol: 'SKBN.TA', displayName: 'שיכון ובינוי' },
  { names: ['אפריקה ישראל נכסים', 'אפריקה ישראל', 'africa israel'], symbol: 'AFPR.TA', displayName: 'אפריקה ישראל נכסים' },
  { names: ['נכסים ובנין', 'נכסים ובניין'], symbol: 'BNIN.TA', displayName: 'נכסים ובנין' },
  { names: ['רבוע כחול נדלן', 'רבוע כחול נדל"ן'], symbol: 'BLSR.TA', displayName: 'רבוע כחול נדל"ן' },
  { names: ['מגה אור', 'mega or'], symbol: 'MGOR.TA', displayName: 'מגה אור' },
  { names: ['ישרס', 'isras'], symbol: 'ISRS.TA', displayName: 'ישרס' },
  // Retail / food / consumer
  { names: ['שופרסל', 'shufersal'], symbol: 'SAE.TA', displayName: 'שופרסל' },
  { names: ['רמי לוי', 'rami levy'], symbol: 'RMLI.TA', displayName: 'רמי לוי' },
  { names: ['ויקטורי', 'victory'], symbol: 'VICT.TA', displayName: 'ויקטורי' },
  { names: ['אלקטרה מוצרי צריכה', 'אלקטרה קונסיומר', 'electra consumer'], symbol: 'ECP.TA', displayName: 'אלקטרה מוצרי צריכה' },
  { names: ['שטראוס', 'שטראוס גרופ', 'strauss'], symbol: 'STRS.TA', displayName: 'שטראוס גרופ' },
  { names: ['מכתשים אגן', 'אדמה', 'adama'], symbol: 'ADAM.TA', displayName: 'אדמה' },
  { names: ['טיב טעם', 'tiv taam'], symbol: 'TIVT.TA', displayName: 'טיב טעם' },
  { names: ['יינות ביתן'], symbol: 'MYBT.TA', displayName: 'יינות ביתן' },
  { names: ['פוקס', 'fox'], symbol: 'FOX.TA', displayName: 'פוקס' },
  { names: ['קסטרו', 'castro'], symbol: 'CAST.TA', displayName: 'קסטרו' },
  { names: ['גולף', 'golf'], symbol: 'GOLF.TA', displayName: 'גולף' },
  // Telecom
  { names: ['בזק', 'bezeq'], symbol: 'BEZQ.TA', displayName: 'בזק' },
  { names: ['פרטנר', 'partner'], symbol: 'PTNR.TA', displayName: 'פרטנר' },
  { names: ['סלקום', 'cellcom'], symbol: 'CEL.TA', displayName: 'סלקום' },
  { names: ['הוט', 'hot'], symbol: 'HOT.TA', displayName: 'הוט' },
  // Energy / chemicals
  { names: ['דלק קבוצה', 'delek group'], symbol: 'DLEKG.TA', displayName: 'דלק קבוצה' },
  { names: ['פז נפט', 'פז', 'paz'], symbol: 'PZ.TA', displayName: 'פז נפט' },
  { names: ['איי סי אל', 'כיל', 'icl'], symbol: 'ICL.TA', displayName: 'איי.סי.אל' },
  { names: ['נאוויטס פטרוליום', 'נאוויטס', 'navitas'], symbol: 'NVPT.TA', displayName: 'נאוויטס פטרוליום' },
  { names: ['אנרג׳יאן', 'אנרג׳יין', 'energean'], symbol: 'ENOG.TA', displayName: 'אנרג׳יאן' },
  { names: ['אורמת טכנולוגיות', 'אורמת', 'ormat'], symbol: 'ORA.TA', displayName: 'אורמת טכנולוגיות' },
  { names: ['רציו', 'ratio'], symbol: 'RATI.TA', displayName: 'רציו' },
  // Tech / industrials
  { names: ['טבע', 'טבע תעשיות', 'teva'], symbol: 'TEVA.TA', displayName: 'טבע תעשיות' },
  { names: ['נייס', 'nice'], symbol: 'NICE.TA', displayName: 'נייס' },
  { names: ['אלביט מערכות', 'אלביט', 'elbit'], symbol: 'ESLT.TA', displayName: 'אלביט מערכות' },
  { names: ['וויקס', 'wix'], symbol: 'WIX', displayName: 'Wix' },
  { names: ['צ׳ק פוינט', 'צ׳ק פוינט טכנולוגיות', 'checkpoint', 'check point'], symbol: 'CHKP', displayName: 'Check Point' },
  { names: ['טאואר סמיקונדקטור', 'טאואר', 'tower semiconductor'], symbol: 'TSEM.TA', displayName: 'טאואר סמיקונדקטור' },
  { names: ['מלם תים', 'malam team'], symbol: 'MLTM.TA', displayName: 'מלם תים' },
  { names: ['פורמולה מערכות', 'פורמולה', 'formula systems'], symbol: 'FORTY.TA', displayName: 'פורמולה מערכות' },
  { names: ['מטריקס', 'matrix'], symbol: 'MTRX.TA', displayName: 'מטריקס' },
  { names: ['אורביט טכנולוגיות', 'אורביט', 'orbit'], symbol: 'ORBI.TA', displayName: 'אורביט טכנולוגיות' },
  { names: ['אלרון', 'elron'], symbol: 'ELRN.TA', displayName: 'אלרון' },
  { names: ['סאפייר', 'sapiens'], symbol: 'SPNS.TA', displayName: 'סאפיינס' },
  { names: ['רדהיל ביופארמה', 'רדהיל', 'redhill'], symbol: 'RDHL.TA', displayName: 'רדהיל ביופארמה' },
  // Diversified holding companies
  { names: ['אי די בי פתוח', 'אי די בי', 'idb'], symbol: 'IDBD.TA', displayName: 'אי.די.בי פתוח' },
  { names: ['דיסקונט השקעות', 'דסק"ש', 'dic'], symbol: 'DISI.TA', displayName: 'דיסקונט השקעות' },
  { names: ['אלקו', 'elco'], symbol: 'ELCO.TA', displayName: 'אלקו' },
  { names: ['החברה לישראל', 'ילין', 'israel corp'], symbol: 'ILCO.TA', displayName: 'החברה לישראל' },
];

function matchLocalAliases(query: string): { symbol: string; displayName: string }[] {
  const q = query.trim().toLowerCase();
  const matches: { symbol: string; displayName: string }[] = [];
  for (const entry of ISRAELI_STOCK_ALIASES) {
    const hit = entry.names.some((n) => {
      const name = n.toLowerCase();
      return name.includes(q) || q.includes(name);
    });
    if (hit) matches.push({ symbol: entry.symbol, displayName: entry.displayName });
  }
  return matches;
}

async function symbolHasQuote(ticker: string): Promise<boolean> {
  const result = await fetchYahooChart(ticker, { range: '5d' });
  return typeof result?.meta?.regularMarketPrice === 'number';
}

// Companies successfully resolved through Wikipedia get remembered here, so
// the next search for the same name is an instant DB hit instead of another
// Wikipedia + Yahoo round trip. This grows the effective coverage of the
// hand-curated alias list over time as real searches happen.
async function matchDbAliases(env: Bindings, query: string): Promise<TickerSuggestion[]> {
  const q = query.trim();
  if (!q) return [];
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT symbol, display_name, market FROM ticker_aliases
     WHERE ? LIKE '%' || query || '%' OR query LIKE '%' || ? || '%'`
  ).bind(q, q).all<{ symbol: string; display_name: string; market: Market }>();
  return results.map((r) => ({ symbol: r.symbol, name: r.display_name, market: r.market }));
}

async function rememberAlias(env: Bindings, query: string, suggestion: TickerSuggestion): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO ticker_aliases (query, symbol, display_name, market, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(query, symbol) DO NOTHING`
    ).bind(query.trim(), suggestion.symbol, suggestion.name, suggestion.market, new Date().toISOString()).run();
  } catch {
    // best-effort cache; a failure here shouldn't break the search response
  }
}

// Yahoo's search barely understands Hebrew, but Hebrew Wikipedia does. Many
// smaller/local companies (e.g. TASE-only REITs) have a Hebrew Wikipedia
// article and a linked Wikidata entity but no full English Wikipedia
// article, so a plain inter-language link often comes up empty. Wikidata's
// English *label* is filled in far more often than a full English article,
// so resolve through that instead: Hebrew Wikipedia search -> its Wikidata
// item -> that item's English label -> fed into the same Yahoo search used
// for English queries. The Hebrew Wikipedia article's own title is kept too,
// so results can be labeled in Hebrew instead of Yahoo's English name.
async function resolveViaWikipedia(query: string): Promise<{ hebrewName: string; englishName: string } | null> {
  try {
    const searchUrl = `https://he.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=1&prop=pageprops&ppprop=wikibase_item`;
    const searchRes = await fetch(searchUrl, { headers: YAHOO_HEADERS });
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json<any>();
    const pages = searchData?.query?.pages;
    if (!pages) return null;
    const page = Object.values(pages)[0] as any;
    const hebrewName = page?.title;
    const qid = page?.pageprops?.wikibase_item;
    if (typeof hebrewName !== 'string' || typeof qid !== 'string') return null;

    const entityUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=labels&languages=en&format=json`;
    const entityRes = await fetch(entityUrl, { headers: YAHOO_HEADERS });
    if (!entityRes.ok) return null;
    const entityData = await entityRes.json<any>();
    const englishName = entityData?.entities?.[qid]?.labels?.en?.value;
    return typeof englishName === 'string' ? { hebrewName, englishName } : null;
  } catch {
    return null;
  }
}

async function searchYahoo(query: string, results: TickerSuggestion[]): Promise<void> {
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0`;
    const res = await fetch(url, { headers: YAHOO_HEADERS });
    if (!res.ok) return;
    const data = await res.json<any>();
    const quotes: any[] = data?.quotes ?? [];
    for (const q of quotes) {
      if (!q.symbol || (q.quoteType !== 'EQUITY' && q.quoteType !== 'ETF')) continue;
      if (results.some((r) => r.symbol === q.symbol)) continue;
      results.push({
        symbol: q.symbol,
        name: q.shortname || q.longname || q.symbol,
        market: (q.symbol as string).endsWith('.TA') || q.exchange === 'TLV' ? 'IL' : 'US',
      });
    }
  } catch {
    // other sources (local aliases, earlier queries) still stand
  }
}

async function searchTickers(env: Bindings, query: string): Promise<TickerSuggestion[]> {
  const results: TickerSuggestion[] = [];

  const localMatches = matchLocalAliases(query);
  for (const m of localMatches) {
    if (await symbolHasQuote(m.symbol)) {
      results.push({ symbol: m.symbol, name: m.displayName, market: 'IL' });
    }
  }

  for (const m of await matchDbAliases(env, query)) {
    if (!results.some((r) => r.symbol === m.symbol)) results.push(m);
  }

  const beforeLiveSearch = results.length;

  await searchYahoo(query, results);

  const isHebrew = /[֐-׿]/.test(query);
  if (isHebrew) {
    const resolved = await resolveViaWikipedia(query);
    if (resolved) {
      const beforeWikipediaSearch = results.length;
      await searchYahoo(resolved.englishName, results);
      // Yahoo's own name for the match is in English; the Hebrew Wikipedia
      // article title is the more useful label to show the user.
      for (const r of results.slice(beforeWikipediaSearch)) {
        if (r.market === 'IL') r.name = resolved.hebrewName;
      }
    }
  }

  // Remember anything newly discovered via a live Hebrew search so the next
  // person (or the next time) skips straight to the DB cache.
  if (isHebrew) {
    for (const r of results.slice(beforeLiveSearch)) {
      await rememberAlias(env, query, r);
    }
  }

  return results.slice(0, 8);
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

// Closest trading-day close to a given date, used to sanity-check a
// user-entered purchase price (weekends/holidays fall back to the nearest
// trading day within the window instead of finding nothing).
async function getHistoricalPriceNear(ticker: string, dateStr: string): Promise<number | null> {
  const targetMs = new Date(`${dateStr}T00:00:00Z`).getTime();
  if (Number.isNaN(targetMs)) return null;
  const period1 = Math.floor(targetMs / 1000) - 10 * 24 * 3600;
  const period2 = Math.floor(targetMs / 1000) + 5 * 24 * 3600;
  const result = await fetchYahooChart(ticker, { period1, period2 });
  if (!result) return null;

  const timestamps: number[] = result.timestamp ?? [];
  const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
  const points = timestamps
    .map((ts, i) => (closes[i] == null ? null : { ms: ts * 1000, price: closes[i]! }))
    .filter((p): p is { ms: number; price: number } => p !== null);
  if (points.length === 0) return null;

  points.sort((a, b) => Math.abs(a.ms - targetMs) - Math.abs(b.ms - targetMs));
  return points[0].price;
}

// Rejects purchases with a price wildly inconsistent with where the stock
// actually traded on that date (e.g. entering today's price for a purchase
// a year ago) — a loose enough tolerance to still allow normal
// day-to-day/intraday variation and imprecise memory.
const PURCHASE_PRICE_SANITY_TOLERANCE = 0.3;

async function validatePurchasePrice(ticker: string, purchaseDate: string | null, purchasePrice: number): Promise<string | null> {
  if (!purchaseDate) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (purchaseDate > today) return 'תאריך הקנייה לא יכול להיות בעתיד';

  const historicalPrice = await getHistoricalPriceNear(ticker, purchaseDate);
  if (historicalPrice == null || historicalPrice <= 0) return null; // can't verify — don't block

  const diff = Math.abs(purchasePrice - historicalPrice) / historicalPrice;
  if (diff <= PURCHASE_PRICE_SANITY_TOLERANCE) return null;

  const isIL = ticker.endsWith('.TA');
  const priceLabel = isIL ? `כ-${historicalPrice.toFixed(2)} אג'` : `כ-$${historicalPrice.toFixed(2)}`;
  return `המחיר שהזנת רחוק מדי מהמחיר האמיתי של המניה בתאריך הזה (מחיר בפועל היה ${priceLabel}). בדוק את המחיר או התאריך.`;
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

// A ticker can now be held across multiple purchase lots (e.g. bought more
// shares later at a different price/date), so dividend history is synced
// per ticker rather than per lot — and each payment's shares_at_payment
// reflects only the lots already purchased by that payment's date, not the
// portfolio's current total.
async function syncDividendsForTicker(env: Bindings, ticker: string): Promise<void> {
  const { results: lots } = await env.DB.prepare(
    'SELECT shares, purchase_date FROM holdings WHERE ticker = ?'
  ).bind(ticker).all<{ shares: number; purchase_date: string | null }>();

  if (lots.length === 0) {
    // Every lot for this ticker was removed — nothing left to show history for.
    await env.DB.prepare('DELETE FROM dividend_payments WHERE ticker = ?').bind(ticker).run();
    return;
  }

  const history = await fetchDividendHistory(ticker);
  if (history.length === 0) return;

  // Real dividend eligibility requires owning the stock BEFORE the ex-dividend
  // date (`date` here) — buying on the ex-date itself is already too late, the
  // seller keeps that payment. Hence strictly-less-than, not <=.
  const sharesHeldOn = (date: string) =>
    lots.reduce((sum, lot) => sum + (!lot.purchase_date || lot.purchase_date < date ? lot.shares : 0), 0);

  // Full replace (not an incremental upsert) so lots added/edited/removed
  // since the last sync are always reflected correctly.
  const statements = [env.DB.prepare('DELETE FROM dividend_payments WHERE ticker = ?').bind(ticker)];

  for (const point of history) {
    const shares = sharesHeldOn(point.date);
    if (shares <= 0) continue; // not owned yet as of this payment
    statements.push(
      env.DB.prepare(
        `INSERT INTO dividend_payments (ticker, amount_per_share, payment_date, status, shares_at_payment)
         VALUES (?, ?, ?, 'paid', ?)`
      ).bind(ticker, point.amount, point.date, shares)
    );
  }

  const next = projectNextDividend(history);
  if (next) {
    const totalShares = lots.reduce((sum, lot) => sum + lot.shares, 0);
    statements.push(
      env.DB.prepare(
        `INSERT INTO dividend_payments (ticker, amount_per_share, payment_date, status, shares_at_payment)
         VALUES (?, ?, ?, 'expected', ?)`
      ).bind(ticker, next.amount, next.date, totalShares)
    );
  }

  await env.DB.batch(statements);
}

// ---------- Holdings ----------

app.get('/api/holdings', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM holdings ORDER BY market, ticker').all<Holding>();
  return c.json(results);
});

app.post('/api/holdings', async (c) => {
  const body = await c.req.json<Partial<Holding> & { market?: string }>();
  const { ticker, shares, purchase_price, purchase_date, notes, company_name } = body;
  const market: Market = body.market === 'IL' ? 'IL' : 'US';
  if (!ticker || !shares || !purchase_price) {
    return c.json({ error: 'ticker, shares and purchase_price are required' }, 400);
  }
  const normalizedTicker = normalizeTicker(ticker, market);

  const priceError = await validatePurchasePrice(normalizedTicker, purchase_date ?? null, purchase_price);
  if (priceError) return c.json({ error: priceError }, 400);

  const amount_invested = shares * purchase_price;
  const result = await c.env.DB.prepare(
    `INSERT INTO holdings (ticker, market, company_name, shares, purchase_price, amount_invested, purchase_date, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(normalizedTicker, market, company_name ?? null, shares, purchase_price, amount_invested, purchase_date ?? null, notes ?? null).run();

  // Runs after the response is sent so adding a holding feels instant;
  // dividend history shows up moments later on the next refresh.
  c.executionCtx.waitUntil(syncDividendsForTicker(c.env, normalizedTicker).catch(() => {}));

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
  const company_name = body.company_name !== undefined ? body.company_name : existing.company_name;

  if (!ticker || !shares || !purchase_price) {
    return c.json({ error: 'ticker, shares and purchase_price are required' }, 400);
  }

  const priceError = await validatePurchasePrice(ticker, purchase_date ?? null, purchase_price);
  if (priceError) return c.json({ error: priceError }, 400);

  const amount_invested = shares * purchase_price;

  await c.env.DB.prepare(
    `UPDATE holdings SET ticker = ?, market = ?, company_name = ?, shares = ?, purchase_price = ?, amount_invested = ?, purchase_date = ?, notes = ?
     WHERE id = ?`
  ).bind(ticker, market, company_name ?? null, shares, purchase_price, amount_invested, purchase_date, notes, id).run();

  c.executionCtx.waitUntil(syncDividendsForTicker(c.env, ticker).catch(() => {}));
  // If this lot moved to a different ticker, the old ticker's remaining
  // lots (if any) also need their share-history recomputed.
  if (existing.ticker !== ticker) {
    c.executionCtx.waitUntil(syncDividendsForTicker(c.env, existing.ticker).catch(() => {}));
  }

  return c.json({ ok: true });
});

app.delete('/api/holdings/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT ticker FROM holdings WHERE id = ?').bind(id).first<{ ticker: string }>();
  await c.env.DB.prepare('DELETE FROM holdings WHERE id = ?').bind(id).run();
  if (existing) {
    c.executionCtx.waitUntil(syncDividendsForTicker(c.env, existing.ticker).catch(() => {}));
  }
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
  const { results: tickers } = await c.env.DB.prepare('SELECT DISTINCT ticker FROM holdings').all<{ ticker: string }>();
  for (const t of tickers) {
    await syncDividendsForTicker(c.env, t.ticker).catch(() => {});
  }
  return c.json({ ok: true, synced: tickers.length });
});

// ---------- Ticker/name search (also resolves the market automatically) ----------

app.get('/api/search-ticker', async (c) => {
  const q = c.req.query('q')?.trim() ?? '';
  if (q.length < 2) return c.json({ results: [] });
  const results = await searchTickers(c.env, q);
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
  const { results: rawHoldings } = await c.env.DB.prepare('SELECT * FROM holdings ORDER BY market, ticker, purchase_date').all<Holding>();
  const fxRate = await getUsdIlsRate(c.env);

  // A stock can be held across multiple purchase lots (bought more shares
  // later at a different price/date) — group them into one entry per ticker
  // for display, while keeping the individual lots for per-lot editing.
  const lotsByTicker = new Map<string, Holding[]>();
  for (const h of rawHoldings) {
    if (!lotsByTicker.has(h.ticker)) lotsByTicker.set(h.ticker, []);
    lotsByTicker.get(h.ticker)!.push(h);
  }

  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  // shares_at_payment already accounts for which lots were owned by each
  // payment date (see syncDividendsForTicker), so no join against holdings
  // is needed here to avoid double-counting a ticker with multiple lots.
  const { results: paidLastYear } = await c.env.DB.prepare(
    `SELECT ticker, amount_per_share, shares_at_payment
     FROM dividend_payments
     WHERE status = 'paid' AND payment_date >= ?`
  ).bind(oneYearAgo.toISOString().slice(0, 10)).all<{ ticker: string; amount_per_share: number; shares_at_payment: number | null }>();

  const dividendIncomeByTicker = new Map<string, number>();
  for (const p of paidLastYear) {
    const amount = p.amount_per_share * (p.shares_at_payment ?? 0);
    dividendIncomeByTicker.set(p.ticker, (dividendIncomeByTicker.get(p.ticker) ?? 0) + amount);
  }

  let totalInvested = 0;
  let currentValue = 0;
  const holdingsWithPrice = [];
  for (const [ticker, lots] of lotsByTicker) {
    const shares = lots.reduce((sum, l) => sum + l.shares, 0);
    const amount_invested = lots.reduce((sum, l) => sum + l.amount_invested, 0);
    // Weighted-average purchase price across lots.
    const purchase_price = shares > 0 ? amount_invested / shares : 0;
    const purchase_date = lots.reduce<string | null>(
      (earliest, l) => (l.purchase_date && (!earliest || l.purchase_date < earliest) ? l.purchase_date : earliest),
      null
    );
    const market = lots[0].market;
    const company_name = lots.find((l) => l.company_name)?.company_name ?? null;

    const currency = currencyForTicker(ticker);
    const toILS = toILSFactor(currency, fxRate);
    const price = await getQuote(c.env, ticker);
    const nativeValue = (price ?? 0) * shares;

    currentValue += nativeValue * toILS;
    totalInvested += amount_invested * toILS;
    const gainPct = amount_invested > 0 ? ((nativeValue - amount_invested) / amount_invested) * 100 : 0;
    // Trailing-12-month dividend income relative to current market value
    // (standard dividend yield, not yield on cost).
    const stockDividendIncome = dividendIncomeByTicker.get(ticker) ?? 0;
    const dividendYieldPct = nativeValue > 0 ? (stockDividendIncome / nativeValue) * 100 : 0;
    holdingsWithPrice.push({
      id: lots[0].id,
      ticker,
      market,
      company_name,
      shares,
      purchase_price,
      amount_invested,
      purchase_date,
      notes: null,
      currency,
      currentPrice: price,
      currentValue: nativeValue,
      gainPct,
      dividendYieldPct,
      lots,
    });
  }

  const annualDividendIncome = paidLastYear.reduce((sum, p) => {
    const toILS = toILSFactor(currencyForTicker(p.ticker), fxRate);
    return sum + p.amount_per_share * (p.shares_at_payment ?? 0) * toILS;
  }, 0);

  // Yield on current market value (matches the per-holding yield below),
  // not yield on the original cost basis.
  const annualYieldPct = currentValue > 0 ? (annualDividendIncome / currentValue) * 100 : 0;
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
  // shares_at_payment already reflects which lots were owned by each
  // payment date (see syncDividendsForTicker), so no join is needed.
  const { results: paid } = await c.env.DB.prepare(
    `SELECT ticker, amount_per_share, payment_date, shares_at_payment
     FROM dividend_payments
     WHERE status = 'paid'
     ORDER BY payment_date`
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

app.get('/api/dividends/stats', async (c) => {
  // shares_at_payment already reflects which lots were owned by each
  // payment date (see syncDividendsForTicker), so no join is needed for the
  // sums — market/company_name are looked up separately below instead of via
  // a SQL join, since a ticker with multiple lots would otherwise duplicate
  // each payment row once per matching lot.
  const { results: paid } = await c.env.DB.prepare(
    `SELECT ticker, amount_per_share, payment_date, shares_at_payment
     FROM dividend_payments
     WHERE status = 'paid'`
  ).all<{ ticker: string; amount_per_share: number; payment_date: string; shares_at_payment: number | null }>();
  const fxRate = await getUsdIlsRate(c.env);

  const { results: tickerInfoRows } = await c.env.DB.prepare(
    'SELECT ticker, market, company_name FROM holdings'
  ).all<{ ticker: string; market: Market; company_name: string | null }>();
  const tickerInfo = new Map<string, { market: Market; company_name: string | null }>();
  for (const row of tickerInfoRows) {
    if (!tickerInfo.has(row.ticker) || row.company_name) {
      tickerInfo.set(row.ticker, { market: row.market, company_name: row.company_name });
    }
  }

  const thisYear = String(new Date().getFullYear());
  const lastYear = String(new Date().getFullYear() - 1);

  let totalAllTime = 0;
  let totalIL = 0;
  let totalUS = 0;
  let totalThisYear = 0;
  let totalLastYear = 0;
  const byTicker = new Map<string, { ticker: string; market: Market; company_name: string | null; total: number }>();

  for (const p of paid) {
    const info = tickerInfo.get(p.ticker);
    const market: Market = info?.market === 'IL' ? 'IL' : 'US';
    const toILS = toILSFactor(currencyForTicker(p.ticker), fxRate);
    const amountILS = p.amount_per_share * (p.shares_at_payment ?? 0) * toILS;

    totalAllTime += amountILS;
    if (market === 'IL') totalIL += amountILS;
    else totalUS += amountILS;

    const year = p.payment_date.slice(0, 4);
    if (year === thisYear) totalThisYear += amountILS;
    if (year === lastYear) totalLastYear += amountILS;

    const existing = byTicker.get(p.ticker);
    if (existing) existing.total += amountILS;
    else byTicker.set(p.ticker, { ticker: p.ticker, market, company_name: info?.company_name ?? null, total: amountILS });
  }

  const topPayers = [...byTicker.values()].sort((a, b) => b.total - a.total);

  return c.json({ totalAllTime, totalIL, totalUS, totalThisYear, totalLastYear, topPayers });
});

export default app;
