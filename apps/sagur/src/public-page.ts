import { effectiveStatus, isExpired, STATUS_LABELS } from './domain.ts';
import { formatAgorot } from './money.ts';
import type { BusinessRow, CustomerRow, QuoteItemRow, QuoteRow } from './types.ts';

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** DD/MM/YYYY — written out rather than via Intl so the output never shifts. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${formatDate(iso)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

export type PublicPageData = {
  quote: QuoteRow;
  items: QuoteItemRow[];
  business: BusinessRow;
  customer: CustomerRow | null;
  showBranding: boolean;
};

export function renderQuotePage(data: PublicPageData): string {
  const { quote, items, business, customer, showBranding } = data;
  const status = effectiveStatus(quote);
  const expired = isExpired(quote.valid_until);
  const decidable = (quote.status === 'sent' || quote.status === 'viewed') && !expired;
  const accent = /^#[0-9a-f]{6}$/i.test(business.accent_color) ? business.accent_color : '#1f6feb';
  const businessName = business.name || 'הצעת מחיר';

  const logo = business.logo_data_url
    ? `<img class="logo" src="${escapeHtml(business.logo_data_url)}" alt="${escapeHtml(businessName)}">`
    : `<div class="logo logo--fallback" aria-hidden="true">${escapeHtml(businessName.slice(0, 2))}</div>`;

  const rows = items
    .map(
      (item) => `
      <tr>
        <td class="cell-name">
          <span class="item-name">${escapeHtml(item.name)}</span>
          ${item.details ? `<span class="item-details">${escapeHtml(item.details)}</span>` : ''}
        </td>
        <td class="num">${escapeHtml(formatQuantity(item.quantity))} ${escapeHtml(item.unit)}</td>
        <td class="num">${escapeHtml(formatAgorot(item.unit_price))}</td>
        <td class="num strong">${escapeHtml(formatAgorot(item.line_total))}</td>
      </tr>`
    )
    .join('');

  const discountRow =
    quote.discount_amount > 0
      ? `<div class="total-row"><span>הנחה${
          quote.discount_type === 'percent' ? ` (${escapeHtml(quote.discount_value)}%)` : ''
        }</span><span>−${escapeHtml(formatAgorot(quote.discount_amount))}</span></div>`
      : '';

  const statusBanner = renderBanner(quote, status, expired);

  const signatureBlock =
    quote.status === 'approved'
      ? `<section class="signed-block">
           <h2>ההצעה אושרה</h2>
           <div class="signed-grid">
             <div><span class="label">אושרה על ידי</span><strong>${escapeHtml(quote.signer_name ?? '')}</strong></div>
             <div><span class="label">תאריך אישור</span><strong>${escapeHtml(formatDateTime(quote.decided_at))}</strong></div>
           </div>
           ${
             quote.signature_image
               ? `<div class="signature-shown"><span class="label">חתימה</span><img src="${escapeHtml(
                   quote.signature_image
                 )}" alt="חתימה"></div>`
               : ''
           }
         </section>`
      : '';

  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>הצעת מחיר ${escapeHtml(quote.number)} · ${escapeHtml(businessName)}</title>
<meta name="theme-color" content="${escapeHtml(accent)}">
<style>${pageStyles(accent)}</style>
</head>
<body>
<div class="actions no-print">
  <div class="actions-inner">
    ${
      decidable
        ? `<button type="button" class="btn btn-primary btn-grow" id="approveBtn">אישור ההצעה</button>
           <button type="button" class="btn btn-secondary" id="declineBtn">לא מאשר</button>`
        : ''
    }
    <button type="button" class="btn btn-ghost" id="printBtn">שמירה כ-PDF</button>
  </div>
</div>

<main class="sheet">
  ${statusBanner}

  <header class="sheet-head">
    <div class="brand">
      ${logo}
      <div>
        <h1>${escapeHtml(businessName)}</h1>
        <p class="muted">
          ${[business.owner_name, business.phone, business.email, business.tax_id ? `ע.מ/ח.פ ${business.tax_id}` : '']
            .filter(Boolean)
            .map((part) => escapeHtml(part))
            .join(' · ')}
        </p>
        ${business.address ? `<p class="muted">${escapeHtml(business.address)}</p>` : ''}
      </div>
    </div>
    <div class="doc-meta">
      <span class="doc-kind">הצעת מחיר</span>
      <span class="doc-number">${escapeHtml(quote.number)}</span>
      <span class="muted">תאריך: ${escapeHtml(formatDate(quote.issue_date))}</span>
      ${quote.valid_until ? `<span class="muted">בתוקף עד: ${escapeHtml(formatDate(quote.valid_until))}</span>` : ''}
    </div>
  </header>

  <section class="to-block">
    <span class="label">לכבוד</span>
    <strong>${escapeHtml(customer?.name ?? '')}</strong>
    <p class="muted">
      ${[customer?.contact_name, customer?.phone, customer?.email, customer?.address]
        .filter(Boolean)
        .map((part) => escapeHtml(part))
        .join(' · ')}
    </p>
    ${quote.title ? `<p class="doc-title">${escapeHtml(quote.title)}</p>` : ''}
  </section>

  <table class="items">
    <thead>
      <tr><th>פריט</th><th class="num">כמות</th><th class="num">מחיר ליח׳</th><th class="num">סה״כ</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <section class="totals">
    <div class="total-row"><span>סכום ביניים</span><span>${escapeHtml(formatAgorot(quote.subtotal))}</span></div>
    ${discountRow}
    <div class="total-row"><span>מע״מ ${escapeHtml(quote.vat_rate)}%</span><span>${escapeHtml(
      formatAgorot(quote.vat_amount)
    )}</span></div>
    <div class="total-row total-row--final"><span>סה״כ לתשלום</span><span>${escapeHtml(
      formatAgorot(quote.total)
    )}</span></div>
  </section>

  ${
    quote.notes
      ? `<section class="notes"><h2>הערות</h2><p>${escapeHtml(quote.notes).replace(/\n/g, '<br>')}</p></section>`
      : ''
  }
  ${
    quote.terms
      ? `<section class="notes"><h2>תנאים</h2><p>${escapeHtml(quote.terms).replace(/\n/g, '<br>')}</p></section>`
      : ''
  }

  ${signatureBlock}

  ${
    showBranding
      ? `<footer class="branding">נוצר עם <strong>סָגוּר</strong> — הצעות מחיר חתומות מהנייד</footer>`
      : '<footer class="branding branding--empty"></footer>'
  }
</main>

${decidable ? approveDialog() : ''}
${decidable ? declineDialog() : ''}

<script>${pageScript(quote.public_token)}</script>
</body>
</html>`;
}

