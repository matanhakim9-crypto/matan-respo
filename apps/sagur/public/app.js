/* Sagur — app shell.
   Plain ES modules, no build step: the whole client is three files the phone
   caches once and then opens instantly. */

const state = {
  user: null,
  business: null,
  ent: null,
  usage: null,
  customers: [],
  catalog: [],
};

// ---------- utilities ----------

const $ = (selector, root = document) => root.querySelector(selector);

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function money(agorot, opts = {}) {
  const value = (Number(agorot) || 0) / 100;
  const digits = opts.round && Number.isInteger(value) ? 0 : 2;
  return `₪${value.toLocaleString('he-IL', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** Compact form for stat tiles: ₪12.4K instead of ₪12,400.00. */
function moneyShort(agorot) {
  const value = (Number(agorot) || 0) / 100;
  if (Math.abs(value) >= 1000) return `₪${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}K`;
  return `₪${Math.round(value).toLocaleString('he-IL')}`;
}

function parseShekels(text) {
  const cleaned = String(text ?? '').replace(/[^\d.,-]/g, '').replace(/,/g, '');
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

function agorotToInput(agorot) {
  const value = (Number(agorot) || 0) / 100;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function todayIso() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function relativeDays(iso) {
  if (!iso) return '';
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  if (!Number.isFinite(days)) return '';
  if (days <= 0) return 'היום';
  if (days === 1) return 'אתמול';
  if (days < 30) return `לפני ${days} ימים`;
  const months = Math.floor(days / 30);
  return months === 1 ? 'לפני חודש' : `לפני ${months} חודשים`;
}

function initials(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

const STATUS_LABELS = {
  draft: 'טיוטה',
  sent: 'נשלחה',
  viewed: 'נצפתה',
  approved: 'אושרה',
  declined: 'נדחתה',
  cancelled: 'בוטלה',
  expired: 'פג תוקף',
};

function statusBadge(status) {
  return `<span class="badge badge--${esc(status)}">${esc(STATUS_LABELS[status] ?? status)}</span>`;
}

let toastTimer;
function toast(message, kind = 'ok') {
  const el = $('#toast');
  el.textContent = message;
  el.className = kind === 'bad' ? 'toast toast--bad' : 'toast';
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 3200);
}

// ---------- api ----------

class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      state.user = null;
      showAuth();
    }
    throw new ApiError(data.error || 'משהו השתבש', res.status, data.code);
  }
  return data;
}

// ---------- bottom sheet ----------

function openSheet(html, { onMount } = {}) {
  const root = $('#sheetRoot');
  root.innerHTML = `<div class="sheet-backdrop"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
  const backdrop = $('.sheet-backdrop', root);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) closeSheet();
  });
  root.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', closeSheet));
  document.body.style.overflow = 'hidden';
  onMount?.($('.sheet', root));
}

function closeSheet() {
  $('#sheetRoot').innerHTML = '';
  document.body.style.overflow = '';
}

function confirmSheet({ title, text, confirmLabel = 'אישור', danger = false }) {
  return new Promise((resolve) => {
    openSheet(
      `<h2 class="sheet-title">${esc(title)}</h2>
       <p class="muted">${esc(text)}</p>
       <div class="sheet-actions">
         <button class="btn btn-secondary grow" data-close>ביטול</button>
         <button class="btn ${danger ? 'btn-danger' : 'btn-primary'} grow" data-confirm>${esc(confirmLabel)}</button>
       </div>`,
      {
        onMount(sheet) {
          $('[data-confirm]', sheet).addEventListener('click', () => {
            closeSheet();
            resolve(true);
          });
          sheet.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => resolve(false)));
        },
      }
    );
  });
}

// ---------- auth screen ----------

function showAuth() {
  $('#boot').hidden = true;
  $('#appView').hidden = true;
  $('#authView').hidden = false;
}

document.querySelectorAll('[data-auth-tab]').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('[data-auth-tab]').forEach((t) => t.classList.toggle('is-active', t === tab));
    const showLogin = tab.dataset.authTab === 'login';
    $('#loginForm').hidden = !showLogin;
    $('#registerForm').hidden = showLogin;
  });
});

function bindAuthForm(formId, path) {
  const form = $(formId);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorEl = $('[data-error]', form);
    const submit = form.querySelector('button[type=submit]');
    errorEl.hidden = true;
    submit.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(form).entries());
      await api(path, { method: 'POST', body: data });
      form.reset();
      await boot();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });
}

bindAuthForm('#loginForm', '/auth/login');
bindAuthForm('#registerForm', '/auth/register');

// ---------- router ----------

const routes = [
  { pattern: /^\/$/, view: viewDashboard, title: 'בית', tab: '/' },
  { pattern: /^\/quotes$/, view: viewQuotes, title: 'הצעות מחיר', tab: '/quotes' },
  { pattern: /^\/quotes\/new$/, view: (ctx) => viewQuoteEditor({ ...ctx, id: null }), title: 'הצעה חדשה', tab: '/quotes/new' },
  { pattern: /^\/quotes\/(\d+)$/, view: (ctx) => viewQuoteEditor({ ...ctx, id: Number(ctx.params[0]) }), title: 'הצעה', tab: '/quotes' },
  { pattern: /^\/customers$/, view: viewCustomers, title: 'לקוחות', tab: '/customers' },
  { pattern: /^\/catalog$/, view: viewCatalog, title: 'מחירון', tab: '/settings' },
  { pattern: /^\/settings$/, view: viewSettings, title: 'הגדרות', tab: '/settings' },
  { pattern: /^\/upgrade$/, view: viewUpgrade, title: 'שדרוג ל-Pro', tab: '/settings' },
];

