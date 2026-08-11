import { Hono } from 'hono';
import { requireAuth } from '../auth.ts';
import { jsonBody, str } from '../validate.ts';
import type { AppEnv, CustomerRow } from '../types.ts';

const customers = new Hono<AppEnv>();
customers.use('*', requireAuth);

customers.get('/', async (c) => {
  const user = c.get('user');
  const includeArchived = c.req.query('archived') === '1';
  // The list carries each customer's quote history so the UI needs one request.
  const { results } = await c.env.DB.prepare(
    `SELECT c.*,
            (SELECT COUNT(*) FROM quotes q WHERE q.customer_id = c.id) AS quote_count,
            (SELECT COALESCE(SUM(q.total), 0) FROM quotes q WHERE q.customer_id = c.id AND q.status = 'approved') AS won_total,
            (SELECT MAX(q.created_at) FROM quotes q WHERE q.customer_id = c.id) AS last_quote_at
       FROM customers c
      WHERE c.user_id = ? AND (c.archived = 0 OR ?)
      ORDER BY c.name COLLATE NOCASE`
  )
    .bind(user.id, includeArchived ? 1 : 0)
    .all<CustomerRow & { quote_count: number; won_total: number; last_quote_at: string | null }>();
  return c.json(results ?? []);
});

customers.post('/', async (c) => {
  const user = c.get('user');
  const body = await jsonBody(c);
  const name = str(body.name, 120);
  if (!name) return c.json({ error: 'שם הלקוח נדרש' }, 400);

  const result = await c.env.DB.prepare(
    `INSERT INTO customers (user_id, name, contact_name, phone, email, address, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      user.id,
      name,
      str(body.contact_name, 120),
      str(body.phone, 40),
      str(body.email, 160),
      str(body.address, 240),
      str(body.notes, 2000),
      new Date().toISOString()
    )
    .run();

  const created = await c.env.DB.prepare('SELECT * FROM customers WHERE id = ?')
    .bind(result.meta.last_row_id)
    .first<CustomerRow>();
  return c.json(created, 201);
});

customers.put('/:id', async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const current = await c.env.DB.prepare('SELECT * FROM customers WHERE id = ? AND user_id = ?')
    .bind(id, user.id)
    .first<CustomerRow>();
  if (!current) return c.json({ error: 'הלקוח לא נמצא' }, 404);

  const body = await jsonBody(c);
  await c.env.DB.prepare(
    `UPDATE customers SET name = ?, contact_name = ?, phone = ?, email = ?, address = ?, notes = ?, archived = ?
      WHERE id = ? AND user_id = ?`
  )
    .bind(
      str(body.name, 120, current.name) || current.name,
      str(body.contact_name, 120, current.contact_name),
      str(body.phone, 40, current.phone),
      str(body.email, 160, current.email),
      str(body.address, 240, current.address),
      str(body.notes, 2000, current.notes),
      'archived' in body ? (body.archived ? 1 : 0) : current.archived,
      id,
      user.id
    )
    .run();

  const updated = await c.env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(id).first<CustomerRow>();
  return c.json(updated);
});

customers.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const used = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM quotes WHERE customer_id = ? AND user_id = ?')
    .bind(id, user.id)
    .first<{ n: number }>();

  // Deleting a customer with history would blank the customer name on past
  // quotes, so those are archived instead.
  if ((used?.n ?? 0) > 0) {
    await c.env.DB.prepare('UPDATE customers SET archived = 1 WHERE id = ? AND user_id = ?').bind(id, user.id).run();
    return c.json({ ok: true, archived: true });
  }
  await c.env.DB.prepare('DELETE FROM customers WHERE id = ? AND user_id = ?').bind(id, user.id).run();
  return c.json({ ok: true, archived: false });
});

export default customers;
