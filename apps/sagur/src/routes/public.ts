import { Hono } from 'hono';
import { userFromRequest } from '../auth.ts';
import { isExpired } from '../domain.ts';
import { entitlements } from '../plan.ts';
import { renderQuotePage, escapeHtml } from '../public-page.ts';
import { findQuoteByToken, getBusiness, getQuoteItems, logEvent } from '../store.ts';
import { dataImageUrl, jsonBody, str } from '../validate.ts';
import type { AppEnv, Bindings, CustomerRow, QuoteRow } from '../types.ts';

const MAX_SIGNATURE_CHARS = 300_000;

async function loadOwnerUser(env: Bindings, userId: number) {
  return env.DB.prepare('SELECT id, email, plan, plan_until, trial_ends_at FROM users WHERE id = ?')
    .bind(userId)
    .first<{ id: number; email: string; plan: string; plan_until: string | null; trial_ends_at: string | null }>();
}

/** Only a live, undecided quote can be answered by the customer. */
function decidable(quote: QuoteRow): boolean {
  return (quote.status === 'sent' || quote.status === 'viewed') && !isExpired(quote.valid_until);
}

// ---------- Customer-facing page: GET /q/:token ----------

export const publicPage = new Hono<AppEnv>();

publicPage.get('/:token', async (c) => {
  const token = c.req.param('token');
  const quote = await findQuoteByToken(c.env, token);
  if (!quote) return c.html(notFoundPage(), 404);

  const [items, business, customer, viewer] = await Promise.all([
    getQuoteItems(c.env, quote.id),
    getBusiness(c.env, quote.user_id),
    quote.customer_id
      ? c.env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(quote.customer_id).first<CustomerRow>()
      : Promise.resolve(null),
    userFromRequest(c),
  ]);

  // The owner previewing their own link must not register as a customer view.
  const isOwner = viewer?.id === quote.user_id;
  if (!isOwner) {
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      `UPDATE quotes SET view_count = view_count + 1, first_viewed_at = COALESCE(first_viewed_at, ?),
         last_viewed_at = ?, status = CASE WHEN status = 'sent' THEN 'viewed' ELSE status END
       WHERE id = ?`
    )
      .bind(now, now, quote.id)
      .run();
    if (quote.status === 'sent') {
      quote.status = 'viewed';
      await logEvent(c.env, quote.id, 'viewed', 'הלקוח פתח את ההצעה');
    }
  }

  const owner = await loadOwnerUser(c.env, quote.user_id);
  const showBranding = owner ? !entitlements(owner).can_remove_branding : true;

  return c.html(renderQuotePage({ quote, items, business, customer: customer ?? null, showBranding }), 200, {
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
  });
});

// ---------- Customer actions: /api/public/q/:token/... ----------

export const publicApi = new Hono<AppEnv>();

publicApi.post('/q/:token/approve', async (c) => {
  const quote = await findQuoteByToken(c.env, c.req.param('token'));
  if (!quote) return c.json({ error: 'ההצעה לא נמצאה' }, 404);
  if (quote.status === 'approved') return c.json({ ok: true, already: true });
  if (!decidable(quote)) return c.json({ error: 'לא ניתן לאשר את ההצעה במצבה הנוכחי' }, 409);

  const body = await jsonBody(c);
  const signerName = str(body.signer_name, 120);
  if (signerName.length < 2) return c.json({ error: 'נא למלא שם מלא' }, 400);
  const signature = dataImageUrl(body.signature_image, MAX_SIGNATURE_CHARS);
  if (!signature) return c.json({ error: 'נא לחתום במסגרת' }, 400);

  const now = new Date().toISOString();
  const ip = c.req.header('CF-Connecting-IP') ?? '';
  const agent = (c.req.header('User-Agent') ?? '').slice(0, 300);

  await c.env.DB.prepare(
    `UPDATE quotes SET status = 'approved', decided_at = ?, signer_name = ?, signature_image = ?,
       signer_ip = ?, signer_agent = ?, decline_reason = NULL, updated_at = ?
     WHERE id = ? AND status IN ('sent','viewed')`
  )
    .bind(now, signerName, signature, ip, agent, now, quote.id)
    .run();
  await logEvent(c.env, quote.id, 'approved', `נחתם על ידי ${signerName}`);

  return c.json({ ok: true });
});

publicApi.post('/q/:token/decline', async (c) => {
  const quote = await findQuoteByToken(c.env, c.req.param('token'));
  if (!quote) return c.json({ error: 'ההצעה לא נמצאה' }, 404);
  if (quote.status === 'declined') return c.json({ ok: true, already: true });
  if (!decidable(quote)) return c.json({ error: 'לא ניתן לעדכן את ההצעה במצבה הנוכחי' }, 409);

  const body = await jsonBody(c);
  const reason = str(body.reason, 500);
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `UPDATE quotes SET status = 'declined', decided_at = ?, decline_reason = ?, updated_at = ?
      WHERE id = ? AND status IN ('sent','viewed')`
  )
    .bind(now, reason, now, quote.id)
    .run();
  await logEvent(c.env, quote.id, 'declined', reason ? `סיבה: ${reason}` : 'ללא סיבה');

  return c.json({ ok: true });
});

function notFoundPage(): string {
  return `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ההצעה לא נמצאה</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f6f9;color:#12161c;
font-family:"Rubik","Segoe UI",system-ui,sans-serif;text-align:center;padding:24px}
.card{background:#fff;border-radius:16px;padding:32px;max-width:420px;box-shadow:0 8px 30px rgba(16,24,40,.08)}
h1{font-size:20px;margin:0 0 8px}p{color:#6b7480;margin:0}</style></head>
<body><div class="card"><h1>${escapeHtml('ההצעה לא נמצאה')}</h1>
<p>ייתכן שהקישור שגוי או שההצעה הוסרה. כדאי לבקש מהעסק קישור מעודכן.</p></div></body></html>`;
}
