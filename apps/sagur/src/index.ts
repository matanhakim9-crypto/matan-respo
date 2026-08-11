import { Hono } from 'hono';
import authRoutes from './routes/auth.ts';
import billingRoutes from './routes/billing.ts';
import businessRoutes from './routes/business.ts';
import catalogRoutes from './routes/catalog.ts';
import customerRoutes from './routes/customers.ts';
import quoteRoutes from './routes/quotes.ts';
import statsRoutes from './routes/stats.ts';
import { publicApi, publicPage } from './routes/public.ts';
import type { AppEnv } from './types.ts';

const app = new Hono<AppEnv>();

app.route('/api/auth', authRoutes);
app.route('/api/public', publicApi);
app.route('/api/business', businessRoutes);
app.route('/api/customers', customerRoutes);
app.route('/api/catalog', catalogRoutes);
app.route('/api/quotes', quoteRoutes);
app.route('/api/stats', statsRoutes);
app.route('/api/billing', billingRoutes);

// The customer-facing quote page. Server rendered so a link opens instantly on a
// phone with no app shell, no JavaScript framework and no login.
app.route('/q', publicPage);

app.all('/api/*', (c) => c.json({ error: 'לא נמצא' }, 404));

app.onError((err, c) => {
  console.error('unhandled', err);
  return c.json({ error: 'שגיאת שרת' }, 500);
});

// Everything else is the installable PWA shell, served from ./public.
app.get('*', async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  if (res.status !== 404) return res;
  // Deep links like /#/quotes/5 are handled client side; serve the shell.
  const url = new URL(c.req.url);
  url.pathname = '/index.html';
  return c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw));
});

export default app;
