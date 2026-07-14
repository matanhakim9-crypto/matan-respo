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

async function loadSummary() {
  const s = await api('/api/summary');
  document.getElementById('s-invested').textContent = fmtMoney(s.totalInvested);
  document.getElementById('s-current').textContent = fmtMoney(s.currentValue);

  const gainEl = document.getElementById('s-gain');
  gainEl.textContent = fmtMoney(s.gainLoss);
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
    body.innerHTML = '<tr><td colspan="6" class="empty">עדיין אין מניות בתיק</td></tr>';
    return;
  }
  for (const h of holdings) {
    const currency = h.currency ?? currencyForTicker(h.ticker);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${h.ticker}</td>
      <td>${h.market === 'IL' ? 'ת"א' : 'ארה"ב'}</td>
      <td>${h.shares}</td>
      <td>${h.currentPrice != null ? fmtMoney(h.currentPrice, currency) : '—'}</td>
      <td>${fmtMoney(h.currentValue, currency)}</td>
      <td>
        <button class="edit-btn" data-id="${h.id}">ערוך</button>
        <button class="delete-btn" data-id="${h.id}" data-type="holding">מחק</button>
      </td>
    `;
    body.appendChild(tr);
  }
}

async function loadDividends() {
  const [upcoming, all] = await Promise.all([
    api('/api/dividends/upcoming'),
    api('/api/dividends'),
  ]);
  renderPaymentList('upcoming-list', upcoming, 'עדיין אין תשלומים צפויים');
  renderPaymentList('all-payments-list', all, 'עדיין לא נוספו תשלומים');
}

function renderPaymentList(elementId, payments, emptyMessage) {
  const ul = document.getElementById(elementId);
  ul.innerHTML = '';
  if (payments.length === 0) {
    ul.innerHTML = `<li class="empty">${emptyMessage}</li>`;
    return;
  }
  for (const p of payments) {
    const currency = currencyForTicker(p.ticker);
    const total = p.shares_at_payment ? p.amount_per_share * p.shares_at_payment : null;
    const li = document.createElement('li');
    li.innerHTML = `
      <span>
        <strong>${p.ticker}</strong> · ${fmtDate(p.payment_date)} ·
        ${fmtMoney(p.amount_per_share, currency)}/מניה${total != null ? ` · סה"כ ${fmtMoney(total, currency)}` : ''}
        <span class="status-${p.status}"> (${p.status === 'paid' ? 'שולם' : 'צפוי'})</span>
      </span>
      <button class="delete-btn" data-id="${p.id}" data-type="dividend">מחק</button>
    `;
    ul.appendChild(li);
  }
}

async function refreshAll() {
  await Promise.all([loadSummary(), loadDividends()]);
}

function showError(elementId, err) {
  const el = document.getElementById(elementId);
  el.textContent = err.message || String(err);
  el.classList.remove('hidden');
}

function clearError(elementId) {
  document.getElementById(elementId).classList.add('hidden');
}

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

  if (!ticker || !price) {
    results.innerHTML = '<li class="empty">קודם מלא טיקר ומחיר למעלה</li>';
    return;
  }

  results.innerHTML = '<li class="empty">מחפש…</li>';
  try {
    const { matches } = await api(
      `/api/history/${encodeURIComponent(ticker)}?market=${market}&price=${price}`
    );
    if (!matches || matches.length === 0) {
      results.innerHTML = '<li class="empty">לא נמצאו תאריכים במחיר הזה, נסה מחיר אחר</li>';
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
