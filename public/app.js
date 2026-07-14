const fmtMoney = (n, currency = 'ILS') =>
  new Intl.NumberFormat('he-IL', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n ?? 0);

const fmtPct = (n) => `${(n ?? 0).toFixed(2)}%`;
const fmtDate = (d) => new Date(d).toLocaleDateString('he-IL');
const currencyForTicker = (ticker) => (ticker.endsWith('.TA') ? 'ILS' : 'USD');

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
  const gainSign = s.gainLossPct >= 0 ? '+' : '';
  gainEl.textContent = `${fmtMoney(s.gainLoss)} (${gainSign}${(s.gainLossPct ?? 0).toFixed(1)}%)`;
  gainEl.classList.toggle('positive', s.gainLoss >= 0);
  gainEl.classList.toggle('negative', s.gainLoss < 0);

  document.getElementById('s-yield').textContent = fmtPct(s.annualYieldPct);
  document.getElementById('s-monthly').textContent = fmtMoney(s.monthlyAvgIncome);

  lastHoldings = s.holdings ?? [];
  renderHoldings(lastHoldings);
}

function renderHoldings(holdings) {
  const body = document.getElementById('holdings-body');
  body.innerHTML = '';
  if (holdings.length === 0) {
    body.innerHTML = '<tr><td colspan="7" class="empty">עדיין אין מניות בתיק</td></tr>';
    return;
  }
  for (const h of holdings) {
    const currency = h.currency ?? currencyForTicker(h.ticker);
    const gainPct = h.gainPct ?? 0;
    const gainSign = gainPct >= 0 ? '+' : '';
    const tr = document.createElement('tr');
    tr.className = 'holding-row';
    tr.dataset.holdingId = h.id;
    tr.innerHTML = `
      <td><span class="expand-arrow">▸</span> ${h.ticker}</td>
      <td><span class="market-badge market-${h.market}">${h.market === 'IL' ? 'ת"א' : 'ארה"ב'}</span></td>
      <td>${h.shares}</td>
      <td>${h.currentPrice != null ? fmtMoney(h.currentPrice, currency) : '—'}</td>
      <td>${fmtMoney(h.currentValue, currency)}</td>
      <td class="${gainPct >= 0 ? 'positive' : 'negative'}">${gainSign}${gainPct.toFixed(1)}%</td>
      <td>
        <button class="edit-btn" data-id="${h.id}">ערוך</button>
        <button class="delete-btn" data-id="${h.id}" data-type="holding">מחק</button>
      </td>
    `;
    body.appendChild(tr);
    if (String(h.id) === String(expandedHoldingId)) {
      body.appendChild(buildDividendDetailRow(h));
      tr.classList.add('expanded');
    }
  }
}

function buildDividendDetailRow(holding) {
  const currency = currencyForTicker(holding.ticker);
  const payments = lastDividends
    .filter((p) => p.ticker === holding.ticker && (!holding.purchase_date || p.payment_date >= holding.purchase_date))
    .sort((a, b) => b.payment_date.localeCompare(a.payment_date));

  const tr = document.createElement('tr');
  tr.className = 'dividend-detail-row';
  const td = document.createElement('td');
  td.colSpan = 7;

  if (payments.length === 0) {
    td.innerHTML = '<p class="empty">אין עדיין נתוני דיבידנד למניה הזו מאז שנכנסת אליה</p>';
  } else {
    const totalFor = (p) => p.amount_per_share * (p.shares_at_payment ?? holding.shares);
    const total = payments.filter((p) => p.status === 'paid').reduce((sum, p) => sum + totalFor(p), 0);
    td.innerHTML = `
      <div class="stock-dividend-summary">סה"כ שולם מאז הכניסה: <strong>${fmtMoney(total, currency)}</strong></div>
      <ul class="stock-dividend-list">
        ${payments.map((p) => `
          <li>
            <span class="div-date">${fmtDate(p.payment_date)}</span>
            <span class="div-amount">${fmtMoney(totalFor(p), currency)}</span>
            <span class="div-rate">${fmtMoney(p.amount_per_share, currency)}/מניה</span>
            <span class="status-badge status-${p.status}">${p.status === 'paid' ? 'שולם' : 'צפוי'}</span>
          </li>
        `).join('')}
      </ul>
    `;
  }

  tr.appendChild(td);
  return tr;
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
  const row = e.target.closest('tr.holding-row');
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

function exitEditMode() {
  holdingForm.reset();
  holdingEditIdInput.value = '';
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

  const payload = {
    ticker: data.ticker,
    market: data.market,
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
  const displayTicker = holding.market === 'IL' && holding.ticker.endsWith('.TA')
    ? holding.ticker.slice(0, -3)
    : holding.ticker;

  holdingEditIdInput.value = holding.id;
  holdingForm.ticker.value = displayTicker;
  holdingForm.market.value = holding.market;
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
    const currency = market === 'IL' ? 'ILS' : 'USD';
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

// ---- Dividend manual entry (fallback) ----

document.getElementById('dividend-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError('dividend-error');
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());
  try {
    await api('/api/dividends', {
      method: 'POST',
      body: JSON.stringify({
        ticker: data.ticker,
        market: data.market,
        amount_per_share: parseFloat(data.amount_per_share),
        shares_at_payment: data.shares_at_payment ? parseFloat(data.shares_at_payment) : null,
        payment_date: data.payment_date,
        status: data.status,
      }),
    });
    form.reset();
    await refreshAll();
  } catch (err) {
    showError('dividend-error', err);
  }
});

// ---- Dividend income growth (month over month, year over year) ----

const MONTH_NAMES = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const fmtMonthLabel = (period) => {
  const [y, m] = period.split('-');
  return `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`;
};

let growthData = null;

function renderBarChart(series, labelFn) {
  const chart = document.getElementById('growth-chart');
  if (series.length === 0) {
    chart.innerHTML = '<p class="empty">אין עדיין נתוני דיבידנד ששולמו</p>';
    return;
  }
  // Most recent period at the top, capped to the last 12 so the chart stays scannable.
  const recent = series.slice(-12).reverse();
  const max = Math.max(...recent.map((r) => r.total), 1);

  chart.innerHTML = recent.map((row) => {
    const widthPct = Math.max((row.total / max) * 100, 2);
    const growthText = row.growthPct == null ? '' : `${row.growthPct >= 0 ? '+' : ''}${row.growthPct.toFixed(0)}%`;
    const growthClass = row.growthPct == null ? '' : row.growthPct >= 0 ? 'positive' : 'negative';
    return `
      <div class="bar-row">
        <span class="bar-label">${labelFn(row.period)}</span>
        <div class="bar-track"><div class="bar-fill" style="width: ${widthPct}%"></div></div>
        <span class="bar-value">
          ${fmtMoney(row.total)}
          ${growthText ? `<span class="bar-delta ${growthClass}">${growthText}</span>` : ''}
        </span>
      </div>
    `;
  }).join('');
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

// ---- Delete (holdings + dividends) ----

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.delete-btn');
  if (!btn) return;
  const { id, type } = btn.dataset;
  const endpoint = type === 'holding' ? `/api/holdings/${id}` : `/api/dividends/${id}`;
  await api(endpoint, { method: 'DELETE' });
  await refreshAll();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

refreshAll().catch((err) => console.error(err));