function renderBanner(quote: QuoteRow, status: string, expired: boolean): string {
  if (quote.status === 'approved') {
    return `<div class="banner banner--ok">ההצעה אושרה ונחתמה דיגיטלית ב-${escapeHtml(
      formatDate(quote.decided_at)
    )}</div>`;
  }
  if (quote.status === 'declined') {
    return `<div class="banner banner--bad">ההצעה סומנה כנדחתה${
      quote.decline_reason ? `: ${escapeHtml(quote.decline_reason)}` : ''
    }</div>`;
  }
  if (quote.status === 'cancelled') return `<div class="banner banner--bad">ההצעה בוטלה על ידי העסק</div>`;
  if (expired) {
    return `<div class="banner banner--warn">תוקף ההצעה פג ב-${escapeHtml(
      formatDate(quote.valid_until)
    )}. אפשר לפנות לעסק לחידוש.</div>`;
  }
  if (quote.status === 'draft') {
    return `<div class="banner banner--warn">${escapeHtml(STATUS_LABELS.draft)} — ההצעה עדיין לא נשלחה רשמית</div>`;
  }
  return '';
}

function approveDialog(): string {
  return `
<div class="modal no-print" id="approveModal" role="dialog" aria-modal="true" aria-labelledby="approveTitle" hidden>
  <div class="modal-card">
    <h2 id="approveTitle">אישור ההצעה</h2>
    <p class="muted">האישור מהווה הסכמה לתנאי ההצעה. נתעד את השם, החתימה והמועד.</p>
    <label class="field"><span>שם מלא</span><input type="text" id="signerName" autocomplete="name" maxlength="120"></label>
    <div class="field">
      <span>חתימה</span>
      <canvas id="signaturePad" width="600" height="220" aria-label="אזור חתימה"></canvas>
      <button type="button" class="link-btn" id="clearSignature">ניקוי חתימה</button>
    </div>
    <p class="error" id="approveError" hidden></p>
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" data-close>ביטול</button>
      <button type="button" class="btn btn-primary" id="confirmApprove">מאשר את ההצעה</button>
    </div>
  </div>
</div>`;
}

