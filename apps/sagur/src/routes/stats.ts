import { Hono } from 'hono';
import { requireAuth } from '../auth.ts';
import { effectiveStatus, monthKey, needsFollowUp, winRate } from '../domain.ts';
import type { AppEnv, QuoteRow } from '../types.ts';

const stats = new Hono<AppEnv>();
stats.use('*', requireAuth);

function monthsBack(count: number, now: Date): string[] {
  const months: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push(monthKey(d));
  }
  return months;
}

stats.get('/', async (c) => {
  const user = c.get('user');
  const now = new Date();
  const since = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), 1)).toISOString();

  // A year of history per user is small enough to aggregate in the Worker, which
  // keeps the derived 'expired' state consistent with the rest of the app.
  const { results } = await c.env.DB.prepare(
    `SELECT q.*, c.name AS customer_name
       FROM quotes q LEFT JOIN customers c ON c.id = q.customer_id
      WHERE q.user_id = ? AND q.created_at >= ?
      ORDER BY q.created_at DESC`
  )
    .bind(user.id, since)
    .all<QuoteRow & { customer_name: string | null }>();
  const quotes = results ?? [];

  const thisMonth = monthKey(now);
  const openQuotes = quotes.filter((q) => effectiveStatus(q, now) === 'sent' || effectiveStatus(q, now) === 'viewed');
  const approved = quotes.filter((q) => q.status === 'approved');

  const ninetyDaysAgo = now.getTime() - 90 * 24 * 3600 * 1000;
  const recentlyDecided = quotes.filter((q) => q.decided_at && Date.parse(q.decided_at) >= ninetyDaysAgo);

  const followUps = quotes
    .filter((q) => needsFollowUp(q, now))
    .sort((a, b) => Date.parse(a.sent_at ?? '') - Date.parse(b.sent_at ?? ''))
    .slice(0, 20)
    .map((q) => ({
      id: q.id,
      number: q.number,
      title: q.title,
      customer_name: q.customer_name,
      total: q.total,
      sent_at: q.sent_at,
      view_count: q.view_count,
    }));

  const months = monthsBack(6, now).map((key) => ({
    month: key,
    won_total: approved
      .filter((q) => monthKey(q.decided_at ?? q.updated_at) === key)
      .reduce((sum, q) => sum + q.total, 0),
    sent_count: quotes.filter((q) => q.sent_at && monthKey(q.sent_at) === key).length,
  }));

  const byCustomer = new Map<string, { name: string; won_total: number; quotes: number }>();
  for (const q of quotes) {
    const name = q.customer_name ?? 'ללא לקוח';
    const entry = byCustomer.get(name) ?? { name, won_total: 0, quotes: 0 };
    entry.quotes += 1;
    if (q.status === 'approved') entry.won_total += q.total;
    byCustomer.set(name, entry);
  }

  const wonThisMonth = approved.filter((q) => monthKey(q.decided_at ?? q.updated_at) === thisMonth);

  return c.json({
    open: { count: openQuotes.length, value: openQuotes.reduce((sum, q) => sum + q.total, 0) },
    won_this_month: { count: wonThisMonth.length, value: wonThisMonth.reduce((sum, q) => sum + q.total, 0) },
    win_rate_90d: winRate(recentlyDecided),
    average_quote: quotes.length === 0 ? 0 : Math.round(quotes.reduce((sum, q) => sum + q.total, 0) / quotes.length),
    drafts: quotes.filter((q) => q.status === 'draft').length,
    expired: quotes.filter((q) => effectiveStatus(q, now) === 'expired').length,
    follow_ups: followUps,
    months,
    top_customers: [...byCustomer.values()].sort((a, b) => b.won_total - a.won_total).slice(0, 5),
  });
});

export default stats;
