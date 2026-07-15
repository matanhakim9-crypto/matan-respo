// 'ILA' (Agorot) isn't a real ISO currency code Intl recognizes, since TASE
// stocks are natively priced and entered in Agorot rather than Shekels.
const fmtMoney = (n, currency = 'ILS') => {
  if (currency === 'ILA') {
    return `${new Intl.NumberFormat('he-IL', { maximumFractionDigits: 2 }).format(n ?? 0)} אג'`;
  }
  return new Intl.NumberFormat('he-IL', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n ?? 0);
};

const fmtPct = (n) => `${(n ?? 0).toFixed(2)}%`;
const fmtDate = (d) => new Date(d).toLocaleDateString('he-IL');
const currencyForTicker = (ticker) => (ticker.endsWith('.TA') ? 'ILA' : 'USD');

// Standard Israeli dividend withholding tax rate for individuals. This is a
// flat estimate, not real brokerage data — actual rate depends on the
// stock's jurisdiction, tax treaties, and the holder's personal status.
const DIVIDEND_TAX_RATE = 0.25;

const AVATAR_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#a855f7', '#ec4899', '#06b6d4', '#f97316', '#84cc16'];
function avatarColor(ticker) {
  let hash = 0;
  for (let i = 0; i < ticker.length; i++) hash = (hash * 31 + ticker.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}
const avatarInitials = (ticker) => ticker.replace('.TA', '').slice(0, 2).toUpperCase();

async function api(path, options) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `${res.status} ${res.statusText}`);
  }
  return res.status === 204 ? null : res.json();
}

let lastHoldings = [];
let lastDividends = [];
let lastStats = null;
let expandedHoldingId = null;

const fmtMoneyCompact = (n) =>
  new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(n ?? 0);

async function loadSummary() {
  const s = await api('/api/summary');
  document.getElementById('s-invested').textContent = fmtMoney(s.totalInvested);
  document.getElementById('s-current').textContent = fmtMoney(s.currentValue);

  const gainEl = document.getElementById('s-gain');
  const isUp = s.gainLoss >= 0;
  const gainSign = isUp ? '+' : '';
  gainEl.textContent = `${isUp ? '▲' : '▼'} ${fmtMoney(s.gainLoss)} (${gainSign}${(s.gainLossPct ?? 0).toFixed(1)}%)`;
  gainEl.classList.toggle('positive', isUp);
  gainEl.classList.toggle('negative', !isUp);

  document.getElementById('s-yield').textContent = fmtPct(s.annualYieldPct);
  document.getElementById('s-monthly').textContent = fmtMoney(s.monthlyAvgIncome);

  lastHoldings = s.holdings ?? [];
  renderHoldings(lastHoldings);
}

let holdingsSearchQuery = '';
// Collapsed-by-default only kicks in once a group is actually long; both
// groups start expanded so a small portfolio isn't hidden behind a click.
let collapsedHoldingGroups = new Set();

function buildHoldingRow(h) {
  const currency = h.currency ?? currencyForTicker(h.ticker);
  const gainPct = h.gainPct ?? 0;
  const gainSign = gainPct >= 0 ? '+' : '';
  const yieldPct = h.dividendYieldPct ?? 0;

  // Purchase price stays in Agorot (matches how it's entered), but the
  // live price/value columns read easier in Shekels for Israeli stocks.
  const isIL = currency === 'ILA';
  const displayCurrency = isIL ? 'ILS' : currency;
  const displayValue = isIL ? h.currentValue / 100 : h.currentValue;

  // Israeli stocks show the company name front and center (more
  // recognizable to a Hebrew-reading user than a TASE ticker symbol);
  // the ticker moves into the secondary line instead.
  const bareTicker = h.ticker.replace('.TA', '');
  const showCompanyName = h.market === 'IL' && h.company_name;
  const primaryLabel = showCompanyName ? h.company_name : bareTicker;
  const subParts = [];
  if (showCompanyName) subParts.push(bareTicker);
  subParts.push(`${h.shares} מניות`);
  if ((h.lots?.length ?? 1) > 1) subParts.push(`${h.lots.length} רכישות`);
  subParts.push(`תשואת דיב' ${yieldPct.toFixed(1)}%`);

  const row = document.createElement('div');
  row.className = 'holding-row';
  row.dataset.holdingId = h.id;
  row.innerHTML = `
    <div class="holding-avatar" style="background:${avatarColor(h.ticker)}">${avatarInitials(h.ticker)}</div>
    <div class="holding-id-block">
      <div class="holding-ticker">${primaryLabel} <span class="market-flag">${h.market === 'IL' ? '🇮🇱' : '🇺🇸'}</span></div>
      <div class="holding-sub">${subParts.join(' · ')}</div>
    </div>
    <div class="holding-value-block">
      <div class="holding-value">${fmtMoney(displayValue, displayCurrency)}</div>
      <div class="holding-gain ${gainPct >= 0 ? 'positive' : 'negative'}">${gainSign}${gainPct.toFixed(1)}%</div>
    </div>
    <span class="expand-arrow">›</span>
  `;
  return row;
}