function currentPath() {
  const raw = location.hash.replace(/^#/, '') || '/';
  return raw.split('?')[0];
}

function navigate(path) {
  if (currentPath() === path) render();
  else location.hash = path;
}

async function render() {
  if (!state.user) return;
  const path = currentPath();
  const match = routes.map((r) => ({ r, m: path.match(r.pattern) })).find((entry) => entry.m);
  const route = match?.r ?? routes[0];
  const params = match?.m?.slice(1) ?? [];

  $('#topbarTitle').textContent = route.title;
  $('#topbarActions').innerHTML = '';
  document.querySelectorAll('.tabbar-item').forEach((item) => {
    item.classList.toggle('is-active', item.dataset.tab === route.tab);
  });

  const root = $('#viewRoot');
  root.innerHTML = '<div class="spinner" aria-label="טוען"></div>';
  try {
    await route.view({ root, params, query: new URLSearchParams(location.hash.split('?')[1] ?? '') });
  } catch (err) {
    if (err.status === 401) return;
    root.innerHTML = `<div class="empty"><div class="empty-mark">⚠️</div><h3>לא הצלחנו לטעון</h3><p>${esc(
      err.message
    )}</p></div>`;
  }
  // Back to the top of the page, not of the view — the header is sticky and
  // would otherwise cover the first card.
  window.scrollTo({ top: 0 });
}

window.addEventListener('hashchange', render);

// ---------- dashboard ----------

async function viewDashboard({ root }) {
  const stats = await api('/stats');
  const ent = state.ent ?? {};
  const usage = state.usage ?? {};

  const trialBanner =
    ent.trialing && ent.trial_days_left <= 7
      ? `<div class="banner-upgrade">
           <h3>נשארו ${ent.trial_days_left} ימי ניסיון</h3>
           <p>אחרי זה אפשר להמשיך במסלול החינמי (${
             ent.monthly_quote_limit ?? 3
           } הצעות בחודש) או לשדרג ל-Pro ללא הגבלה.</p>
           <a class="btn btn-secondary" href="#/upgrade">לפרטים על Pro</a>
         </div>`
      : '';

  const quotaBanner =
    !ent.trialing && ent.plan === 'free'
      ? `<div class="card row-between">
           <div><div class="strong">${usage.quotes_this_month ?? 0} מתוך ${
             ent.monthly_quote_limit ?? 3
           } הצעות החודש</div>
           <p class="muted">מסלול חינמי</p></div>
           <a class="btn btn-primary btn-sm" href="#/upgrade">שדרוג</a>
         </div>`
      : '';

  const maxMonth = Math.max(...stats.months.map((m) => m.won_total), 1);
  const bars = stats.months
    .map((m) => {
      const height = Math.round((m.won_total / maxMonth) * 100);
      const label = new Date(`${m.month}-01T00:00:00`).toLocaleDateString('he-IL', { month: 'short' });
      return `<div class="bar-col">
                <div class="bar-track"><div class="bar-fill" style="height:${Math.max(height, 2)}%"
                  title="${esc(money(m.won_total))}"></div></div>
                <span class="bar-label">${esc(label)}</span>
              </div>`;
    })
    .join('');

  const followUps = stats.follow_ups.length
    ? stats.follow_ups
        .map(
          (q) => `<button class="list-item" data-quote="${q.id}">
            <div class="avatar">${esc(initials(q.customer_name ?? '?'))}</div>
            <div class="grow">
              <div class="strong truncate">${esc(q.customer_name ?? 'ללא לקוח')}</div>
              <div class="muted truncate">${esc(q.title || q.number)} · נשלחה ${esc(relativeDays(q.sent_at))}${
                q.view_count > 0 ? ' · נצפתה' : ' · טרם נפתחה'
              }</div>
            </div>
            <div class="strong">${esc(moneyShort(q.total))}</div>
          </button>`
        )
        .join('')
    : `<div class="card muted">אין הצעות שממתינות למעקב. יפה.</div>`;

  root.innerHTML = `
    <div class="stack">
      ${trialBanner}
      ${quotaBanner}
      <div class="stat-grid">
        <div class="stat">
          <div class="stat-label">בהמתנה לתשובה</div>
          <div class="stat-value">${esc(moneyShort(stats.open.value))}</div>
          <div class="stat-sub">${stats.open.count} הצעות פתוחות</div>
        </div>
        <div class="stat">
          <div class="stat-label">נסגר החודש</div>
          <div class="stat-value">${esc(moneyShort(stats.won_this_month.value))}</div>
          <div class="stat-sub">${stats.won_this_month.count} עסקאות</div>
        </div>
        <div class="stat">
          <div class="stat-label">אחוז סגירה (90 יום)</div>
          <div class="stat-value">${Math.round((stats.win_rate_90d.rate || 0) * 100)}%</div>
          <div class="stat-sub">${stats.win_rate_90d.won} מתוך ${stats.win_rate_90d.sent}</div>
        </div>
        <div class="stat">
          <div class="stat-label">הצעה ממוצעת</div>
          <div class="stat-value">${esc(moneyShort(stats.average_quote))}</div>
          <div class="stat-sub">${stats.drafts} טיוטות פתוחות</div>
        </div>
      </div>

      <div class="card">
        <div class="row-between"><h3 style="font-size:15px">נסגר ב-6 החודשים האחרונים</h3></div>
        <div class="bars">${bars}</div>
      </div>

      <div>
        <div class="section-title">דורש מעקב</div>
        <div class="list">${followUps}</div>
      </div>

      <a class="btn btn-primary btn-block" href="#/quotes/new">＋ הצעת מחיר חדשה</a>
    </div>`;

  root.querySelectorAll('[data-quote]').forEach((btn) =>
    btn.addEventListener('click', () => navigate(`/quotes/${btn.dataset.quote}`))
  );
}

// ---------- quotes list ----------

const QUOTE_FILTERS = [
  { key: 'all', label: 'הכול' },
  { key: 'open', label: 'ממתינות' },
  { key: 'draft', label: 'טיוטות' },
  { key: 'approved', label: 'אושרו' },
  { key: 'declined', label: 'נדחו' },
  { key: 'expired', label: 'פג תוקף' },
];

let quotesFilter = 'all';
let quotesSearch = '';

async function viewQuotes({ root }) {
  $('#topbarActions').innerHTML = `<a class="btn btn-primary btn-sm" href="#/quotes/new">＋ חדשה</a>`;

  root.innerHTML = `
    <div class="stack">
      <input type="search" id="quoteSearch" placeholder="חיפוש לפי לקוח, מספר או כותרת" value="${esc(quotesSearch)}">
      <div class="chips">${QUOTE_FILTERS.map(
        (f) => `<button class="chip ${f.key === quotesFilter ? 'is-active' : ''}" data-filter="${f.key}">${esc(
          f.label
        )}</button>`
      ).join('')}</div>
      <div id="quotesList" class="list"><div class="spinner"></div></div>
    </div>`;

  const listEl = $('#quotesList', root);

  async function load() {
    const params = new URLSearchParams();
    if (quotesFilter !== 'all') params.set('status', quotesFilter);
    if (quotesSearch) params.set('q', quotesSearch);
    const quotes = await api(`/quotes?${params}`);

    if (quotes.length === 0) {
      listEl.innerHTML = `<div class="empty">
        <div class="empty-mark">📄</div>
        <h3>אין כאן הצעות</h3>
        <p>כל הצעה שתיצרו תופיע כאן עם הסטטוס שלה.</p>
      </div>`;
      return;
    }

    listEl.innerHTML = quotes
      .map(
        (q) => `<button class="list-item" data-quote="${q.id}">
          <div class="avatar">${esc(initials(q.customer_name ?? '?'))}</div>
          <div class="grow">
            <div class="row-between">
              <span class="strong truncate">${esc(q.customer_name ?? 'ללא לקוח')}</span>
              ${statusBadge(q.effective_status)}
            </div>
            <div class="muted truncate">${esc(q.number)}${q.title ? ` · ${esc(q.title)}` : ''} · ${esc(
              relativeDays(q.created_at)
            )}</div>
          </div>
          <div class="strong">${esc(moneyShort(q.total))}</div>
        </button>`
      )
      .join('');

    listEl.querySelectorAll('[data-quote]').forEach((btn) =>
      btn.addEventListener('click', () => navigate(`/quotes/${btn.dataset.quote}`))
    );
  }

  root.querySelectorAll('[data-filter]').forEach((chip) =>
    chip.addEventListener('click', () => {
      quotesFilter = chip.dataset.filter;
      root.querySelectorAll('[data-filter]').forEach((c) => c.classList.toggle('is-active', c === chip));
      listEl.innerHTML = '<div class="spinner"></div>';
      load();
    })
  );

  let searchTimer;
  $('#quoteSearch', root).addEventListener('input', (event) => {
    quotesSearch = event.target.value.trim();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(load, 250);
  });

  await load();
}

// ---------- quote editor ----------

function emptyItem() {
  return { name: '', details: '', unit: 'יח׳', quantity: 1, unit_price: 0 };
}

function computeTotals(items, { discount_type, discount_value, vat_rate }) {
  const subtotal = items.reduce((sum, item) => sum + Math.round((Number(item.quantity) || 0) * (item.unit_price || 0)), 0);
  let discount = 0;
  if (discount_type === 'percent') discount = Math.round((subtotal * Math.min(Math.max(discount_value, 0), 100)) / 100);
  else if (discount_type === 'amount') discount = Math.min(Math.max(discount_value, 0), subtotal);
  const net = subtotal - discount;
  const vat = Math.round((net * (vat_rate || 0)) / 100);
  return { subtotal, discount, net, vat, total: net + vat };
}

async function viewQuoteEditor({ root, id }) {
  const isNew = id === null;
  let quote;
  let items;
  let events = [];
  let shareLink = '';

  if (isNew) {
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + (state.business?.validity_days ?? 14));
    quote = {
      id: null,
      customer_id: null,
      number: 'טיוטה חדשה',
      title: '',
      status: 'draft',
      effective_status: 'draft',
      issue_date: todayIso(),
      valid_until: validUntil.toISOString().slice(0, 10),
      notes: '',
      terms: state.business?.default_terms ?? '',
      discount_type: 'none',
      discount_value: 0,
      vat_rate: state.business?.vat_rate ?? 18,
    };
    items = [emptyItem()];
  } else {
    const data = await api(`/quotes/${id}`);
    quote = data.quote;
    items = data.items.map((item) => ({ ...item }));
    events = data.events;
    shareLink = data.share_url;
  }

  await ensureCustomers();

  const editable = quote.status === 'draft';
  if (!editable) return renderQuoteDetail({ root, quote, items, events, shareLink });

  function customerName() {
    return state.customers.find((c) => c.id === quote.customer_id)?.name ?? '';
  }

  function paint() {
    const totals = computeTotals(items, quote);
    root.innerHTML = `
      <div class="stack">
        <div class="card stack">
          <button class="row-between" id="pickCustomer" style="background:none;border:0;padding:0;text-align:start;cursor:pointer">
            <div class="grow">
              <div class="muted">לקוח</div>
              <div class="strong truncate">${
                quote.customer_id ? esc(customerName()) : '<span class="muted">בחרו לקוח</span>'
              }</div>
            </div>
            <span class="muted">שינוי ›</span>
          </button>
          <label class="field"><span>כותרת ההצעה</span>
            <input type="text" id="qTitle" placeholder="למשל: התקנת 3 מזגנים" value="${esc(quote.title)}"></label>
        </div>

        <div class="section-title">פריטים</div>
        <div class="stack" id="itemsList">
          ${items.map((item, index) => itemCardHtml(item, index)).join('')}
        </div>

        <div class="row" style="gap:10px">
          <button class="btn btn-secondary grow" id="addFromCatalog">＋ מהמחירון</button>
          <button class="btn btn-secondary grow" id="addBlank">＋ פריט חופשי</button>
        </div>

        <div class="totals-card">
          <div class="total-line"><span>סכום ביניים</span><span>${esc(money(totals.subtotal))}</span></div>
          ${
            totals.discount > 0
              ? `<div class="total-line"><span>הנחה</span><span>−${esc(money(totals.discount))}</span></div>`
              : ''
          }
          <div class="total-line"><span>מע״מ ${esc(quote.vat_rate)}%</span><span>${esc(money(totals.vat))}</span></div>
          <div class="total-line total-line--final"><span>סה״כ</span><span>${esc(money(totals.total))}</span></div>
        </div>

        <details class="accordion">
          <summary>הנחה, תוקף והערות</summary>
          <div class="accordion-body">
            <div class="field-row">
              <label class="field"><span>סוג הנחה</span>
                <select id="discountType">
                  <option value="none" ${quote.discount_type === 'none' ? 'selected' : ''}>ללא</option>
                  <option value="percent" ${quote.discount_type === 'percent' ? 'selected' : ''}>אחוזים</option>
                  <option value="amount" ${quote.discount_type === 'amount' ? 'selected' : ''}>סכום</option>
                </select></label>
              <label class="field"><span>ערך ההנחה</span>
                <input type="number" id="discountValue" inputmode="decimal" min="0" step="0.01"
                  value="${quote.discount_type === 'amount' ? agorotToInput(quote.discount_value) : quote.discount_value}"
                  ${quote.discount_type === 'none' ? 'disabled' : ''}></label>
            </div>
            <div class="field-row">
              <label class="field"><span>תאריך הצעה</span>
                <input type="date" id="issueDate" value="${esc(quote.issue_date)}"></label>
              <label class="field"><span>בתוקף עד</span>
                <input type="date" id="validUntil" value="${esc(quote.valid_until ?? '')}"></label>
            </div>
            <label class="field"><span>מע״מ (%)</span>
              <input type="number" id="vatRate" inputmode="decimal" min="0" max="100" step="0.1" value="${esc(
                quote.vat_rate
              )}"></label>
            <label class="field"><span>הערות ללקוח</span>
              <textarea id="qNotes" placeholder="מה כלול, לוחות זמנים, מה לא כלול…">${esc(quote.notes)}</textarea></label>
            <label class="field"><span>תנאים</span>
              <textarea id="qTerms">${esc(quote.terms)}</textarea></label>
          </div>
        </details>

        <div class="sticky-actions">
          <button class="btn btn-secondary grow" id="saveDraft">שמירת טיוטה</button>
          <button class="btn btn-primary grow" id="sendQuote">שליחה ללקוח</button>
        </div>

        ${
          isNew
            ? ''
            : `<button class="btn btn-danger btn-block" id="deleteQuote">מחיקת ההצעה</button>`
        }
      </div>`;

    bindEditor();
  }

  function itemCardHtml(item, index) {
    const total = Math.round((Number(item.quantity) || 0) * (item.unit_price || 0));
    return `<div class="item-card" data-item="${index}">
      <div class="item-head">
        <input type="text" class="grow" data-field="name" placeholder="תיאור העבודה או החומר" value="${esc(item.name)}">
        <button class="btn btn-icon btn-ghost" data-remove aria-label="מחיקת פריט">
          <svg viewBox="0 0 24 24"><path d="M6 7h12M9 7V5h6v2m-8 0 1 13h8l1-13"/></svg>
        </button>
      </div>
      <div class="item-calc">
        <label class="field"><span>כמות</span>
          <input type="number" data-field="quantity" inputmode="decimal" step="0.01" value="${esc(item.quantity)}"></label>
        <label class="field"><span>מחיר ליח׳</span>
          <input type="text" data-field="unit_price" inputmode="decimal" value="${esc(
            agorotToInput(item.unit_price)
          )}"></label>
        <div class="item-total">${esc(money(total))}</div>
      </div>
      ${
        item.name && !item.catalog_item_id
          ? `<button class="btn btn-ghost btn-sm" data-save-catalog style="justify-self:start">שמירה למחירון</button>`
          : ''
      }
    </div>`;
  }

  function bindEditor() {
    $('#pickCustomer', root).addEventListener('click', () =>
      pickCustomer((customer) => {
        quote.customer_id = customer.id;
        paint();
      })
    );

    $('#qTitle', root).addEventListener('input', (e) => {
      quote.title = e.target.value;
    });

    root.querySelectorAll('[data-item]').forEach((card) => {
      const index = Number(card.dataset.item);
      card.querySelectorAll('[data-field]').forEach((input) => {
        const field = input.dataset.field;
        input.addEventListener('input', () => {
          if (field === 'quantity') items[index][field] = Number(input.value) || 0;
          else if (field === 'unit_price') items[index][field] = parseShekels(input.value);
          else items[index][field] = input.value;
          if (field !== 'name') refreshTotals();
        });
      });

      card.querySelector('[data-remove]').addEventListener('click', () => {
        items.splice(index, 1);
        if (items.length === 0) items.push(emptyItem());
        paint();
      });

      card.querySelector('[data-save-catalog]')?.addEventListener('click', async () => {
        const item = items[index];
        try {
          const created = await api('/catalog', {
            method: 'POST',
            body: { name: item.name, details: item.details, unit: item.unit, unit_price: item.unit_price },
          });
          item.catalog_item_id = created.id;
          state.catalog = [];
          toast('נשמר למחירון');
          paint();
        } catch (err) {
          toast(err.message, 'bad');
        }
      });
    });

    $('#addBlank', root).addEventListener('click', () => {
      items.push(emptyItem());
      paint();
    });

    $('#addFromCatalog', root).addEventListener('click', () =>
      pickCatalogItems((picked) => {
        if (items.length === 1 && !items[0].name) items.pop();
        picked.forEach((entry) =>
          items.push({
            name: entry.name,
            details: entry.details,
            unit: entry.unit,
            quantity: 1,
            unit_price: entry.unit_price,
            catalog_item_id: entry.id,
          })
        );
        paint();
      })
    );

    const discountType = $('#discountType', root);
    discountType.addEventListener('change', () => {
      quote.discount_type = discountType.value;
      quote.discount_value = 0;
      paint();
    });
    $('#discountValue', root).addEventListener('input', (e) => {
      quote.discount_value = quote.discount_type === 'amount' ? parseShekels(e.target.value) : Number(e.target.value) || 0;
      refreshTotals();
    });
    $('#issueDate', root).addEventListener('change', (e) => {
      quote.issue_date = e.target.value;
    });
    $('#validUntil', root).addEventListener('change', (e) => {
      quote.valid_until = e.target.value;
    });
    $('#vatRate', root).addEventListener('input', (e) => {
      quote.vat_rate = Number(e.target.value) || 0;
      refreshTotals();
    });
    $('#qNotes', root).addEventListener('input', (e) => {
      quote.notes = e.target.value;
    });
    $('#qTerms', root).addEventListener('input', (e) => {
      quote.terms = e.target.value;
    });

    $('#saveDraft', root).addEventListener('click', async () => {
      const saved = await save();
      if (saved) toast('הטיוטה נשמרה');
    });

    $('#sendQuote', root).addEventListener('click', async () => {
      const saved = await save();
      if (!saved) return;
      try {
        const result = await api(`/quotes/${saved.id}/send`, { method: 'POST' });
        shareQuote(result.quote, result.share_url);
      } catch (err) {
        toast(err.message, 'bad');
      }
    });

    $('#deleteQuote', root)?.addEventListener('click', async () => {
      const ok = await confirmSheet({
        title: 'למחוק את ההצעה?',
        text: 'הפעולה לא ניתנת לביטול.',
        confirmLabel: 'מחיקה',
        danger: true,
      });
      if (!ok) return;
      await api(`/quotes/${quote.id}`, { method: 'DELETE' });
      toast('ההצעה נמחקה');
      navigate('/quotes');
    });
  }

  /** Repaints just the totals so typing does not lose input focus. */
  function refreshTotals() {
    const totals = computeTotals(items, quote);
    const card = root.querySelector('.totals-card');
    if (card) {
      card.innerHTML = `
        <div class="total-line"><span>סכום ביניים</span><span>${esc(money(totals.subtotal))}</span></div>
        ${
          totals.discount > 0
            ? `<div class="total-line"><span>הנחה</span><span>−${esc(money(totals.discount))}</span></div>`
            : ''
        }
        <div class="total-line"><span>מע״מ ${esc(quote.vat_rate)}%</span><span>${esc(money(totals.vat))}</span></div>
        <div class="total-line total-line--final"><span>סה״כ</span><span>${esc(money(totals.total))}</span></div>`;
    }
    root.querySelectorAll('[data-item]').forEach((card2, index) => {
      const item = items[index];
      if (!item) return;
      const totalEl = card2.querySelector('.item-total');
      if (totalEl) totalEl.textContent = money(Math.round((Number(item.quantity) || 0) * (item.unit_price || 0)));
    });
  }

  async function save() {
    const payload = {
      customer_id: quote.customer_id,
      title: quote.title,
      issue_date: quote.issue_date,
      valid_until: quote.valid_until || null,
      notes: quote.notes,
      terms: quote.terms,
      discount_type: quote.discount_type,
      discount_value: quote.discount_value,
      vat_rate: quote.vat_rate,
      items: items.filter((item) => item.name.trim() !== ''),
    };

    try {
      if (quote.id === null) {
        const created = await api('/quotes', { method: 'POST', body: payload });
        quote = { ...quote, ...created };
        // Move to the saved quote's own URL so a refresh keeps the work.
        history.replaceState(null, '', `#/quotes/${created.id}`);
        await refreshSession();
        return created;
      }
      const updated = await api(`/quotes/${quote.id}`, { method: 'PUT', body: payload });
      quote = { ...quote, ...updated };
      return updated;
    } catch (err) {
      if (err.code === 'quota_exceeded') {
        openUpgradeSheet(err.message);
        return null;
      }
      toast(err.message, 'bad');
      return null;
    }
  }

  paint();
}

