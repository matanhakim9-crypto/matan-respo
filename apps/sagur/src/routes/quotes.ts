import { Hono } from 'hono';
import { requireAuth, randomToken } from '../auth.ts';
import {
  addDays,
  canTransition,
  effectiveStatus,
  isEditable,
  monthKey,
  needsFollowUp,
  toIsoDate,
  type QuoteStatus,
} from '../domain.ts';
import { shekelsToAgorot } from '../money.ts';
import { entitlements, quotaExceeded } from '../plan.ts';
import {
  countQuotesInMonth,
  findQuote,
  getBusiness,
  getQuoteEvents,
  getQuoteItems,
  logEvent,
  recalcQuote,
  replaceQuoteItems,
  reserveQuoteNumber,
} from '../store.ts';
import { shareUrl } from '../url.ts';
import { clampNum, int, isoDate, jsonBody, num, optionalIsoDate, str } from '../validate.ts';
import type { AppEnv, QuoteRow } from '../types.ts';

const MAX_ITEMS = 200;

const quotes = new Hono<AppEnv>();
quotes.use('*', requireAuth);

type ParsedItem = {
  name: string;
  details: string;
  unit: string;
  quantity: number;
  unit_price: number;
  catalog_item_id: number | null;
};

function parseItems(raw: unknown): ParsedItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_ITEMS)
    .map((entry): ParsedItem => {
      const item = (entry ?? {}) as Record<string, unknown>;
      const price =
        typeof item.unit_price === 'number'
          ? Math.round(item.unit_price)
          : shekelsToAgorot(str(item.unit_price_text, 30));
      return {
        name: str(item.name, 160),
        details: str(item.details, 1000),
        unit: str(item.unit, 20) || 'יח׳',
        quantity: clampNum(num(item.quantity, 1), -100000, 100000),
        unit_price: price,
        catalog_item_id: item.catalog_item_id == null ? null : int(item.catalog_item_id, 0) || null,
      };
    })
    .filter((item) => item.name !== '');
}