function renderHoldings(holdings) {
  const body = document.getElementById('holdings-body');
  body.innerHTML = '';
  if (holdings.length === 0) {
    body.innerHTML = '<p class="empty">עדיין אין מניות בתיק</p>';
    return;
  }

  const query = holdingsSearchQuery.trim().toLowerCase();
  const filtered = query
    ? holdings.filter((h) => {
        const bare = h.ticker.replace('.TA', '').toLowerCase();
        const name = (h.company_name || '').toLowerCase();
        return bare.includes(query) || name.includes(query);
      })
    : holdings;

  if (filtered.length === 0) {
    body.innerHTML = '<p class="empty">לא נמצאה מניה תואמת</p>';
    return;
  }

  // Grouped by market instead of one flat list, so a portfolio with many
  // stocks stays scannable — each group is collapsible and shows a subtotal.
  const groups = [
    { key: 'IL', label: 'מניות ישראליות', flag: '🇮🇱', currency: 'ILS' },
    { key: 'US', label: 'מניות אמריקאיות', flag: '🇺🇸', currency: 'USD' },
  ];

  for (const group of groups) {
    const items = filtered.filter((h) => h.market === group.key);
    if (items.length === 0) continue;

    const groupValue = items.reduce((sum, h) => {
      const isIL = (h.currency ?? currencyForTicker(h.ticker)) === 'ILA';
      return sum + (isIL ? h.currentValue / 100 : h.currentValue);
    }, 0);
    const isOpen = !collapsedHoldingGroups.has(group.key);

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'group-header holdings-group-header';
    header.dataset.groupKey = group.key;
    header.innerHTML = `
      <span class="group-title">${group.flag} ${group.label} <span class="group-count">${items.length}</span></span>
      <span class="group-value">${fmtMoney(groupValue, group.currency)}</span>
      <span class="expand-arrow group-arrow ${isOpen ? 'expanded' : ''}">›</span>
    `;
    body.appendChild(header);

    const groupBody = document.createElement('div');
    groupBody.className = 'group-body' + (isOpen ? '' : ' hidden');
    for (const h of items) {
      const row = buildHoldingRow(h);
      groupBody.appendChild(row);
      if (String(h.id) === String(expandedHoldingId)) {
        groupBody.appendChild(buildHoldingDetail(h));
        row.classList.add('expanded');
      }
    }
    body.appendChild(groupBody);
  }
}

document.getElementById('holdings-search-input').addEventListener('input', (e) => {
  holdingsSearchQuery = e.target.value;
  renderHoldings(lastHoldings);
});

document.addEventListener('click', (e) => {
  const header = e.target.closest('.holdings-group-header');
  if (!header) return;
  const key = header.dataset.groupKey;
  if (collapsedHoldingGroups.has(key)) collapsedHoldingGroups.delete(key);
  else collapsedHoldingGroups.add(key);
  renderHoldings(lastHoldings);
});

function buildHoldingDetail(holding) {
  const currency = currencyForTicker(holding.ticker);
  const isIL = currency === 'ILA';
  const displayCurrency = isIL ? 'ILS' : currency;
  const toDisplay = (n) => (isIL ? n / 100 : n);

  const wrap = document.createElement('div');
  wrap.className = 'holding-detail';

  const lots = holding.lots ?? [];
  const hasMultipleLots = lots.length > 1;

  const purchaseInfo = `
    <div class="purchase-info">
      <div class="purchase-stat">
        <span class="purchase-stat-label">${hasMultipleLots ? 'מחיר ממוצע' : 'מחיר קנייה'}</span>
        <span class="purchase-stat-value">${fmtMoney(toDisplay(holding.purchase_price), displayCurrency)}</span>
      </div>
      <div class="purchase-stat">
        <span class="purchase-stat-label">${hasMultipleLots ? 'שווי קנייה כולל' : 'שווי קנייה'}</span>
        <span class="purchase-stat-value">${fmtMoney(toDisplay(holding.amount_invested), displayCurrency)}</span>
      </div>
      <div class="purchase-stat">
        <span class="purchase-stat-label">${hasMultipleLots ? 'כניסה ראשונה' : 'תאריך קנייה'}</span>
        <span class="purchase-stat-value">${holding.purchase_date ? fmtDate(holding.purchase_date) : '—'}</span>
      </div>
      <div class="purchase-stat">
        <span class="purchase-stat-label">תשואת דיב' שנתית</span>
        <span class="purchase-stat-value">${fmtPct(holding.dividendYieldPct)}</span>
      </div>
    </div>
  `;

  // Each purchase is its own lot with its own date/price, since the same
  // stock can be bought more than once (e.g. once in Aug and again in Jan) —
  // editing/deleting acts on a specific lot, not the combined position.
  const lotsSection = `
    <div class="lots-section">
      <div class="lots-header">
        <h3>רכישות (${lots.length})</h3>
        <button type="button" class="add-lot-btn" data-ticker="${holding.ticker}">+ הוסף רכישה</button>
      </div>
      <div class="lot-list">
        ${lots.map((lot) => `
          <div class="lot-row">
            <div class="lot-row-info">
              <span class="lot-row-shares">${lot.shares} מניות · ${fmtMoney(toDisplay(lot.purchase_price), displayCurrency)}</span>
              <span class="lot-row-date">${lot.purchase_date ? fmtDate(lot.purchase_date) : 'ללא תאריך'}</span>
            </div>
            <div class="lot-row-actions">
              <button class="edit-btn" data-id="${lot.id}">ערוך</button>
              <button class="delete-btn" data-id="${lot.id}">מחק</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  wrap.innerHTML = purchaseInfo + lotsSection;
  return wrap;
}

