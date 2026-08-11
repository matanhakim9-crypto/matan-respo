import { Hono } from 'hono';
import {
  clearSession,
  createSession,
  hashPassword,
  isValidEmail,
  normaliseEmail,
  requireAuth,
  setSessionCookie,
  userFromRequest,
  verifyPassword,
} from '../auth.ts';
import { entitlements, TRIAL_DAYS } from '../plan.ts';
import { monthKey } from '../domain.ts';
import { countQuotesInMonth, DEFAULT_TERMS, getBusiness } from '../store.ts';
import { jsonBody, str } from '../validate.ts';
import type { AppEnv } from '../types.ts';

const auth = new Hono<AppEnv>();

auth.post('/register', async (c) => {
  const body = await jsonBody(c);
  const email = normaliseEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';

  if (!isValidEmail(email)) return c.json({ error: 'כתובת אימייל לא תקינה' }, 400);
  if (password.length < 8) return c.json({ error: 'הסיסמה צריכה להיות באורך 8 תווים לפחות' }, 400);

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return c.json({ error: 'כבר קיים חשבון עם האימייל הזה' }, 409);

  const { hash, salt } = await hashPassword(password);
  const now = new Date();
  const trialEnds = new Date(now.getTime() + TRIAL_DAYS * 24 * 3600 * 1000).toISOString();
  const result = await c.env.DB.prepare(
    `INSERT INTO users (email, password_hash, password_salt, plan, trial_ends_at, created_at)
     VALUES (?, ?, ?, 'free', ?, ?)`
  )
    .bind(email, hash, salt, trialEnds, now.toISOString())
    .run();
  const userId = result.meta.last_row_id as number;

  const businessName = str(body.business_name, 120);
  await c.env.DB.prepare(
    `INSERT INTO businesses (user_id, name, email, default_terms, updated_at) VALUES (?, ?, ?, ?, ?)`
  )
    .bind(userId, businessName, email, DEFAULT_TERMS, now.toISOString())
    .run();

  setSessionCookie(c, await createSession(c.env, userId));
  return c.json({ ok: true }, 201);
});

auth.post('/login', async (c) => {
  const body = await jsonBody(c);
  const email = normaliseEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !password) return c.json({ error: 'נדרשים אימייל וסיסמה' }, 400);

  const user = await c.env.DB.prepare('SELECT id, password_hash, password_salt FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: number; password_hash: string; password_salt: string }>();
  if (!user || !(await verifyPassword(password, user.password_hash, user.password_salt))) {
    return c.json({ error: 'אימייל או סיסמה שגויים' }, 401);
  }

  setSessionCookie(c, await createSession(c.env, user.id));
  return c.json({ ok: true });
});

auth.post('/logout', async (c) => {
  await clearSession(c);
  return c.json({ ok: true });
});

auth.post('/password', requireAuth, async (c) => {
  const user = c.get('user');
  const body = await jsonBody(c);
  const next = typeof body.next === 'string' ? body.next : '';
  if (next.length < 8) return c.json({ error: 'הסיסמה החדשה צריכה להיות באורך 8 תווים לפחות' }, 400);

  const row = await c.env.DB.prepare('SELECT password_hash, password_salt FROM users WHERE id = ?')
    .bind(user.id)
    .first<{ password_hash: string; password_salt: string }>();
  if (!row || !(await verifyPassword(str(body.current, 200), row.password_hash, row.password_salt))) {
    return c.json({ error: 'הסיסמה הנוכחית שגויה' }, 401);
  }

  const { hash, salt } = await hashPassword(next);
  await c.env.DB.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?')
    .bind(hash, salt, user.id)
    .run();
  // Other devices keep working only if they re-authenticate.
  await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id).run();
  setSessionCookie(c, await createSession(c.env, user.id));
  return c.json({ ok: true });
});

/** Session bootstrap for the SPA: who am I, what am I allowed to do, what did I use. */
auth.get('/me', async (c) => {
  const user = await userFromRequest(c);
  if (!user) return c.json({ user: null });

  const ent = entitlements(user);
  const used = await countQuotesInMonth(c.env, user.id, monthKey(new Date()));
  const business = await getBusiness(c.env, user.id);
  return c.json({
    user: { id: user.id, email: user.email },
    entitlements: ent,
    usage: { quotes_this_month: used },
    business,
  });
});

export default auth;