// ---------- sent quote detail ----------

function renderQuoteDetail({ root, quote, items, events, shareLink }) {
  const customerName = state.customers.find((c) => c.id === quote.customer_id)?.name;
  const eventLabels = {
    created: 'ההצעה נוצרה',
    sent: 'נשלחה ללקוח',
    viewed: 'הלקוח פתח את ההצעה',
    approved: 'הלקוח אישר',
    declined: 'הלקוח דחה',
    reopened: 'נפתחה מחדש לעריכה',
    cancelled: 'בוטלה',
  };

  root.innerHTML = `
    <div class="stack">
      <div class="card stack">
        <div class="row-between">
          <div>
            <div class="muted">${esc(quote.number)}</div>
            <h2 style="font-size:18px">${esc(quote.title || customerName || 'הצעת מחיר')}</h2>
          </div>
          ${statusBadge(quote.effective_status)}
        </div>
        <div class="row-between">
          <span class="muted">סה״כ</span><span class="strong" style="font-size:19px">${esc(money(quote.total))}</span>
        </div>
        <div class="row-between"><span class="muted">בתוקף עד</span><span>${esc(formatDate(quote.valid_until))}</span></div>
        <div class="row-between"><span class="muted">צפיות</span><span>${quote.view_count} ${
          quote.first_viewed_at ? `· לראשונה ${esc(relativeDays(quote.first_viewed_at))}` : ''
        }</span></div>
      </div>

      ${
        quote.status === 'approved'
          ? `<div class="card" style="border-color:var(--ok)">
               <div class="strong" style="color:var(--ok)">אושרה וחתומה</div>
               <p class="muted">${esc(quote.signer_name ?? '')} · ${esc(formatDate(quote.decided_at))}</p>
               ${
                 quote.signature_image
                   ? `<img src="${esc(
                       quote.signature_image
                     )}" alt="חתימת הלקוח" style="max-width:220px;margin-top:10px;background:#fff;border-radius:8px">`
                   : ''
               }
             </div>`
          : ''
      }
      ${
        quote.status === 'declined' && quote.decline_reason
          ? `<div class="card"><div class="strong">סיבת הדחייה</div><p class="muted">${esc(
              quote.decline_reason
            )}</p></div>`
          : ''
      }

      <div class="card">
        <div class="section-title" style="margin-top:0">פריטים</div>
        ${items
          .map(
            (item) => `<div class="row-between" style="padding:7px 0;border-bottom:1px solid var(--line)">
              <div class="grow"><div class="truncate">${esc(item.name)}</div>
              <div class="muted">${esc(item.quantity)} ${esc(item.unit)} × ${esc(money(item.unit_price))}</div></div>
              <div class="strong">${esc(money(item.line_total))}</div>
            </div>`
          )
          .join('')}
      </div>

      <div class="row" style="gap:10px">
        <button class="btn btn-primary grow" id="shareAgain">שיתוף הקישור</button>
        <a class="btn btn-secondary grow" href="${esc(shareLink)}" target="_blank" rel="noopener">תצוגת הלקוח</a>
      </div>

      ${
        quote.status === 'sent' || quote.status === 'viewed'
          ? `<div class="row" style="gap:10px">
               <button class="btn btn-secondary grow" data-status="approved">סימון כאושרה</button>
               <button class="btn btn-secondary grow" data-status="declined">סימון כנדחתה</button>
             </div>`
          : ''
      }

      <div class="card">
        <div class="section-title" style="margin-top:0">היסטוריה</div>
        <div class="timeline">
          ${events
            .map(
              (event) => `<div class="timeline-item">
                <span class="timeline-dot"></span>
                <div class="grow"><div>${esc(eventLabels[event.type] ?? event.type)}</div>
                <div class="muted">${esc(formatDate(event.created_at))}${
                  event.detail ? ` · ${esc(event.detail)}` : ''
                }</div></div>
              </div>`
            )
            .join('')}
        </div>
      </div>

      <div class="row" style="gap:10px">
        <button class="btn btn-secondary grow" id="duplicateQuote">שכפול</button>
        <button class="btn btn-secondary grow" data-status="draft">פתיחה לעריכה</button>
      </div>
    </div>`;

  $('#shareAgain', root).addEventListener('click', () => shareQuote(quote, shareLink));

  root.querySelectorAll('[data-status]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const target = btn.dataset.status;
      if (target === 'draft') {
        const ok = await confirmSheet({
          title: 'לפתוח מחדש לעריכה?',
          text: 'ההצעה תחזור להיות טיוטה. אם הלקוח כבר חתם, החתימה תימחק ותצטרכו לשלוח שוב.',
          confirmLabel: 'פתיחה לעריכה',
        });
        if (!ok) return;
      }
      try {
        await api(`/quotes/${quote.id}/status`, { method: 'POST', body: { status: target } });
        toast('עודכן');
        render();
      } catch (err) {
        toast(err.message, 'bad');
      }
    })
  );

  $('#duplicateQuote', root).addEventListener('click', async () => {
    try {
      const created = await api(`/quotes/${quote.id}/duplicate`, { method: 'POST' });
      await refreshSession();
      navigate(`/quotes/${created.id}`);
    } catch (err) {
      if (err.code === 'quota_exceeded') openUpgradeSheet(err.message);
      else toast(err.message, 'bad');
    }
  });
}