async function validCustomerId(env: AppEnv['Bindings'], userId: number, raw: unknown): Promise<number | null> {
  const id = raw == null ? 0 : int(raw, 0);
  if (!id) return null;
  const row = await env.DB.prepare('SELECT id FROM customers WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first<{ id: number }>();
  return row?.id ?? null;
}

/** Each catalog pick nudges the item up the price list for next time. */
async function bumpCatalogUsage(env: AppEnv['Bindings'], userId: number, items: ParsedItem[]): Promise<void> {
  const ids = [...new Set(items.map((i) => i.catalog_item_id).filter((id): id is number => id != null))];
  if (ids.length === 0) return;
  await env.DB.batch(
    ids.map((id) =>
      env.DB.prepare('UPDATE catalog_items SET use_count = use_count + 1 WHERE id = ? AND user_id = ?').bind(id, userId)
    )
  );
}

function decorate(quote: QuoteRow, now = new Date()) {
  return {
    ...quote,
    effective_status: effectiveStatus(quote, now),
    needs_follow_up: needsFollowUp(quote, now),
  };
}

quotes.get('/', async (c) => {
  const user = c.get('user');
  const status = str(c.req.query('status'), 20);
  const search = str(c.req.query('q'), 80);
  const customerId = int(c.req.query('customer_id'), 0);

  const where: string[] = ['q.user_id = ?'];
  const binds: unknown[] = [user.id];
  if (status && status !== 'all' && status !== 'expired' && status !== 'open') {
    where.push('q.status = ?');
    binds.push(status);
  }
  if (status === 'open') where.push("q.status IN ('sent','viewed')");
  if (customerId) {
    where.push('q.customer_id = ?');
    binds.push(customerId);
  }
  if (search) {
    where.push('(q.number LIKE ? OR q.title LIKE ? OR c.name LIKE ?)');
    binds.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT q.*, c.name AS customer_name
       FROM quotes q LEFT JOIN customers c ON c.id = q.customer_id
      WHERE ${where.join(' AND ')}
      ORDER BY q.created_at DESC
      LIMIT 300`
  )
    .bind(...binds)
    .all<QuoteRow & { customer_name: string | null }>();

  const now = new Date();
  let rows = (results ?? []).map((row) => decorate(row, now));
  // 'expired' only exists as a derived state, so it is filtered after decoration.
  if (status === 'expired') rows = rows.filter((row) => row.effective_status === 'expired');
  if (status === 'open') rows = rows.filter((row) => row.effective_status !== 'expired');
  return c.json(rows);
});

quotes.post('/', async (c) => {
  const user = c.get('user');
  const ent = entitlements(user);
  const used = await countQuotesInMonth(c.env, user.id, monthKey(new Date()));
  if (quotaExceeded(ent, used)) {
    return c.json(
      {
        error: `במסלול החינמי אפשר ליצור ${ent.monthly_quote_limit} הצעות בחודש. שדרגו ל-Pro להצעות ללא הגבלה.`,
        code: 'quota_exceeded',
      },
      402
    );
  }

  const body = await jsonBody(c);
  const business = await getBusiness(c.env, user.id);
  const now = new Date();
  const issueDate = isoDate(body.issue_date, toIsoDate(now));
  const items = parseItems(body.items);

  const number = await reserveQuoteNumber(c.env, user.id);
  const result = await c.env.DB.prepare(
    `INSERT INTO quotes (user_id, customer_id, number, title, status, issue_date, valid_until, notes, terms,
                         discount_type, discount_value, vat_rate, public_token, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, 'none', 0, ?, ?, ?, ?)`
  )
    .bind(
      user.id,
      await validCustomerId(c.env, user.id, body.customer_id),
      number,
      str(body.title, 160),
      issueDate,
      optionalIsoDate(body.valid_until) ?? addDays(issueDate, business.validity_days),
      str(body.notes, 4000),
      str(body.terms, 4000, business.default_terms),
      clampNum(num(body.vat_rate, business.vat_rate), 0, 100),
      randomToken(),
      now.toISOString(),
      now.toISOString()
    )
    .run();

  const quoteId = result.meta.last_row_id as number;
  if (items.length > 0) {
    await replaceQuoteItems(c.env, quoteId, items);
    await bumpCatalogUsage(c.env, user.id, items);
  }
  const created = (await findQuote(c.env, user.id, quoteId))!;
  const withTotals = await recalcQuote(c.env, created);
  await logEvent(c.env, quoteId, 'created');
  return c.json(decorate(withTotals), 201);
});

quotes.get('/:id', async (c) => {
  const user = c.get('user');
  const quote = await findQuote(c.env, user.id, Number(c.req.param('id')));
  if (!quote) return c.json({ error: 'ההצעה לא נמצאה' }, 404);

  const [items, events, customer] = await Promise.all([
    getQuoteItems(c.env, quote.id),
    getQuoteEvents(c.env, quote.id),
    quote.customer_id
      ? c.env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(quote.customer_id).first()
      : Promise.resolve(null),
  ]);

  return c.json({
    quote: decorate(quote),
    items,
    events,
    customer,
    share_url: shareUrl(c, quote.public_token),
    editable: isEditable(quote.status),
  });
});

quotes.put('/:id', async (c) => {
  const user = c.get('user');
  const quote = await findQuote(c.env, user.id, Number(c.req.param('id')));
  if (!quote) return c.json({ error: 'ההצעה לא נמצאה' }, 404);
  if (!isEditable(quote.status)) {
    return c.json({ error: 'אי אפשר לערוך הצעה שכבר נשלחה. פתחו אותה מחדש כטיוטה כדי לשנות.', code: 'locked' }, 409);
  }

  const body = await jsonBody(c);
  const issueDate = isoDate(body.issue_date, quote.issue_date);
  const discountType = ['none', 'percent', 'amount'].includes(String(body.discount_type))
    ? (body.discount_type as 'none' | 'percent' | 'amount')
    : quote.discount_type;
  const rawDiscount = num(body.discount_value, quote.discount_value);
  const discountValue =
    discountType === 'percent' ? clampNum(rawDiscount, 0, 100) : Math.max(0, Math.round(rawDiscount));

  await c.env.DB.prepare(
    `UPDATE quotes SET customer_id = ?, title = ?, issue_date = ?, valid_until = ?, notes = ?, terms = ?,
       discount_type = ?, discount_value = ?, vat_rate = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`
  )
    .bind(
      'customer_id' in body ? await validCustomerId(c.env, user.id, body.customer_id) : quote.customer_id,
      str(body.title, 160, quote.title),
      issueDate,
      'valid_until' in body ? optionalIsoDate(body.valid_until) : quote.valid_until,
      str(body.notes, 4000, quote.notes),
      str(body.terms, 4000, quote.terms),
      discountType,
      discountValue,
      clampNum(num(body.vat_rate, quote.vat_rate), 0, 100),
      new Date().toISOString(),
      quote.id,
      user.id
    )
    .run();

  if ('items' in body) {
    const items = parseItems(body.items);
    await replaceQuoteItems(c.env, quote.id, items);
    await bumpCatalogUsage(c.env, user.id, items);
  }

  const updated = (await findQuote(c.env, user.id, quote.id))!;
  return c.json(decorate(await recalcQuote(c.env, updated)));
});

quotes.post('/:id/send', async (c) => {
  const user = c.get('user');
  const quote = await findQuote(c.env, user.id, Number(c.req.param('id')));
  if (!quote) return c.json({ error: 'ההצעה לא נמצאה' }, 404);

  const items = await getQuoteItems(c.env, quote.id);
  if (items.length === 0) return c.json({ error: 'אי אפשר לשלוח הצעה בלי פריטים' }, 400);
  if (!quote.customer_id) return c.json({ error: 'בחרו לקוח לפני השליחה' }, 400);
  if (!canTransition(quote.status, 'sent') && quote.status !== 'sent') {
    return c.json({ error: 'לא ניתן לשלוח הצעה במצב הנוכחי' }, 409);
  }

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    "UPDATE quotes SET status = 'sent', sent_at = COALESCE(sent_at, ?), updated_at = ? WHERE id = ? AND user_id = ?"
  )
    .bind(now, now, quote.id, user.id)
    .run();
  await logEvent(c.env, quote.id, 'sent');

  const updated = (await findQuote(c.env, user.id, quote.id))!;
  return c.json({ quote: decorate(updated), share_url: shareUrl(c, quote.public_token) });
});

/** Manual status changes: marking a phone approval, cancelling, or reopening. */
quotes.post('/:id/status', async (c) => {
  const user = c.get('user');
  const quote = await findQuote(c.env, user.id, Number(c.req.param('id')));
  if (!quote) return c.json({ error: 'ההצעה לא נמצאה' }, 404);

  const body = await jsonBody(c);
  const target = String(body.status ?? '') as QuoteStatus;
  if (!canTransition(quote.status, target)) {
    return c.json({ error: 'המעבר הזה לא אפשרי' }, 409);
  }

  const now = new Date().toISOString();
  if (target === 'draft') {
    // Reopening invalidates the signed document, so the signature goes with it.
    await c.env.DB.prepare(
      `UPDATE quotes SET status = 'draft', decided_at = NULL, decline_reason = NULL, signer_name = NULL,
         signature_image = NULL, signer_ip = NULL, signer_agent = NULL, updated_at = ?
       WHERE id = ? AND user_id = ?`
    )
      .bind(now, quote.id, user.id)
      .run();
    await logEvent(c.env, quote.id, 'reopened');
  } else if (target === 'approved' || target === 'declined') {
    await c.env.DB.prepare(
      'UPDATE quotes SET status = ?, decided_at = ?, decline_reason = ?, updated_at = ? WHERE id = ? AND user_id = ?'
    )
      .bind(target, now, target === 'declined' ? str(body.reason, 500) : null, now, quote.id, user.id)
      .run();
    await logEvent(c.env, quote.id, target, 'סומן ידנית על ידי בעל העסק');
  } else {
    await c.env.DB.prepare('UPDATE quotes SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .bind(target, now, quote.id, user.id)
      .run();
    await logEvent(c.env, quote.id, target);
  }

  const updated = (await findQuote(c.env, user.id, quote.id))!;
  return c.json(decorate(updated));
});

quotes.post('/:id/duplicate', async (c) => {
  const user = c.get('user');
  const ent = entitlements(user);
  const used = await countQuotesInMonth(c.env, user.id, monthKey(new Date()));
  if (quotaExceeded(ent, used)) {
    return c.json({ error: 'הגעתם למכסת ההצעות החודשית של המסלול החינמי.', code: 'quota_exceeded' }, 402);
  }

  const source = await findQuote(c.env, user.id, Number(c.req.param('id')));
  if (!source) return c.json({ error: 'ההצעה לא נמצאה' }, 404);

  const business = await getBusiness(c.env, user.id);
  const now = new Date();
  const issueDate = toIsoDate(now);
  const number = await reserveQuoteNumber(c.env, user.id);
  const result = await c.env.DB.prepare(
    `INSERT INTO quotes (user_id, customer_id, number, title, status, issue_date, valid_until, notes, terms,
                         discount_type, discount_value, vat_rate, public_token, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      user.id,
      source.customer_id,
      number,
      source.title,
      issueDate,
      addDays(issueDate, business.validity_days),
      source.notes,
      source.terms,
      source.discount_type,
      source.discount_value,
      source.vat_rate,
      randomToken(),
      now.toISOString(),
      now.toISOString()
    )
    .run();

  const newId = result.meta.last_row_id as number;
  const items = await getQuoteItems(c.env, source.id);
  if (items.length > 0) await replaceQuoteItems(c.env, newId, items);
  const created = (await findQuote(c.env, user.id, newId))!;
  await logEvent(c.env, newId, 'created', `שוכפלה מהצעה ${source.number}`);
  return c.json(decorate(await recalcQuote(c.env, created)), 201);
});

quotes.delete('/:id', async (c) => {
  const user = c.get('user');
  const quote = await findQuote(c.env, user.id, Number(c.req.param('id')));
  if (!quote) return c.json({ error: 'ההצעה לא נמצאה' }, 404);
  if (quote.status === 'approved') {
    return c.json({ error: 'הצעה חתומה נשמרת לתיעוד. אפשר לבטל אותה במקום למחוק.' }, 409);
  }
  await c.env.DB.prepare('DELETE FROM quotes WHERE id = ? AND user_id = ?').bind(quote.id, user.id).run();
  return c.json({ ok: true });
});

export default quotes;