function declineDialog(): string {
  return `
<div class="modal no-print" id="declineModal" role="dialog" aria-modal="true" aria-labelledby="declineTitle" hidden>
  <div class="modal-card">
    <h2 id="declineTitle">לא מאשר את ההצעה</h2>
    <p class="muted">אפשר להוסיף סיבה קצרה — זה עוזר לעסק להתאים הצעה טובה יותר.</p>
    <label class="field"><span>סיבה (לא חובה)</span><textarea id="declineReason" rows="3" maxlength="500"></textarea></label>
    <p class="error" id="declineError" hidden></p>
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" data-close>חזרה</button>
      <button type="button" class="btn btn-secondary" id="confirmDecline">שליחת התשובה</button>
    </div>
  </div>
</div>`;
}

function pageStyles(accent: string): string {
  return `
:root{--accent:${accent};--ink:#12161c;--muted:#6b7480;--line:#e3e7ec;--bg:#f4f6f9;--card:#fff;--ok:#0f7b3f;--bad:#b3261e;--warn:#8a5a00}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:"Rubik","Segoe UI",system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif;line-height:1.55;-webkit-text-size-adjust:100%}
.actions{position:sticky;top:0;z-index:5;background:rgba(255,255,255,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.actions-inner{max-width:820px;margin:0 auto;padding:10px 16px;display:flex;gap:8px;align-items:center}
.btn-grow{flex:1}
.btn{font:inherit;font-weight:600;border-radius:10px;padding:11px 18px;border:1px solid transparent;cursor:pointer;min-height:44px}
.btn-primary{background:var(--accent);color:#fff}
.btn-secondary{background:#fff;color:var(--ink);border-color:var(--line)}
.btn-ghost{background:transparent;color:var(--muted)}
.btn:active{transform:translateY(1px)}
.sheet{max-width:820px;margin:20px auto 40px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px;box-shadow:0 8px 30px rgba(16,24,40,.06)}
.banner{border-radius:10px;padding:12px 14px;margin-bottom:20px;font-weight:600;font-size:15px}
.banner--ok{background:#e7f6ec;color:var(--ok)}
.banner--bad{background:#fdecea;color:var(--bad)}
.banner--warn{background:#fff5e0;color:var(--warn)}
.sheet-head{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;border-bottom:2px solid var(--accent);padding-bottom:18px}
.brand{display:flex;gap:14px;align-items:flex-start}
.logo{width:60px;height:60px;object-fit:contain;border-radius:12px;flex:none}
.logo--fallback{display:flex;align-items:center;justify-content:center;background:var(--accent);color:#fff;font-weight:700;font-size:22px}
h1{font-size:22px;margin:0 0 4px}
h2{font-size:15px;margin:0 0 8px;letter-spacing:.02em}
.muted{color:var(--muted);font-size:13.5px;margin:2px 0}
.doc-meta{display:flex;flex-direction:column;gap:2px;text-align:left}
.doc-kind{font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:var(--muted)}
.doc-number{font-size:26px;font-weight:700;color:var(--accent);line-height:1.2}
.to-block{padding:18px 0;border-bottom:1px solid var(--line)}
.label{display:block;font-size:12px;color:var(--muted);margin-bottom:2px}
.doc-title{margin:10px 0 0;font-size:17px;font-weight:600}
.items{width:100%;border-collapse:collapse;margin:18px 0 0;font-size:15px}
.items th{text-align:right;font-size:12.5px;color:var(--muted);font-weight:600;padding:10px 8px;border-bottom:1px solid var(--line)}
.items td{padding:12px 8px;border-bottom:1px solid var(--line);vertical-align:top}
.items .num{text-align:left;white-space:nowrap}
.item-name{display:block;font-weight:600}
.item-details{display:block;color:var(--muted);font-size:13px;margin-top:3px;white-space:pre-line}
.strong{font-weight:700}
.totals{margin:18px 0 0;margin-inline-start:auto;max-width:340px}
.total-row{display:flex;justify-content:space-between;gap:16px;padding:7px 0;font-size:15px}
.total-row--final{border-top:2px solid var(--ink);margin-top:8px;padding-top:12px;font-size:19px;font-weight:700}
.notes{margin-top:24px;padding-top:18px;border-top:1px solid var(--line)}
.notes p{margin:0;font-size:14px;color:#333c47}
.signed-block{margin-top:24px;padding:18px;border:1px solid var(--ok);border-radius:12px;background:#f4fbf6}
.signed-grid{display:flex;gap:28px;flex-wrap:wrap}
.signature-shown{margin-top:14px}
.signature-shown img{max-width:260px;background:#fff;border:1px solid var(--line);border-radius:8px}
.branding{margin-top:28px;padding-top:16px;border-top:1px solid var(--line);text-align:center;color:var(--muted);font-size:12.5px}
.branding--empty{border:0;margin:0;padding:0}
.modal{position:fixed;inset:0;background:rgba(12,16,22,.55);display:flex;align-items:center;justify-content:center;padding:16px;z-index:20}
.modal[hidden]{display:none}
.modal-card{background:#fff;border-radius:16px;padding:22px;width:min(460px,100%);max-height:90vh;overflow:auto}
.field{display:block;margin:14px 0}
.field>span{display:block;font-size:13px;color:var(--muted);margin-bottom:6px}
input[type=text],textarea{width:100%;font:inherit;padding:11px 12px;border:1px solid var(--line);border-radius:10px;background:#fbfcfd}
input[type=text]:focus,textarea:focus{outline:2px solid var(--accent);outline-offset:1px}
#signaturePad{width:100%;height:170px;border:1px dashed #b9c1cb;border-radius:10px;background:#fbfcfd;touch-action:none}
.link-btn{background:none;border:0;color:var(--accent);font:inherit;padding:6px 0;cursor:pointer}
.modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}
.error{color:var(--bad);font-size:13.5px;margin:6px 0 0}
@media (max-width:560px){
  /* Keep the three actions on one row on a phone rather than wrapping. */
  .actions-inner{padding:8px 12px;gap:6px}
  .btn{padding:11px 12px;font-size:14.5px}
  .sheet{margin:12px;padding:18px;border-radius:14px}
  .doc-meta{text-align:right}
  .items{font-size:14px}
  .items th:nth-child(3),.items td:nth-child(3){display:none}
  .totals{max-width:none}
}
@media print{
  .no-print,.actions{display:none!important}
  body{background:#fff}
  .sheet{box-shadow:none;border:0;margin:0;max-width:none;padding:0}
  .banner{border:1px solid var(--line)}
}`;
}