// ---------- sharing ----------

function shareQuote(quote, link) {
  const customer = state.customers.find((c) => c.id === quote.customer_id);
  const business = state.business?.name ?? '';
  const message = `שלום${customer?.contact_name ? ` ${customer.contact_name}` : ''}, מצורפת הצעת מחיר${
    business ? ` מ${business}` : ''
  } על סך ${money(quote.total)}.\nלצפייה ואישור: ${link}`;
  const phone = (customer?.phone ?? '').replace(/\D/g, '').replace(/^0/, '972');

  openSheet(
    `<h2 class="sheet-title">שליחת ההצעה</h2>
     <p class="muted">הקישור פתוח לצפייה ולאישור — הלקוח חותם ישירות מהטלפון.</p>
     <div class="sheet-list">
       ${
         phone
           ? `<a class="btn btn-primary btn-block" target="_blank" rel="noopener"
                href="https://wa.me/${phone}?text=${encodeURIComponent(message)}">שליחה בוואטסאפ</a>`
           : `<a class="btn btn-primary btn-block" target="_blank" rel="noopener"
                href="https://wa.me/?text=${encodeURIComponent(message)}">שליחה בוואטסאפ</a>`
       }
       <button class="btn btn-secondary btn-block" data-copy>העתקת הקישור</button>
       ${
         navigator.share
           ? `<button class="btn btn-secondary btn-block" data-native>שיתוף…</button>`
           : ''
       }
       <a class="btn btn-ghost btn-block" href="${esc(link)}" target="_blank" rel="noopener">תצוגה מקדימה</a>
     </div>
     <div class="sheet-actions"><button class="btn btn-ghost btn-block" data-close>סגירה</button></div>`,
    {
      onMount(sheet) {
        $('[data-copy]', sheet).addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(link);
            toast('הקישור הועתק');
          } catch {
            toast(link);
          }
        });
        $('[data-native]', sheet)?.addEventListener('click', () =>
          navigator.share({ title: 'הצעת מחיר', text: message, url: link }).catch(() => {})
        );
      },
    }
  );
}