// Per-stock dividend payment history — shown in the reports page (per
// ticker), not on the main holdings screen.
function buildDividendHistorySection(ticker) {
  const currency = currencyForTicker(ticker);
  const isIL = currency === 'ILA';
  const displayCurrency = isIL ? 'ILS' : currency;
  const toDisplay = (n) => (isIL ? n / 100 : n);
  const payments = lastDividends
    .filter((p) => p.ticker === ticker)
    .sort((a, b) => b.payment_date.localeCompare(a.payment_date));

  const wrap = document.createElement('div');
  wrap.className = 'holding-detail';

  if (payments.length === 0) {
    wrap.innerHTML = '<p class="empty">אין עדיין נתוני דיבידנד למניה הזו</p>';
    return wrap;
  }

  const totalFor = (p) => p.amount_per_share * (p.shares_at_payment ?? 0);
  const grossTotal = payments.filter((p) => p.status === 'paid').reduce((sum, p) => sum + totalFor(p), 0);
  const netTotal = grossTotal * (1 - DIVIDEND_TAX_RATE);

  wrap.innerHTML = `
    <div class="stock-dividend-summary">
      <div>סה"כ ברוטו מאז הכניסה: <strong>${fmtMoney(toDisplay(grossTotal), displayCurrency)}</strong></div>
      <div>נטו משוער אחרי מס (${(DIVIDEND_TAX_RATE * 100).toFixed(0)}%): <strong class="net-highlight">${fmtMoney(toDisplay(netTotal), displayCurrency)}</strong></div>
    </div>
    <div class="dividend-card-list">
      ${payments.map((p) => {
        const gross = totalFor(p);
        const tax = gross * DIVIDEND_TAX_RATE;
        const net = gross - tax;
        return `
        <div class="dividend-card ${p.status === 'expected' ? 'is-expected' : ''}">
          <div class="dividend-card-head">
            <span class="dividend-card-date">${fmtDate(p.payment_date)}</span>
            <span class="status-badge status-${p.status}">${p.status === 'paid' ? 'שולם' : 'צפוי'}</span>
          </div>
          <div class="dividend-card-row">
            <span>ברוטו</span>
            <span>${fmtMoney(toDisplay(gross), displayCurrency)}</span>
          </div>
          <div class="dividend-card-row dividend-tax-row">
            <span>מס (משוער ${(DIVIDEND_TAX_RATE * 100).toFixed(0)}%)</span>
            <span>−${fmtMoney(toDisplay(tax), displayCurrency)}</span>
          </div>
          <div class="dividend-card-row dividend-net-row">
            <span>נטו</span>
            <strong>${fmtMoney(toDisplay(net), displayCurrency)}</strong>
          </div>
          <div class="dividend-card-row">
            <span>לפי מניה</span>
            <span>${fmtMoney(toDisplay(p.amount_per_share), displayCurrency)}</span>
          </div>
        </div>
      `;
      }).join('')}
    </div>
    <p class="hint dividend-tax-disclaimer">* המס הוא הערכה בלבד (${(DIVIDEND_TAX_RATE * 100).toFixed(0)}% אחיד), לא נתון אמיתי מהברוקר — שיעור המס בפועל תלוי בסוג המניה, אמנת מס והמעמד האישי שלך.</p>
  `;
  return wrap;
}

async function loadDividends() {
  lastDividends = await api('/api/dividends');
}

let expandedReportTicker = null;

function renderTopPayers(topPayers) {
  const el = document.getElementById('reports-top-payers');
  el.innerHTML = '';
  if (!topPayers || topPayers.length === 0) {
    el.innerHTML = '<p class="empty">אין עדיין נתוני דיבידנד ששולמו</p>';
    return;
  }
  for (const p of topPayers) {
    const bareTicker = p.ticker.replace('.TA', '');
    const label = p.market === 'IL' && p.company_name ? p.company_name : bareTicker;
    const flag = p.market === 'IL' ? '🇮🇱' : '🇺🇸';
    const isExpanded = p.ticker === expandedReportTicker;

    const row = document.createElement('div');
    row.className = 'growth-list-row top-payer-row' + (isExpanded ? ' expanded' : '');
    row.dataset.ticker = p.ticker;
    row.innerHTML = `
      <span class="growth-list-period">${label} ${flag}</span>
      <span class="top-payer-value-block">
        <span class="growth-list-value">${fmtMoneyCompact(p.total)}</span>
        <span class="expand-arrow">›</span>
      </span>
    `;
    el.appendChild(row);
    if (isExpanded) {
      el.appendChild(buildDividendHistorySection(p.ticker));
    }
  }
}

document.addEventListener('click', (e) => {
  const row = e.target.closest('.top-payer-row');
  if (!row) return;
  const ticker = row.dataset.ticker;
  expandedReportTicker = expandedReportTicker === ticker ? null : ticker;
  renderTopPayers(lastStats?.topPayers ?? []);
});

async function loadReportsStats() {
  try {
    lastStats = await api('/api/dividends/stats');
    document.getElementById('reports-entry-teaser').textContent = `סה"כ ${fmtMoneyCompact(lastStats.totalAllTime)} עד היום`;
    document.getElementById('r-total').textContent = fmtMoney(lastStats.totalAllTime);
    document.getElementById('r-this-year').textContent = fmtMoneyCompact(lastStats.totalThisYear);
    document.getElementById('r-last-year').textContent = fmtMoneyCompact(lastStats.totalLastYear);
    document.getElementById('r-il').textContent = fmtMoneyCompact(lastStats.totalIL);
    document.getElementById('r-us').textContent = fmtMoneyCompact(lastStats.totalUS);
    renderTopPayers(lastStats.topPayers);
  } catch (err) {
    document.getElementById('reports-top-payers').innerHTML = `<p class="empty">שגיאה: ${err.message}</p>`;
  }
}

// ---- Reports page: charts ----

const TREND_RANGE_MONTHS = { '3': 3, '6': 6, '12': 12, '24': 24, all: null };
const MONTH_SHORT = ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יונ', 'יול', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ'];
const shortMonthLabel = (period) => {
  const [y, m] = period.split('-');
  return `${MONTH_SHORT[parseInt(m, 10) - 1]}׳${y.slice(2)}`;
};
let trendRangeKey = '12';

// Evenly-spaced label indices (always including the first and last point)
// so the x-axis stays readable instead of overlapping when there are many
// points.
function pickLabelIndices(n, maxLabels) {
  if (n <= maxLabels) return Array.from({ length: n }, (_, i) => i);
  const idx = [];
  for (let i = 0; i < maxLabels; i++) {
    idx.push(Math.round((i * (n - 1)) / (maxLabels - 1)));
  }
  return [...new Set(idx)];
}

let trendChartState = null;

