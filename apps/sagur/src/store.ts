import { computeTotals, lineTotal } from './money.ts';
import { formatQuoteNumber } from './domain.ts';
import type { Bindings, BusinessRow, QuoteEventRow, QuoteItemRow, QuoteRow } from './types.ts';

export const DEFAULT_TERMS = [
  'המחירים אינם כוללים עבודות שלא פורטו בהצעה זו.',
  'תנאי תשלום: שוטף + 0 אלא אם סוכם אחרת.',
  'ההצעה כפופה לבדיקה סופית בשטח.',
].join('\n');

/** Every user has exactly one business row; it is created lazily on first read. */
export async function getBusiness(env: Bindings, userId: number): Promise<BusinessRow> {
  const existing = await env.DB.prepare('SELECT * FROM businesses WHERE user_id = ?')
    .bind(userId)
    .first<BusinessRow>();
  if (existing) return existing;

  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO businesses (user_id, default_terms, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO NOTHING`
  )
    .bind(userId, DEFAULT_TERMS, now)
    .run();
  const created = await env.DB.prepare('SELECT * FROM businesses WHERE user_id = ?')
    .bind(userId)
    .first<BusinessRow>();
  if (!created) throw new Error('failed to create business profile');
  return created;
}

/**
 * Reserves the next quote number. The counter is bumped with a single UPDATE so
 * two quotes created at the same moment can't take the same number.
 */
export async function reserveQuoteNumber(env: Bindings, userId: number): Promise<string> {
  const business = await getBusiness(env, userId);
  const row = await env.DB.prepare(
    'UPDATE businesses SET next_quote_number = next_quote_number + 1 WHERE user_id = ? RETURNING next_quote_number'
  )
    .bind(userId)
    .first<{ next_quote_number: number }>();
  const reserved = (row?.next_quote_number ?? business.next_quote_number + 1) - 1;
  return formatQuoteNumber(business.quote_prefix, reserved);
}

export async function logEvent(env: Bindings, quoteId: number, type: string, detail = ''): Promise<void> {
  await env.DB.prepare('INSERT INTO quote_events (quote_id, type, detail, created_at) VALUES (?, ?, ?, ?)')
    .bind(quoteId, type, detail, new Date().toISOString())
    .run();
}

export async function getQuoteItems(env: Bindings, quoteId: number): Promise<QuoteItemRow[]> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM quote_items WHERE quote_id = ? ORDER BY sort_order, id'
  )
    .bind(quoteId)
    .all<QuoteItemRow>();
  return results ?? [];
}

export async function getQuoteEvents(env: Bindings, quoteId: number): Promise<QuoteEventRow[]> {
  const { results } = await env.DB.prepare('SELECT * FROM quote_events WHERE quote_id = ? ORDER BY id')
    .bind(quoteId)
    .all<QuoteEventRow>();
  return results ?? [];
}

/** Recomputes stored totals from the current line items. */
export async function recalcQuote(env: Bindings, quote: QuoteRow): Promise<QuoteRow> {
  const items = await getQuoteItems(env, quote.id);
  const totals = computeTotals(items, {
    discount_type: quote.discount_type,
    discount_value: quote.discount_value,
    vat_rate: quote.vat_rate,
  });
  await env.DB.prepare(
    `UPDATE quotes SET subtotal = ?, discount_amount = ?, vat_amount = ?, total = ?, updated_at = ? WHERE id = ?`
  )
    .bind(totals.subtotal, totals.discount_amount, totals.vat_amount, totals.total, new Date().toISOString(), quote.id)
    .run();
  return { ...quote, ...totals };
}

export async function replaceQuoteItems(
  env: Bindings,
  quoteId: number,
  items: { name: string; details?: string; unit?: string; quantity: number; unit_price: number }[]
): Promise<void> {
  const statements: D1PreparedStatement[] = [
    env.DB.prepare('DELETE FROM quote_items WHERE quote_id = ?').bind(quoteId),
  ];
  items.forEach((item, index) => {
    statements.push(
      env.DB.prepare(
        `INSERT INTO quote_items (quote_id, name, details, unit, quantity, unit_price, line_total, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        quoteId,
        item.name,
        item.details ?? '',
        item.unit ?? 'יח׳',
        item.quantity,
        item.unit_price,
        lineTotal(item),
        index
      )
    );
  });
  await env.DB.batch(statements);
}

export async function findQuote(env: Bindings, userId: number, quoteId: number): Promise<QuoteRow | null> {
  return env.DB.prepare('SELECT * FROM quotes WHERE id = ? AND user_id = ?')
    .bind(quoteId, userId)
    .first<QuoteRow>();
}

export async function findQuoteByToken(env: Bindings, token: string): Promise<QuoteRow | null> {
  return env.DB.prepare('SELECT * FROM quotes WHERE public_token = ?').bind(token).first<QuoteRow>();
}

export async function countQuotesInMonth(env: Bindings, userId: number, monthPrefix: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM quotes WHERE user_id = ? AND substr(created_at, 1, 7) = ?"
  )
    .bind(userId, monthPrefix)
    .first<{ n: number }>();
  return row?.n ?? 0;
}
