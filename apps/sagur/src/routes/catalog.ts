import { Hono } from 'hono';
import { requireAuth } from '../auth.ts';
import { shekelsToAgorot } from '../money.ts';
import { int, jsonBody, str } from '../validate.ts';
import type { AppEnv, CatalogItemRow } from '../types.ts';

const catalog = new Hono<AppEnv>();
catalog.use('*', requireAuth);

/** Accepts either agorot (`unit_price`) or free-typed shekels (`unit_price_text`). */
function priceFromBody(body: Record<string, unknown>, fallback: number): number {
  if (typeof body.unit_price === 'number') return Math.max(0, Math.round(body.unit_price));
  if (typeof body.unit_price_text === 'string') return Math.max(0, shekelsToAgorot(body.unit_price_text));
  return fallback;
}

catalog.get('/', async (c) => {
  const user = c.get('user');
  // Most-used first: the price list sorts itself by what the trade actually sells.
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM catalog_items WHERE user_id = ? AND archived = 0
      ORDER BY use_count DESC, name COLLATE NOCASE`
  )
    .bind(user.id)
    .all<CatalogItemRow>();
  return c.json(results ?? []);
});

catalog.post('/', async (c) => {
  const user = c.get('user');
  const body = await jsonBody(c);
  const name = str(body.name, 160);
  if (!name) return c.json({ error: 'שם הפריט נדרש' }, 400);

  const result = await c.env.DB.prepare(
    `INSERT INTO catalog_items (user_id, name, details, unit, unit_price, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      user.id,
      name,
      str(body.details, 1000),
      str(body.unit, 20) || 'יח׳',
      priceFromBody(body, 0),
      new Date().toISOString()
    )
    .run();

  const created = await c.env.DB.prepare('SELECT * FROM catalog_items WHERE id = ?')
    .bind(result.meta.last_row_id)
    .first<CatalogItemRow>();
  return c.json(created, 201);
});

catalog.put('/:id', async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const current = await c.env.DB.prepare('SELECT * FROM catalog_items WHERE id = ? AND user_id = ?')
    .bind(id, user.id)
    .first<CatalogItemRow>();
  if (!current) return c.json({ error: 'הפריט לא נמצא' }, 404);

  const body = await jsonBody(c);
  await c.env.DB.prepare(
    'UPDATE catalog_items SET name = ?, details = ?, unit = ?, unit_price = ?, archived = ? WHERE id = ? AND user_id = ?'
  )
    .bind(
      str(body.name, 160, current.name) || current.name,
      str(body.details, 1000, current.details),
      str(body.unit, 20, current.unit) || current.unit,
      priceFromBody(body, current.unit_price),
      'archived' in body ? int(body.archived, 0) : current.archived,
      id,
      user.id
    )
    .run();

  const updated = await c.env.DB.prepare('SELECT * FROM catalog_items WHERE id = ?').bind(id).first<CatalogItemRow>();
  return c.json(updated);
});

catalog.delete('/:id', async (c) => {
  const user = c.get('user');
  await c.env.DB.prepare('DELETE FROM catalog_items WHERE id = ? AND user_id = ?')
    .bind(Number(c.req.param('id')), user.id)
    .run();
  return c.json({ ok: true });
});

export default catalog;