function renderTrendChart() {
  const svg = document.getElementById('trend-chart-svg');
  const totalEl = document.getElementById('trend-total');
  const deltaEl = document.getElementById('trend-delta');
  const all = growthData?.monthly ?? [];
  const months = TREND_RANGE_MONTHS[trendRangeKey];
  const series = months ? all.slice(-months) : all;

  if (series.length === 0) {
    svg.innerHTML = '';
    totalEl.textContent = '–';
    deltaEl.textContent = '';
    trendChartState = null;
    return;
  }

  const total = series.reduce((sum, r) => sum + r.total, 0);
  totalEl.textContent = fmtMoneyCompact(total);

  const first = series[0].total;
  const last = series[series.length - 1].total;
  deltaEl.className = 'trend-delta';
  if (first > 0) {
    const pct = ((last - first) / first) * 100;
    deltaEl.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}% לעומת תחילת התקופה`;
    deltaEl.classList.add(pct >= 0 ? 'positive' : 'negative');
  } else {
    deltaEl.textContent = '';
  }

  // Chronological left-to-right, matching how finance charts read regardless
  // of page direction (the chart itself has its own `direction: ltr`).
  // Left margin reserved for y-axis value labels, bottom margin for x-axis
  // month labels — a bare line with no scale/labels doesn't say much on its
  // own.
  const plotLeft = 34, plotRight = 312, plotTop = 12, plotBottom = 122;
  const max = Math.max(...series.map((r) => r.total), 1);
  const stepX = series.length > 1 ? (plotRight - plotLeft) / (series.length - 1) : 0;
  const points = series.map((r, i) => ({
    x: plotLeft + i * stepX,
    y: plotBottom - (r.total / max) * (plotBottom - plotTop),
  }));

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)},${plotBottom} L${points[0].x.toFixed(1)},${plotBottom} Z`;
  const lastPoint = points[points.length - 1];

  const yLevels = [
    { frac: 1, value: max },
    { frac: 0.5, value: max / 2 },
    { frac: 0, value: 0 },
  ];
  const yAxis = yLevels.map(({ frac, value }) => {
    const y = plotBottom - frac * (plotBottom - plotTop);
    return `
      <line x1="${plotLeft}" y1="${y.toFixed(1)}" x2="${plotRight}" y2="${y.toFixed(1)}" stroke="#232a35" stroke-width="1" />
      <text x="${(plotLeft - 6).toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="end" fill="#8b93a1" font-size="8.5">${fmtMoneyCompact(value)}</text>
    `;
  }).join('');

  const xAxis = pickLabelIndices(series.length, 4)
    .map((i) => `<text x="${points[i].x.toFixed(1)}" y="${plotBottom + 16}" text-anchor="middle" fill="#8b93a1" font-size="8.5">${shortMonthLabel(series[i].period)}</text>`)
    .join('');

  svg.innerHTML = `
    <defs>
      <linearGradient id="trendAreaGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#00d68f" stop-opacity="0.35" />
        <stop offset="1" stop-color="#00d68f" stop-opacity="0" />
      </linearGradient>
    </defs>
    ${yAxis}
    <path d="${areaPath}" fill="url(#trendAreaGrad)" />
    <path d="${linePath}" fill="none" stroke="#00d68f" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
    <circle cx="${lastPoint.x.toFixed(1)}" cy="${lastPoint.y.toFixed(1)}" r="4.5" fill="#00d68f" stroke="#06070a" stroke-width="2" />
    ${xAxis}
  `;

  trendChartState = { points, series, plotTop, plotBottom };
}

// Month-over-month (or year-over-year) % change, as its own diverging
// chart — separate from the raw-amount trend above, since "how fast is
// this growing" and "how much came in" are different questions.
let rateChartState = null;