// ---------- pickers ----------

async function ensureCustomers(force = false) {
  if (force || state.customers.length === 0) state.customers = await api('/customers');
  return state.customers;
}

async function ensureCatalog(force = false) {
  if (force || state.catalog.length === 0) state.catalog = await api('/catalog');
  return state.catalog;
}

async function pickCustomer(onPick) {
  const customers = await ensureCustomers(true);
  openSheet(
    `<h2 class="sheet-title">בחירת לקוח</h2>
     <input type="search" id="customerSearch" placeholder="חיפוש" style="margin-top:12px">
     <div class="sheet-list" id="customerResults">
       ${customers
         .map(
           (c) => `<button class="list-item" data-customer="${c.id}">
             <div class="avatar">${esc(initials(c.name))}</div>
             <div class="grow"><div class="strong truncate">${esc(c.name)}</div>
             <div class="muted truncate">${esc(c.phone || c.email || '')}</div></div>
           </button>`
         )
         .join('') || '<p class="muted">אין עדיין לקוחות.</p>'}
     </div>
     <div class="sheet-actions">
       <button class="btn btn-secondary grow" data-close>ביטול</button>
       <button class="btn btn-primary grow" id="newCustomer">לקוח חדש</button>
     </div>`,
    {
      onMount(sheet) {
        const bind = () =>
          sheet.querySelectorAll('[data-customer]').forEach((btn) =>
            btn.addEventListener('click', () => {
              const customer = state.customers.find((c) => c.id === Number(btn.dataset.customer));
              closeSheet();
              onPick(customer);
            })
          );
        bind();

        $('#customerSearch', sheet).addEventListener('input', (event) => {
          const term = event.target.value.trim().toLowerCase();
          const filtered = state.customers.filter((c) =>
            [c.name, c.phone, c.email].some((field) => String(field ?? '').toLowerCase().includes(term))
          );
          $('#customerResults', sheet).innerHTML =
            filtered
              .map(
                (c) => `<button class="list-item" data-customer="${c.id}">
                  <div class="avatar">${esc(initials(c.name))}</div>
                  <div class="grow"><div class="strong truncate">${esc(c.name)}</div>
                  <div class="muted truncate">${esc(c.phone || c.email || '')}</div></div>
                </button>`
              )
              .join('') || '<p class="muted">אין תוצאות.</p>';
          bind();
        });

        $('#newCustomer', sheet).addEventListener('click', () => {
          closeSheet();
          editCustomer(null, (created) => onPick(created));
        });
      },
    }
  );
}

