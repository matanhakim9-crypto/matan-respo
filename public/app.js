const fmtMoney = (n) =>
  new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n ?? 0);

const fmtPct = (n) => `${(n ?? 0).toFixed(2)}%`;
const fmtDate = (d) => new Date(d).toLocaleDateString('he-IL');

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

  renderHoldings(s.holdings ?? []);
}

function renderHoldings(holdings) {
  const body = document.getElementById('holdings-body');
  body.innerHTML = '';
  if (holdings.length === 0) {
    body.innerHTML = '<tr><td colspan="6" class="empty">עדיין אין מניות בתיק</td></tr>';
    return;
  }
  for (const h of holdings) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${h.ticker}</td>
      <td>${h.shares}</td>
      <td>${fmtMoney(h.amount_invested)}</td>
      <td>${h.currentPrice != null ? fmtMoney(h.currentPrice) : '—'}</td>
      <td>${fmtMoney(h.currentValue)}</td>
      <td><button class="delete-btn" data-id="${h.id}" data-type="holding">מחק</button></td>
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
    const total = p.shares_at_payment ? p.amount_per_share * p.shares_at_payment : null;
    const li = document.createElement('li');
    li.innerHTML = `
      <span>
        <strong>${p.ticker}</strong> · ${fmtDate(p.payment_date)} ·
        ${fmtMoney(p.amount_per_share)}/מניה${total != null ? ` · סה"כ ${fmtMoney(total)}` : ''}
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

document.getElementById('holding-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());
  await api('/api/holdings', {
    method: 'POST',
    body: JSON.stringify({
      ticker: data.ticker,
      shares: parseFloat(data.shares),
      amount_invested: parseFloat(data.amount_invested),
      purchase_date: data.purchase_date || null,
    }),
  });
  form.reset();
  await refreshAll();
});

document.getElementById('dividend-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());
  await api('/api/dividends', {
    method: 'POST',
    body: JSON.stringify({
      ticker: data.ticker,
      amount_per_share: parseFloat(data.amount_per_share),
      shares_at_payment: data.shares_at_payment ? parseFloat(data.shares_at_payment) : null,
      payment_date: data.payment_date,
      status: data.status,
    }),
  });
  form.reset();
  await refreshAll();
});

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