function renderGrowthRateChart() {
  const svg = document.getElementById('rate-chart-svg');
  const latestEl = document.getElementById('rate-latest');
  const avgEl = document.getElementById('rate-avg');
  const all = growthData?.monthly ?? [];
  const months = TREND_RANGE_MONTHS[trendRangeKey];
  const windowed = months ? all.slice(-months) : all;
  const series = windowed.filter((r) => r.growthPct != null);

  if (series.length === 0) {
    svg.innerHTML = '';
    latestEl.textContent = '–';
    avgEl.textContent = '';
    rateChartState = null;
    return;
  }

  const latest = series[series.length - 1].growthPct;
  latestEl.textContent = `${latest >= 0 ? '+' : ''}${latest.toFixed(0)}%`;
  latestEl.className = 'trend-total ' + (latest >= 0 ? 'positive' : 'negative');

  const avg = series.reduce((sum, r) => sum + r.growthPct, 0) / series.length;
  avgEl.textContent = `ממוצע בתקופה: ${avg >= 0 ? '+' : ''}${avg.toFixed(0)}%`;
  avgEl.className = 'trend-delta';

  const plotLeft = 34, plotRight = 312, plotTop = 12, plotBottom = 122;
  const values = series.map((r) => r.growthPct);
  const maxVal = Math.max(...values, 0);
  const minVal = Math.min(...values, 0);
  const range = maxVal - minVal || 1;
  const yFor = (v) => plotBottom - ((v - minVal) / range) * (plotBottom - plotTop);
  const baselineY = yFor(0);

  const stepX = series.length > 1 ? (plotRight - plotLeft) / (series.length - 1) : 0;
  const points = series.map((r, i) => ({ x: plotLeft + i * stepX, y: yFor(r.growthPct) }));

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)},${baselineY} L${points[0].x.toFixed(1)},${baselineY} Z`;
  const lastPoint = points[points.length - 1];
  const lastColor = values[values.length - 1] >= 0 ? '#00d68f' : '#ff5c5c';

  const yAxis = [
    { y: plotTop, value: maxVal },
    { y: baselineY, value: 0 },
    { y: plotBottom, value: minVal },
  ].map(({ y, value }) => `
    <line x1="${plotLeft}" y1="${y.toFixed(1)}" x2="${plotRight}" y2="${y.toFixed(1)}" stroke="#232a35" stroke-width="1" />
    <text x="${(plotLeft - 6).toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="end" fill="#8b93a1" font-size="8.5">${value >= 0 ? '+' : ''}${value.toFixed(0)}%</text>
  `).join('');

  const xAxis = pickLabelIndices(series.length, 4)
    .map((i) => `<text x="${points[i].x.toFixed(1)}" y="${plotBottom + 16}" text-anchor="middle" fill="#8b93a1" font-size="8.5">${shortMonthLabel(series[i].period)}</text>`)
    .join('');

  svg.innerHTML = `
    <defs>
      <clipPath id="rateClipAbove"><rect x="${plotLeft}" y="${plotTop}" width="${plotRight - plotLeft}" height="${Math.max(baselineY - plotTop, 0)}" /></clipPath>
      <clipPath id="rateClipBelow"><rect x="${plotLeft}" y="${baselineY}" width="${plotRight - plotLeft}" height="${Math.max(plotBottom - baselineY, 0)}" /></clipPath>
      <linearGradient id="rateAreaGradUp" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#00d68f" stop-opacity="0.35" />
        <stop offset="1" stop-color="#00d68f" stop-opacity="0" />
      </linearGradient>
      <linearGradient id="rateAreaGradDown" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0" stop-color="#ff5c5c" stop-opacity="0.35" />
        <stop offset="1" stop-color="#ff5c5c" stop-opacity="0" />
      </linearGradient>
    </defs>
    ${yAxis}
    <path d="${areaPath}" fill="url(#rateAreaGradUp)" clip-path="url(#rateClipAbove)" />
    <path d="${areaPath}" fill="url(#rateAreaGradDown)" clip-path="url(#rateClipBelow)" />
    <path d="${linePath}" fill="none" stroke="#00d68f" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" clip-path="url(#rateClipAbove)" />
    <path d="${linePath}" fill="none" stroke="#ff5c5c" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" clip-path="url(#rateClipBelow)" />
    <circle cx="${lastPoint.x.toFixed(1)}" cy="${lastPoint.y.toFixed(1)}" r="4.5" fill="${lastColor}" stroke="#06070a" stroke-width="2" />
    ${xAxis}
  `;

  rateChartState = { points, series, plotTop, plotBottom };
}

document.getElementById('trend-range-tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.growth-tab');
  if (!btn) return;
  trendRangeKey = btn.dataset.range;
  document.querySelectorAll('#trend-range-tabs .growth-tab').forEach((t) => t.classList.remove('active'));
  btn.classList.add('active');
  renderTrendChart();
  renderGrowthRateChart();
});

// Touch/mouse crosshair + tooltip for a line chart. Bound once per SVG (the
// chart's innerHTML gets fully replaced on every re-render, but that only
// touches children — the listeners below stay attached to the svg element
// itself). `getState` is read on every pointer event so it always sees the
// latest render's points, even after the range picker changes.
function attachChartHover(svgId, tooltipId, getState, formatPoint) {
  const svg = document.getElementById(svgId);
  const tooltip = document.getElementById(tooltipId);

  function svgPointFromClient(clientX, clientY) {
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    return pt.matrixTransform(ctm.inverse());
  }

  function update(clientX, clientY) {
    const state = getState();
    if (!state || state.points.length === 0) return;
    const svgPt = svgPointFromClient(clientX, clientY);
    if (!svgPt) return;

    let nearest = 0;
    let bestDist = Infinity;
    state.points.forEach((p, i) => {
      const d = Math.abs(p.x - svgPt.x);
      if (d < bestDist) { bestDist = d; nearest = i; }
    });
    const p = state.points[nearest];

    let crosshair = svg.querySelector('.hover-crosshair');
    if (!crosshair) {
      crosshair = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      crosshair.setAttribute('class', 'hover-crosshair');
      crosshair.setAttribute('stroke', 'rgba(255,255,255,0.22)');
      crosshair.setAttribute('stroke-width', '1');
      svg.appendChild(crosshair);
    }
    crosshair.setAttribute('x1', p.x);
    crosshair.setAttribute('x2', p.x);
    crosshair.setAttribute('y1', state.plotTop);
    crosshair.setAttribute('y2', state.plotBottom);
    crosshair.style.display = '';

    let dot = svg.querySelector('.hover-dot');
    if (!dot) {
      dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('class', 'hover-dot');
      dot.setAttribute('r', '5.5');
      dot.setAttribute('fill', '#f5f6f8');
      dot.setAttribute('stroke', '#06070a');
      dot.setAttribute('stroke-width', '2');
      svg.appendChild(dot);
    }
    dot.setAttribute('cx', p.x);
    dot.setAttribute('cy', p.y);
    dot.style.display = '';

    const info = formatPoint(nearest, state);
    tooltip.innerHTML = `<div class="chart-tooltip-date">${info.title}</div><div class="chart-tooltip-value">${info.value}</div>`;
    tooltip.classList.remove('hidden');

    const wrap = svg.parentElement;
    const wrapRect = wrap.getBoundingClientRect();
    const screenPos = p2 => {
      const sp = svg.createSVGPoint();
      sp.x = p2.x;
      sp.y = p2.y;
      return sp.matrixTransform(svg.getScreenCTM());
    };
    const pos = screenPos(p);
    const tw = tooltip.offsetWidth || 90;
    const left = Math.max(4, Math.min(pos.x - wrapRect.left - tw / 2, wrapRect.width - tw - 4));
    const top = Math.max(0, pos.y - wrapRect.top - 42);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function hide() {
    tooltip.classList.add('hidden');
    const crosshair = svg.querySelector('.hover-crosshair');
    const dot = svg.querySelector('.hover-dot');
    if (crosshair) crosshair.style.display = 'none';
    if (dot) dot.style.display = 'none';
  }

  svg.addEventListener('pointerdown', (e) => update(e.clientX, e.clientY));
  svg.addEventListener('pointermove', (e) => update(e.clientX, e.clientY));
  svg.addEventListener('pointerup', hide);
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('pointercancel', hide);
}

attachChartHover('trend-chart-svg', 'trend-tooltip', () => trendChartState, (i, state) => ({
  title: fmtMonthLabel(state.series[i].period),
  value: fmtMoneyCompact(state.series[i].total),
}));

attachChartHover('rate-chart-svg', 'rate-tooltip', () => rateChartState, (i, state) => {
  const v = state.series[i].growthPct;
  return {
    title: fmtMonthLabel(state.series[i].period),
    value: `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`,
  };
});

function renderMarketDonut() {
  const svg = document.getElementById('market-donut-svg');
  const legend = document.getElementById('market-legend');
  const totalIL = lastStats?.totalIL ?? 0;
  const totalUS = lastStats?.totalUS ?? 0;
  const total = totalIL + totalUS;

  if (total <= 0) {
    svg.innerHTML = '';
    legend.innerHTML = '<p class="empty">אין עדיין נתונים</p>';
    return;
  }

  const r = 50, cx = 65, cy = 65, sw = 16;
  const circumference = 2 * Math.PI * r;
  const ilFrac = totalIL / total;
  const usFrac = totalUS / total;
  const ilLen = circumference * ilFrac;
  const usLen = circumference * usFrac;

  svg.innerHTML = `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#1c222c" stroke-width="${sw}" />
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#00d68f" stroke-width="${sw}"
      stroke-dasharray="${ilLen.toFixed(2)} ${(circumference - ilLen).toFixed(2)}" stroke-linecap="round" transform="rotate(-90 ${cx} ${cy})" />
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#3b82f6" stroke-width="${sw}"
      stroke-dasharray="${usLen.toFixed(2)} ${(circumference - usLen).toFixed(2)}" stroke-dashoffset="${(-ilLen).toFixed(2)}" stroke-linecap="round" transform="rotate(-90 ${cx} ${cy})" />
    <text x="${cx}" y="${cy - 5}" text-anchor="middle" fill="#f5f6f8" font-size="17" font-weight="700">${fmtMoneyCompact(total)}</text>
    <text x="${cx}" y="${cy + 13}" text-anchor="middle" fill="#8b93a1" font-size="10">סה"כ</text>
  `;

  legend.innerHTML = `
    <div class="legend-row">
      <span class="legend-left"><span class="legend-dot" style="background:#00d68f"></span>ישראליות</span>
      <span class="legend-value">${(ilFrac * 100).toFixed(0)}%</span>
    </div>
    <div class="legend-row">
      <span class="legend-left"><span class="legend-dot" style="background:#3b82f6"></span>אמריקאיות</span>
      <span class="legend-value">${(usFrac * 100).toFixed(0)}%</span>
    </div>
  `;
}

function renderCharts() {
  renderTrendChart();
  renderGrowthRateChart();
  renderMarketDonut();
}

document.getElementById('charts-toggle-btn').addEventListener('click', () => {
  const section = document.getElementById('charts-section');
  const arrow = document.getElementById('charts-toggle-arrow');
  const isOpen = !section.classList.contains('hidden');
  section.classList.toggle('hidden', isOpen);
  arrow.classList.toggle('expanded', !isOpen);
  if (!isOpen) renderCharts();
});

async function refreshAll() {
  await Promise.all([loadSummary(), loadDividends(), loadGrowthChart(), loadReportsStats()]);
  renderHoldings(lastHoldings);
  renderCharts();
}

// ---- Reports page navigation ----

function openReportsPage() {
  document.getElementById('home-page').classList.add('hidden');
  document.getElementById('reports-page').classList.remove('hidden');
  window.scrollTo(0, 0);
  history.pushState({ page: 'reports' }, '');
}

function closeReportsPage() {
  document.getElementById('reports-page').classList.add('hidden');
  document.getElementById('home-page').classList.remove('hidden');
  window.scrollTo(0, 0);
}

document.getElementById('open-reports-btn').addEventListener('click', openReportsPage);
document.getElementById('reports-back-btn').addEventListener('click', () => history.back());
window.addEventListener('popstate', closeReportsPage);

function showError(elementId, err) {
  const el = document.getElementById(elementId);
  el.textContent = err.message || String(err);
  el.classList.remove('hidden');
}

function clearError(elementId) {
  document.getElementById(elementId).classList.add('hidden');
}

// ---- Expand / collapse per-stock dividend history ----

document.addEventListener('click', (e) => {
  if (e.target.closest('.edit-btn') || e.target.closest('.delete-btn')) return;
  const row = e.target.closest('.holding-row');
  if (!row) return;
  const id = row.dataset.holdingId;
  expandedHoldingId = expandedHoldingId === id ? null : id;
  renderHoldings(lastHoldings);
});

// ---- Holding add / edit ----

const holdingForm = document.getElementById('holding-form');
const holdingEditIdInput = document.getElementById('holding-edit-id');
const holdingSubmitBtn = document.getElementById('holding-submit-btn');
const holdingCancelEditBtn = document.getElementById('holding-cancel-edit');
const dateHelper = document.getElementById('date-helper');
const tickerInput = document.getElementById('holding-ticker-input');
const marketInput = document.getElementById('holding-market-input');
const companyNameInput = document.getElementById('holding-company-name-input');
const suggestionsList = document.getElementById('ticker-suggestions');
const resolvedText = document.getElementById('ticker-resolved');

const hasHebrew = (text) => /[֐-׿]/.test(text);

// TASE stocks are priced and entered in Agorot (אג'), not Shekels — keep the
// placeholder honest about which unit is expected so amounts don't get
// entered 100x off.
function updateHoldingPriceUnit() {
  document.getElementById('holding-price-input').placeholder = marketInput.value === 'IL'
    ? 'מחיר למניה בקנייה (אגורות)'
    : 'מחיר למניה בקנייה ($)';
}
updateHoldingPriceUnit();

// ---- Ticker/name search: auto-detects the market, no manual US/IL picker ----

let searchDebounce = null;
let resolvedViaSearch = false;

function hideSuggestions() {
  suggestionsList.classList.add('hidden');
  suggestionsList.innerHTML = '';
}

function renderSuggestions(results) {
  if (results.length === 0) {
    suggestionsList.innerHTML = '<li class="suggestion-empty">לא נמצאו תוצאות — נסה טיקר מדויק או שם באנגלית</li>';
    suggestionsList.classList.remove('hidden');
    return;
  }
  suggestionsList.innerHTML = results.map((r) => `
    <li data-symbol="${r.symbol}" data-market="${r.market}" data-name="${r.name.replace(/"/g, '&quot;')}">
      <span class="suggestion-symbol">${r.symbol}</span>
      <span class="suggestion-name">${r.name}</span>
      <span class="market-flag">${r.market === 'IL' ? '🇮🇱' : '🇺🇸'}</span>
    </li>
  `).join('');
  suggestionsList.classList.remove('hidden');
}

tickerInput.addEventListener('input', () => {
  resolvedViaSearch = false;
  resolvedText.classList.add('hidden');
  const query = tickerInput.value.trim();
  clearTimeout(searchDebounce);
  if (query.length < 2) {
    hideSuggestions();
    return;
  }
  searchDebounce = setTimeout(async () => {
    try {
      const { results } = await api(`/api/search-ticker?q=${encodeURIComponent(query)}`);
      renderSuggestions(results ?? []);
    } catch {
      hideSuggestions();
    }
  }, 300);
});

suggestionsList.addEventListener('click', (e) => {
  const li = e.target.closest('li[data-symbol]');
  if (!li) return;
  const { symbol, market, name } = li.dataset;
  tickerInput.value = symbol;
  marketInput.value = market;
  companyNameInput.value = name;
  resolvedViaSearch = true;
  updateHoldingPriceUnit();

  // Already own this ticker and not currently editing a specific lot?
  // Make it clear this will add another purchase rather than replace it.
  const alreadyOwned = !holdingEditIdInput.value && lastHoldings.some((h) => h.ticker === symbol);
  resolvedText.textContent = alreadyOwned
    ? `נבחר: ${name} — כבר יש לך מניות מהמנייה הזו, זו תתווסף כרכישה נוספת`
    : `נבחר: ${name} (${market === 'IL' ? 'ת"א' : 'ארה"ב'})`;
  resolvedText.classList.remove('hidden');
  hideSuggestions();
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.ticker-search-wrap')) hideSuggestions();
});

function exitEditMode() {
  holdingForm.reset();
  holdingEditIdInput.value = '';
  marketInput.value = 'US';
  companyNameInput.value = '';
  resolvedViaSearch = false;
  resolvedText.classList.add('hidden');
  updateHoldingPriceUnit();
  holdingSubmitBtn.textContent = 'הוסף מניה';
  holdingCancelEditBtn.classList.add('hidden');
  dateHelper.classList.add('hidden');
}

holdingForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError('holding-error');
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());
  const editId = data.id;

  // A Hebrew company name without picking a suggestion can't be turned into
  // a real ticker symbol — block instead of silently saving a dead entry.
  if (!resolvedViaSearch && hasHebrew(data.ticker)) {
    showError('holding-error', new Error('בחר מניה מהרשימה שמופיעה תחת החיפוש כדי שנזהה את הטיקר הנכון'));
    return;
  }

  const payload = {
    ticker: data.ticker,
    market: data.market,
    company_name: data.company_name || null,
    shares: parseFloat(data.shares),
    purchase_price: parseFloat(data.purchase_price),
    purchase_date: data.purchase_date || null,
  };

  try {
    if (editId) {
      await api(`/api/holdings/${editId}`, { method: 'PATCH', body: JSON.stringify(payload) });
    } else {
      await api('/api/holdings', { method: 'POST', body: JSON.stringify(payload) });
    }
    exitEditMode();
    await refreshAll();
    // Dividend sync runs in the background on the server for speed, so give
    // it a moment and refresh again to pick up the newly-fetched history.
    setTimeout(() => refreshAll().catch(() => {}), 3000);
  } catch (err) {
    showError('holding-error', err);
  }
});

holdingCancelEditBtn.addEventListener('click', exitEditMode);

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.edit-btn');
  if (!btn) return;
  // Editing acts on a specific purchase lot, not the combined position.
  const lot = lastHoldings.flatMap((h) => h.lots ?? []).find((l) => String(l.id) === btn.dataset.id);
  if (!lot) return;

  clearError('holding-error');
  holdingEditIdInput.value = lot.id;
  tickerInput.value = lot.ticker;
  marketInput.value = lot.market;
  companyNameInput.value = lot.company_name ?? '';
  resolvedViaSearch = true;
  updateHoldingPriceUnit();
  resolvedText.classList.add('hidden');
  holdingForm.shares.value = lot.shares;
  holdingForm.purchase_price.value = lot.purchase_price;
  holdingForm.purchase_date.value = lot.purchase_date ?? '';
  holdingSubmitBtn.textContent = 'עדכן רכישה';
  holdingCancelEditBtn.classList.remove('hidden');
  holdingForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.add-lot-btn');
  if (!btn) return;
  const holding = lastHoldings.find((h) => h.ticker === btn.dataset.ticker);
  if (!holding) return;

  exitEditMode();
  clearError('holding-error');
  tickerInput.value = holding.ticker;
  marketInput.value = holding.market;
  companyNameInput.value = holding.company_name ?? '';
  resolvedViaSearch = true;
  updateHoldingPriceUnit();
  const label = holding.market === 'IL' && holding.company_name ? holding.company_name : holding.ticker.replace('.TA', '');
  resolvedText.textContent = `מוסיף רכישה נוספת עבור ${label}`;
  resolvedText.classList.remove('hidden');
  holdingForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
  document.getElementById('holding-shares-input').focus();
});

// ---- "Don't remember the purchase date? search by price" helper ----

document.getElementById('find-date-toggle').addEventListener('click', () => {
  dateHelper.classList.toggle('hidden');
});

document.getElementById('find-date-search').addEventListener('click', async () => {
  const results = document.getElementById('date-helper-results');
  const ticker = holdingForm.ticker.value.trim();
  const market = holdingForm.market.value;
  const price = parseFloat(holdingForm.purchase_price.value);
  const yearValue = document.getElementById('date-helper-year').value;

  if (!ticker || !price) {
    results.innerHTML = '<li class="empty">קודם מלא טיקר ומחיר למעלה</li>';
    return;
  }

  results.innerHTML = '<li class="empty">מחפש…</li>';
  try {
    const yearParam = yearValue ? `&year=${encodeURIComponent(yearValue)}` : '';
    const { matches } = await api(
      `/api/history/${encodeURIComponent(ticker)}?market=${market}&price=${price}${yearParam}`
    );
    if (!matches || matches.length === 0) {
      results.innerHTML = '<li class="empty">לא נמצאו תאריכים במחיר הזה, נסה מחיר או שנה אחרים</li>';
      return;
    }
    results.innerHTML = '';
    const currency = market === 'IL' ? 'ILA' : 'USD';
    for (const m of matches) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'date-chip';
      btn.textContent = `${fmtDate(m.date)} · ${fmtMoney(m.price, currency)}`;
      btn.addEventListener('click', () => {
        document.getElementById('purchase-date-input').value = m.date;
        dateHelper.classList.add('hidden');
      });
      li.appendChild(btn);
      results.appendChild(li);
    }
  } catch (err) {
    results.innerHTML = `<li class="empty">שגיאה בחיפוש: ${err.message}</li>`;
  }
});

// ---- Dividend income growth (month over month, year over year) ----

const MONTH_NAMES = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const fmtMonthLabel = (period) => {
  const [y, m] = period.split('-');
  return `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`;
};

let growthData = null;
// Which years are expanded in the monthly view's year-accordion. Left null
// until the first render, which opens just the most recent year so the full
// history (every month since the first purchase) is reachable without
// dumping it all into one long list.
let expandedGrowthYears = null;

function renderBarChart(series, labelFn, groupByYear) {
  const chart = document.getElementById('growth-chart');
  const summary = document.getElementById('growth-summary');
  if (series.length === 0) {
    chart.innerHTML = '<p class="empty">אין עדיין נתוני דיבידנד ששולמו</p>';
    summary.innerHTML = '';
    return;
  }
  const totalSum = series.reduce((sum, r) => sum + r.total, 0);
  const avg = totalSum / series.length;
  const avgLabel = groupByYear ? 'ממוצע לחודש' : 'ממוצע לשנה';

  summary.innerHTML = `
    <div class="growth-stat">
      <span class="growth-stat-label">${avgLabel}</span>
      <span class="growth-stat-value">${fmtMoneyCompact(avg)}</span>
    </div>
    <div class="growth-stat">
      <span class="growth-stat-label">סה"כ מצטבר</span>
      <span class="growth-stat-value">${fmtMoneyCompact(totalSum)}</span>
    </div>
  `;

  if (!groupByYear) {
    chart.innerHTML = [...series].reverse().map((row) => `
      <div class="growth-list-row">
        <span class="growth-list-period">${labelFn(row.period)}</span>
        <span class="growth-list-value">${fmtMoneyCompact(row.total)}</span>
      </div>
    `).join('');
    return;
  }

  // Every month since the first purchase, grouped into collapsible
  // per-year sections instead of one long flat list.
  const byYear = new Map();
  for (const row of series) {
    const year = row.period.slice(0, 4);
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(row);
  }
  const years = [...byYear.keys()].sort().reverse();
  if (expandedGrowthYears === null) {
    expandedGrowthYears = new Set(years.length ? [years[0]] : []);
  }

  chart.innerHTML = years.map((year) => {
    const rows = byYear.get(year).slice().reverse();
    const yearTotal = rows.reduce((sum, r) => sum + r.total, 0);
    const isOpen = expandedGrowthYears.has(year);
    return `
      <button type="button" class="group-header growth-year-header" data-year="${year}">
        <span class="group-title">${year}</span>
        <span class="group-value">${fmtMoneyCompact(yearTotal)}</span>
        <span class="expand-arrow group-arrow ${isOpen ? 'expanded' : ''}">›</span>
      </button>
      <div class="group-body ${isOpen ? '' : 'hidden'}">
        ${rows.map((row) => `
          <div class="growth-list-row">
            <span class="growth-list-period">${labelFn(row.period)}</span>
            <span class="growth-list-value">${fmtMoneyCompact(row.total)}</span>
          </div>
        `).join('')}
      </div>
    `;
  }).join('');
}

function renderActiveGrowthTab() {
  if (!growthData) return;
  const activeTab = document.querySelector('.growth-tab.active');
  const range = activeTab ? activeTab.dataset.range : 'monthly';
  if (range === 'monthly') {
    renderBarChart(growthData.monthly, fmtMonthLabel, true);
  } else {
    renderBarChart(growthData.yearly, (p) => p, false);
  }
}

document.addEventListener('click', (e) => {
  const header = e.target.closest('.growth-year-header');
  if (!header) return;
  const year = header.dataset.year;
  if (expandedGrowthYears.has(year)) expandedGrowthYears.delete(year);
  else expandedGrowthYears.add(year);
  renderActiveGrowthTab();
});

document.querySelectorAll('.growth-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.growth-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    renderActiveGrowthTab();
  });
});

async function loadGrowthChart() {
  try {
    growthData = await api('/api/dividends/income-growth');
    renderActiveGrowthTab();
  } catch (err) {
    document.getElementById('growth-chart').innerHTML = `<p class="empty">שגיאה: ${err.message}</p>`;
  }
}

// ---- Sync dividends for all holdings ----

document.getElementById('sync-dividends-btn').addEventListener('click', async () => {
  const status = document.getElementById('sync-status');
  status.textContent = 'מרענן…';
  try {
    const res = await api('/api/dividends/sync-all', { method: 'POST' });
    status.textContent = `עודכן לפי ${res.synced} מניות`;
    await refreshAll();
  } catch (err) {
    status.textContent = `שגיאה: ${err.message}`;
  }
});

// ---- Delete holding ----

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.delete-btn');
  if (!btn) return;
  await api(`/api/holdings/${btn.dataset.id}`, { method: 'DELETE' });
  await refreshAll();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

refreshAll().catch((err) => console.error(err));
