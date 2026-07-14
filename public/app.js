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
let expandedHoldingId = null;

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

function renderHoldings(holdings) {
  const body = document.getElementById('holdings-body');
  body.innerHTML = '';
  if (holdings.length === 0) {
    body.innerHTML = '<p class="empty">עדיין אין מניות בתיק</p>';
    return;
  }
  for (const h of holdings) {
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
    body.appendChild(row);
    if (String(h.id) === String(expandedHoldingId)) {
      body.appendChild(buildHoldingDetail(h));
      row.classList.add('expanded');
    }
  }
}

function buildHoldingDetail(holding) {
  const currency = currencyForTicker(holding.ticker);
  const isIL = currency === 'ILA';
  const displayCurrency = isIL ? 'ILS' : currency;
  const toDisplay = (n) => (isIL ? n / 100 : n);
  const payments = lastDividends
    .filter((p) => p.ticker === holding.ticker && (!holding.purchase_date || p.payment_date >= holding.purchase_date))
    .sort((a, b) => b.payment_date.localeCompare(a.payment_date));

  const wrap = document.createElement('div');
  wrap.className = 'holding-detail';

  const actions = `
    <div class="holding-detail-actions">
      <button class="edit-btn" data-id="${holding.id}">✎ ערוך</button>
      <button class="delete-btn" data-id="${holding.id}">🗑 מחק</button>
    </div>
  `;

  const purchaseInfo = `
    <div class="purchase-info">
      <div class="purchase-stat">
        <span class="purchase-stat-label">מחיר קנייה</span>
        <span class="purchase-stat-value">${fmtMoney(toDisplay(holding.purchase_price), displayCurrency)}</span>
      </div>
      <div class="purchase-stat">
        <span class="purchase-stat-label">שווי קנייה</span>
        <span class="purchase-stat-value">${fmtMoney(toDisplay(holding.amount_invested), displayCurrency)}</span>
      </div>
      <div class="purchase-stat">
        <span class="purchase-stat-label">תאריך קנייה</span>
        <span class="purchase-stat-value">${holding.purchase_date ? fmtDate(holding.purchase_date) : '—'}</span>
      </div>
    </div>
  `;

  let dividendSection;
  if (payments.length === 0) {
    dividendSection = '<p class="empty">אין עדיין נתוני דיבידנד למניה הזו מאז שנכנסת אליה</p>';
  } else {
    const totalFor = (p) => p.amount_per_share * (p.shares_at_payment ?? holding.shares);
    const grossTotal = payments.filter((p) => p.status === 'paid').reduce((sum, p) => sum + totalFor(p), 0);
    const netTotal = grossTotal * (1 - DIVIDEND_TAX_RATE);
    dividendSection = `
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
  }

  wrap.innerHTML = actions + purchaseInfo + dividendSection;
  return wrap;
}

async function loadDividends() {
  lastDividends = await api('/api/dividends');
}

async function refreshAll() {
  await Promise.all([loadSummary(), loadDividends(), loadGrowthChart()]);
  renderHoldings(lastHoldings);
}

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
  resolvedText.textContent = `נבחר: ${name} (${market === 'IL' ? 'ת"א' : 'ארה"ב'})`;
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
  const holding = lastHoldings.find((h) => String(h.id) === btn.dataset.id);
  if (!holding) return;

  clearError('holding-error');
  holdingEditIdInput.value = holding.id;
  tickerInput.value = holding.ticker;
  marketInput.value = holding.market;
  companyNameInput.value = holding.company_name ?? '';
  resolvedViaSearch = true;
  updateHoldingPriceUnit();
  resolvedText.classList.add('hidden');
  holdingForm.shares.value = holding.shares;
  holdingForm.purchase_price.value = holding.purchase_price;
  holdingForm.purchase_date.value = holding.purchase_date ?? '';
  holdingSubmitBtn.textContent = 'עדכן מניה';
  holdingCancelEditBtn.classList.remove('hidden');
  holdingForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

const fmtMoneyCompact = (n) =>
  new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(n ?? 0);

function renderBarChart(series, labelFn) {
  const chart = document.getElementById('growth-chart');
  const summary = document.getElementById('growth-summary');
  if (series.length === 0) {
    chart.innerHTML = '<p class="empty">אין עדיין נתוני דיבידנד ששולמו</p>';
    summary.innerHTML = '';
    return;
  }
  // Chronological, oldest to newest, capped to the last 12 periods so the chart stays scannable.
  const recent = series.slice(-12);
  const max = Math.max(...recent.map((r) => r.total), 1);
  const totalSum = recent.reduce((sum, r) => sum + r.total, 0);
  const avg = totalSum / recent.length;

  summary.innerHTML = `
    <div class="growth-stat">
      <span class="growth-stat-label">ממוצע לתקופה</span>
      <span class="growth-stat-value">${fmtMoneyCompact(avg)}</span>
    </div>
    <div class="growth-stat">
      <span class="growth-stat-label">סה"כ מצטבר</span>
      <span class="growth-stat-value">${fmtMoneyCompact(totalSum)}</span>
    </div>
  `;

  chart.innerHTML = `
    <div class="column-chart">
      ${recent.map((row) => {
        const heightPct = Math.max((row.total / max) * 100, 4);
        const growthText = row.growthPct == null ? '' : `${row.growthPct >= 0 ? '+' : ''}${row.growthPct.toFixed(0)}%`;
        const growthClass = row.growthPct == null ? '' : row.growthPct >= 0 ? 'positive' : 'negative';
        return `
          <div class="column-item">
            <span class="column-delta ${growthClass}">${growthText}</span>
            <span class="column-value">${fmtMoneyCompact(row.total)}</span>
            <div class="column-bar-track"><div class="column-bar" style="height: ${heightPct}%"></div></div>
            <span class="column-label">${labelFn(row.period)}</span>
          </div>
        `;
      }).join('')}
    </div>
  `;
  chart.scrollLeft = chart.scrollWidth;
}

function renderActiveGrowthTab() {
  if (!growthData) return;
  const activeTab = document.querySelector('.growth-tab.active');
  const range = activeTab ? activeTab.dataset.range : 'monthly';
  if (range === 'monthly') {
    renderBarChart(growthData.monthly, fmtMonthLabel);
  } else {
    renderBarChart(growthData.yearly, (p) => p);
  }
}

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