async function pickCatalogItems(onPick) {
  const catalog = await ensureCatalog(true);
  openSheet(
    `<h2 class="sheet-title">בחירה מהמחירון</h2>
     <p class="muted">אפשר לבחור כמה פריטים בבת אחת.</p>
     <div class="sheet-list">
       ${
         catalog.length === 0
           ? '<p class="muted">המחירון ריק. אפשר להוסיף פריטים מההגדרות, או לשמור פריט מתוך הצעה.</p>'
           : catalog
               .map(
                 (item) => `<label class="list-item" style="cursor:pointer">
                   <input type="checkbox" value="${item.id}" style="width:22px;min-height:22px;flex:none">
                   <div class="grow"><div class="strong truncate">${esc(item.name)}</div>
                   <div class="muted truncate">${esc(money(item.unit_price))} / ${esc(item.unit)}</div></div>
                 </label>`
               )
               .join('')
       }
     </div>
     <div class="sheet-actions">
       <button class="btn btn-secondary grow" data-close>ביטול</button>
       <button class="btn btn-primary grow" id="addPicked">הוספה</button>
     </div>`,
    {
      onMount(sheet) {
        $('#addPicked', sheet).addEventListener('click', () => {
          const ids = [...sheet.querySelectorAll('input[type=checkbox]:checked')].map((input) => Number(input.value));
          const picked = state.catalog.filter((item) => ids.includes(item.id));
          closeSheet();
          if (picked.length > 0) onPick(picked);
        });
      },
    }
  );
}

// ---------- customers ----------

async function viewCustomers({ root }) {
  $('#topbarActions').innerHTML = `<button class="btn btn-primary btn-sm" id="addCustomer">＋ לקוח</button>`;
  const customers = await ensureCustomers(true);

  root.innerHTML =
    customers.length === 0
      ? `<div class="empty"><div class="empty-mark">👤</div><h3>אין עדיין לקוחות</h3>
         <p>כל לקוח שתוסיפו יישמר עם היסטוריית ההצעות שלו.</p></div>`
      : `<div class="list">${customers
          .map(
            (c) => `<button class="list-item" data-customer="${c.id}">
              <div class="avatar">${esc(initials(c.name))}</div>
              <div class="grow">
                <div class="strong truncate">${esc(c.name)}</div>
                <div class="muted truncate">${c.quote_count} הצעות${
                  c.won_total > 0 ? ` · נסגר ${esc(moneyShort(c.won_total))}` : ''
                }</div>
              </div>
              <span class="muted">›</span>
            </button>`
          )
          .join('')}</div>`;

  $('#addCustomer').addEventListener('click', () => editCustomer(null, () => render()));
  root.querySelectorAll('[data-customer]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const customer = customers.find((c) => c.id === Number(btn.dataset.customer));
      editCustomer(customer, () => render());
    })
  );
}