function pageScript(token: string): string {
  return `
(function(){
  var token = ${JSON.stringify(token)};
  var pad = document.getElementById('signaturePad');
  var hasStrokes = false;

  var printBtn = document.getElementById('printBtn');
  if (printBtn) printBtn.addEventListener('click', function(){ window.print(); });

  function openModal(id){ var m = document.getElementById(id); if(m){ m.hidden = false; } }
  function closeModal(m){ m.hidden = true; }

  document.querySelectorAll('[data-close]').forEach(function(btn){
    btn.addEventListener('click', function(){ closeModal(btn.closest('.modal')); });
  });
  document.querySelectorAll('.modal').forEach(function(modal){
    modal.addEventListener('click', function(e){ if(e.target === modal) closeModal(modal); });
  });

  var approveBtn = document.getElementById('approveBtn');
  if (approveBtn) approveBtn.addEventListener('click', function(){ openModal('approveModal'); setupPad(); });
  var declineBtn = document.getElementById('declineBtn');
  if (declineBtn) declineBtn.addEventListener('click', function(){ openModal('declineModal'); });

  var padReady = false;
  function setupPad(){
    if (!pad || padReady) return;
    padReady = true;
    // Size the backing store to the laid-out box so strokes are not stretched.
    var ratio = window.devicePixelRatio || 1;
    var rect = pad.getBoundingClientRect();
    pad.width = Math.round(rect.width * ratio);
    pad.height = Math.round(rect.height * ratio);
    var ctx = pad.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#12161c';

    var drawing = false;
    function point(e){
      var r = pad.getBoundingClientRect();
      var src = e.touches && e.touches[0] ? e.touches[0] : e;
      return { x: src.clientX - r.left, y: src.clientY - r.top };
    }
    function start(e){ e.preventDefault(); drawing = true; hasStrokes = true; var p = point(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }
    function move(e){ if(!drawing) return; e.preventDefault(); var p = point(e); ctx.lineTo(p.x, p.y); ctx.stroke(); }
    function end(){ drawing = false; }

    pad.addEventListener('pointerdown', start);
    pad.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    pad.addEventListener('touchstart', start, {passive:false});
    pad.addEventListener('touchmove', move, {passive:false});
    pad.addEventListener('touchend', end);

    var clear = document.getElementById('clearSignature');
    if (clear) clear.addEventListener('click', function(){
      ctx.clearRect(0, 0, pad.width, pad.height);
      hasStrokes = false;
    });
  }

  function showError(id, message){
    var el = document.getElementById(id);
    el.textContent = message;
    el.hidden = !message;
  }

  async function send(path, payload, errorId, button){
    button.disabled = true;
    try {
      var res = await fetch('/api/public/q/' + token + '/' + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var data = await res.json().catch(function(){ return {}; });
      if (!res.ok) { showError(errorId, data.error || 'משהו השתבש, נסו שוב'); button.disabled = false; return; }
      window.location.reload();
    } catch (err) {
      showError(errorId, 'אין חיבור לרשת כרגע');
      button.disabled = false;
    }
  }

  var confirmApprove = document.getElementById('confirmApprove');
  if (confirmApprove) confirmApprove.addEventListener('click', function(){
    var name = (document.getElementById('signerName').value || '').trim();
    if (name.length < 2) { showError('approveError', 'נא למלא שם מלא'); return; }
    if (!hasStrokes) { showError('approveError', 'נא לחתום במסגרת'); return; }
    showError('approveError', '');
    send('approve', { signer_name: name, signature_image: pad.toDataURL('image/png') }, 'approveError', confirmApprove);
  });

  var confirmDecline = document.getElementById('confirmDecline');
  if (confirmDecline) confirmDecline.addEventListener('click', function(){
    var reason = (document.getElementById('declineReason').value || '').trim();
    send('decline', { reason: reason }, 'declineError', confirmDecline);
  });
})();`;
}