function editCustomer(customer, onSaved) {
  const isNew = !customer;
  openSheet(
    `<h2 class="sheet-title">${isNew ? 'לקוח חדש' : 'עריכת לקוח'}</h2>
     <form id="customerForm" class="stack" style="margin-top:14px">
       <label class="field"><span>שם *</span><input name="name" required value="${esc(customer?.name ?? '')}"></label>
       <label class="field"><span>איש קשר</span><input name="contact_name" value="${esc(
         customer?.contact_name ?? ''
       )}"></label>
       <label class="field"><span>טלפון</span><input name="phone" type="tel" inputmode="tel" value="${esc(
         customer?.phone ?? ''
       )}"></label>
       <label class="field"><span>אימייל</span><input name="email" type="email" inputmode="email" value="${esc(
         customer?.email ?? ''
       )}"></label>
       <label class="field"><span>כתובת</span><input name="address" value="${esc(customer?.address ?? '')}"></label>
       <p class="form-error" data-error hidden></p>
       <div class="sheet-actions">
         <button type="button" class="btn btn-secondary grow" data-close>ביטול</button>
         <button type="submit" class="btn btn-primary grow">שמירה</button>
       </div>
       ${isNew ? '' : '<button type="button" class="btn btn-danger btn-block" id="deleteCustomer">מחיקה</button>'}
     </form>`,
    {
      onMount(sheet) {
        const form = $('#customerForm', sheet);
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const body = Object.fromEntries(new FormData(form).entries());
          try {
            const saved = isNew
              ? await api('/customers', { method: 'POST', body })
              : await api(`/customers/${customer.id}`, { method: 'PUT', body });
            state.customers = [];
            closeSheet();
            toast('נשמר');
            onSaved?.(saved);
          } catch (err) {
            const errorEl = $('[data-error]', form);
            errorEl.textContent = err.message;
            errorEl.hidden = false;
          }
        });

        $('#deleteCustomer', sheet)?.addEventListener('click', async () => {
          closeSheet();
          const ok = await confirmSheet({
            title: 'למחוק את הלקוח?',
            text: 'לקוח עם היסטוריית הצעות יועבר לארכיון במקום להימחק.',
            confirmLabel: 'מחיקה',
            danger: true,
          });
          if (!ok) return;
          await api(`/customers/${customer.id}`, { method: 'DELETE' });
          state.customers = [];
          toast('הלקוח הוסר');
          onSaved?.();
        });
      },
    }
  );
}

// ---------- catalog ----------

async function viewCatalog({ root }) {
  $('#topbarActions').innerHTML = `<button class="btn btn-primary btn-sm" id="addItem">＋ פריט</button>`;
  const catalog = await ensureCatalog(true);

  root.innerHTML = `
    <div class="stack">
      <p class="muted">המחירון הוא מה שהופך הצעה חדשה לעניין של דקה. הפריטים הנפוצים עולים לראש הרשימה לבד.</p>
      ${
        catalog.length === 0
          ? `<div class="empty"><div class="empty-mark">🧰</div><h3>המחירון ריק</h3>
             <p>הוסיפו את העבודות והחומרים שאתם מתמחרים שוב ושוב.</p></div>`
          : `<div class="list">${catalog
              .map(
                (item) => `<button class="list-item" data-item="${item.id}">
                  <div class="grow"><div class="strong truncate">${esc(item.name)}</div>
                  <div class="muted truncate">${esc(item.unit)}${
                    item.use_count > 0 ? ` · בשימוש ${item.use_count} פעמים` : ''
                  }</div></div>
                  <div class="strong">${esc(money(item.unit_price))}</div>
                </button>`
              )
              .join('')}</div>`
      }
    </div>`;

  $('#addItem').addEventListener('click', () => editCatalogItem(null));
  root.querySelectorAll('[data-item]').forEach((btn) =>
    btn.addEventListener('click', () => editCatalogItem(catalog.find((i) => i.id === Number(btn.dataset.item))))
  );
}

function editCatalogItem(item) {
  const isNew = !item;
  openSheet(
    `<h2 class="sheet-title">${isNew ? 'פריט חדש במחירון' : 'עריכת פריט'}</h2>
     <form id="itemForm" class="stack" style="margin-top:14px">
       <label class="field"><span>שם הפריט *</span><input name="name" required value="${esc(item?.name ?? '')}"></label>
       <label class="field"><span>פירוט</span><textarea name="details">${esc(item?.details ?? '')}</textarea></label>
       <div class="field-row">
         <label class="field"><span>יחידה</span><input name="unit" value="${esc(item?.unit ?? 'יח׳')}"></label>
         <label class="field"><span>מחיר ליחידה</span>
           <input name="unit_price_text" inputmode="decimal" value="${esc(
             item ? agorotToInput(item.unit_price) : ''
           )}"></label>
       </div>
       <p class="form-error" data-error hidden></p>
       <div class="sheet-actions">
         <button type="button" class="btn btn-secondary grow" data-close>ביטול</button>
         <button type="submit" class="btn btn-primary grow">שמירה</button>
       </div>
       ${isNew ? '' : '<button type="button" class="btn btn-danger btn-block" id="deleteItem">מחיקה</button>'}
     </form>`,
    {
      onMount(sheet) {
        const form = $('#itemForm', sheet);
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const body = Object.fromEntries(new FormData(form).entries());
          try {
            if (isNew) await api('/catalog', { method: 'POST', body });
            else await api(`/catalog/${item.id}`, { method: 'PUT', body });
            state.catalog = [];
            closeSheet();
            toast('נשמר');
            render();
          } catch (err) {
            const errorEl = $('[data-error]', form);
            errorEl.textContent = err.message;
            errorEl.hidden = false;
          }
        });

        $('#deleteItem', sheet)?.addEventListener('click', async () => {
          await api(`/catalog/${item.id}`, { method: 'DELETE' });
          state.catalog = [];
          closeSheet();
          toast('הפריט נמחק');
          render();
        });
      },
    }
  );
}

// ---------- settings ----------

async function viewSettings({ root }) {
  const business = await api('/business');
  state.business = business;
  const ent = state.ent ?? {};

  root.innerHTML = `
    <div class="stack">
      <div class="card row-between">
        <div>
          <div class="strong">${ent.plan === 'pro' ? 'מסלול Pro' : 'מסלול חינמי'}</div>
          <p class="muted">${
            ent.trialing
              ? `תקופת ניסיון — נשארו ${ent.trial_days_left} ימים`
              : ent.plan === 'pro'
                ? 'הצעות ללא הגבלה, בלי מיתוג של סָגוּר'
                : `${state.usage?.quotes_this_month ?? 0} מתוך ${ent.monthly_quote_limit ?? 3} הצעות החודש`
          }</p>
        </div>
        ${ent.paid ? '' : '<a class="btn btn-primary btn-sm" href="#/upgrade">שדרוג</a>'}
      </div>

      <a class="list-item" href="#/catalog">
        <div class="avatar">🧰</div>
        <div class="grow"><div class="strong">מחירון</div><div class="muted">העבודות והחומרים שלכם</div></div>
        <span class="muted">›</span>
      </a>

      <form id="businessForm" class="card stack">
        <h3 style="font-size:15px">פרטי העסק</h3>
        <p class="muted">מה שמופיע בראש כל הצעה שהלקוח פותח.</p>
        <label class="field"><span>שם העסק</span><input name="name" value="${esc(business.name)}"></label>
        <label class="field"><span>שם בעל העסק</span><input name="owner_name" value="${esc(
          business.owner_name
        )}"></label>
        <div class="field-row">
          <label class="field"><span>טלפון</span><input name="phone" type="tel" inputmode="tel" value="${esc(
            business.phone
          )}"></label>
          <label class="field"><span>ע.מ / ח.פ</span><input name="tax_id" value="${esc(business.tax_id)}"></label>
        </div>
        <label class="field"><span>אימייל</span><input name="email" type="email" value="${esc(
          business.email
        )}"></label>
        <label class="field"><span>כתובת</span><input name="address" value="${esc(business.address)}"></label>
        <div class="field-row">
          <label class="field"><span>מע״מ (%)</span>
            <input name="vat_rate" type="number" step="0.1" min="0" max="100" value="${esc(business.vat_rate)}"></label>
          <label class="field"><span>תוקף הצעה (ימים)</span>
            <input name="validity_days" type="number" min="1" max="365" value="${esc(business.validity_days)}"></label>
        </div>
        <label class="field"><span>קידומת מספור</span>
          <input name="quote_prefix" placeholder="למשל 2026/" value="${esc(business.quote_prefix)}"></label>
        <label class="field"><span>תנאים כברירת מחדל</span>
          <textarea name="default_terms">${esc(business.default_terms)}</textarea></label>

        <div class="divider"></div>
        <h3 style="font-size:15px">מיתוג ${ent.can_upload_logo ? '' : '<span class="muted">(Pro)</span>'}</h3>
        <div class="row">
          ${
            business.logo_data_url
              ? `<img src="${esc(
                  business.logo_data_url
                )}" alt="לוגו" style="width:56px;height:56px;object-fit:contain;border-radius:12px;background:#fff">`
              : '<div class="avatar">🏷️</div>'
          }
          <div class="grow">
            <input type="file" id="logoInput" accept="image/png,image/jpeg,image/webp" ${
              ent.can_upload_logo ? '' : 'disabled'
            }>
          </div>
        </div>
        <label class="field"><span>צבע ראשי</span>
          <input name="accent_color" type="color" value="${esc(business.accent_color)}" ${
            ent.can_customise_colour ? '' : 'disabled'
          } style="height:46px;padding:4px"></label>

        <p class="form-error" data-error hidden></p>
        <button class="btn btn-primary btn-block" type="submit">שמירת פרטי העסק</button>
      </form>

      <form id="passwordForm" class="card stack">
        <h3 style="font-size:15px">שינוי סיסמה</h3>
        <label class="field"><span>סיסמה נוכחית</span><input name="current" type="password" required></label>
        <label class="field"><span>סיסמה חדשה</span><input name="next" type="password" minlength="8" required></label>
        <p class="form-error" data-error hidden></p>
        <button class="btn btn-secondary btn-block" type="submit">עדכון סיסמה</button>
      </form>

      <div class="card">
        <div class="muted">מחוברים כ-${esc(state.user?.email ?? '')}</div>
        <button class="btn btn-ghost btn-block" id="logout" style="margin-top:8px">התנתקות</button>
      </div>
    </div>`;

  let pendingLogo;
  $('#logoInput', root)?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 250_000) {
      toast('הקובץ גדול מדי (עד 250KB)', 'bad');
      event.target.value = '';
      return;
    }
    pendingLogo = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
    toast('הלוגו ייטען עם השמירה');
  });

  const businessForm = $('#businessForm', root);
  businessForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(businessForm).entries());
    if (pendingLogo) body.logo_data_url = pendingLogo;
    try {
      state.business = await api('/business', { method: 'PUT', body });
      toast('פרטי העסק נשמרו');
      render();
    } catch (err) {
      const errorEl = $('[data-error]', businessForm);
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  });

  const passwordForm = $('#passwordForm', root);
  passwordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(passwordForm).entries());
    const errorEl = $('[data-error]', passwordForm);
    try {
      await api('/auth/password', { method: 'POST', body });
      passwordForm.reset();
      errorEl.hidden = true;
      toast('הסיסמה עודכנה');
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  });

  $('#logout', root).addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' });
    state.user = null;
    showAuth();
  });
}

// ---------- upgrade ----------

function openUpgradeSheet(message) {
  openSheet(
    `<h2 class="sheet-title">הגעתם למכסה החודשית</h2>
     <p class="muted">${esc(message)}</p>
     <div class="sheet-actions">
       <button class="btn btn-secondary grow" data-close>לא עכשיו</button>
       <a class="btn btn-primary grow" href="#/upgrade" data-close>לשדרוג</a>
     </div>`
  );
}

async function viewUpgrade({ root }) {
  const billing = await api('/billing');
  const price = billing.price_agorot;

  root.innerHTML = `
    <div class="stack">
      <div class="card price-card">
        <div class="muted">מסלול Pro</div>
        <div class="price-amount">${esc(money(price, { round: true }))}</div>
        <div class="muted">לחודש · ביטול בכל עת</div>
        <ul class="price-list">
          <li>הצעות מחיר ללא הגבלה</li>
          <li>בלי מיתוג של סָגוּר על ההצעות שלכם</li>
          <li>לוגו וצבע העסק על כל הצעה</li>
          <li>היסטוריית לקוחות ומחירון מלא</li>
        </ul>
      </div>

      ${
        billing.entitlements.paid
          ? `<div class="card"><div class="strong">אתם כבר במסלול Pro 🎉</div>
             <p class="muted">${
               billing.entitlements.plan === 'pro' ? 'תודה שאתם איתנו.' : ''
             }</p></div>`
          : `<button class="btn btn-primary btn-block" id="checkout">מעבר לתשלום</button>`
      }

      ${
        billing.redeem_available
          ? `<form id="redeemForm" class="card stack">
               <h3 style="font-size:15px">יש לכם קוד?</h3>
               <label class="field"><span>קוד שדרוג</span><input name="code" placeholder="SAGUR-XXXX"></label>
               <p class="form-error" data-error hidden></p>
               <button class="btn btn-secondary btn-block" type="submit">מימוש הקוד</button>
             </form>`
          : ''
      }

      <p class="muted" style="text-align:center">
        התשלום מאובטח. אפשר לבטל בכל רגע — ההצעות שכבר נשלחו נשארות פעילות אצל הלקוחות.
      </p>
    </div>`;

  $('#checkout', root)?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const { url } = await api('/billing/checkout', { method: 'POST' });
      location.href = url;
    } catch (err) {
      toast(err.message, 'bad');
      button.disabled = false;
    }
  });

  const redeemForm = $('#redeemForm', root);
  redeemForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorEl = $('[data-error]', redeemForm);
    try {
      await api('/billing/redeem', {
        method: 'POST',
        body: Object.fromEntries(new FormData(redeemForm).entries()),
      });
      await refreshSession();
      toast('שודרגתם ל-Pro 🎉');
      navigate('/settings');
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  });
}

// ---------- boot ----------

async function refreshSession() {
  const data = await api('/auth/me');
  state.user = data.user;
  state.ent = data.entitlements ?? null;
  state.usage = data.usage ?? null;
  state.business = data.business ?? null;
  return data;
}

async function boot() {
  try {
    await refreshSession();
  } catch {
    state.user = null;
  }

  if (!state.user) {
    showAuth();
    return;
  }

  $('#authView').hidden = true;
  $('#boot').hidden = true;
  $('#appView').hidden = false;
  if (!location.hash) location.hash = '#/';
  await render();
}

boot();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
