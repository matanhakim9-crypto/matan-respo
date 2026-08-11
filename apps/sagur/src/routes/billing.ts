import { Hono } from 'hono';
import { requireAuth } from '../auth.ts';
import { monthKey } from '../domain.ts';
import { entitlements } from '../plan.ts';
import { countQuotesInMonth } from '../store.ts';
import { jsonBody, str } from '../validate.ts';
import type { AppEnv, Bindings } from '../types.ts';

const DEFAULT_PRICE_AGOROT = 4900;

const billing = new Hono<AppEnv>();

function priceAgorot(env: Bindings): number {
  const parsed = Number.parseInt(env.PRO_PRICE_AGOROT ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PRICE_AGOROT;
}

function stripeConfigured(env: Bindings): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_ID);
}

billing.get('/', requireAuth, async (c) => {
  const user = c.get('user');
  const used = await countQuotesInMonth(c.env, user.id, monthKey(new Date()));
  return c.json({
    entitlements: entitlements(user),
    usage: { quotes_this_month: used },
    price_agorot: priceAgorot(c.env),
    checkout_available: stripeConfigured(c.env),
    redeem_available: Boolean(c.env.LICENSE_CODES),
  });
});

/** Starts a Stripe Checkout subscription. No-op with a clear error until keys are set. */
billing.post('/checkout', requireAuth, async (c) => {
  const user = c.get('user');
  if (!stripeConfigured(c.env)) {
    return c.json(
      { error: 'התשלום המקוון עדיין לא הופעל. אפשר לשדרג עם קוד שקיבלתם, או ליצור קשר.', code: 'checkout_unavailable' },
      501
    );
  }

  const origin = (c.env.APP_ORIGIN || new URL(c.req.url).origin).replace(/\/$/, '');
  const form = new URLSearchParams({
    mode: 'subscription',
    'line_items[0][price]': c.env.STRIPE_PRICE_ID!,
    'line_items[0][quantity]': '1',
    client_reference_id: String(user.id),
    customer_email: user.email,
    success_url: `${origin}/#/settings?upgraded=1`,
    cancel_url: `${origin}/#/upgrade`,
    'subscription_data[metadata][user_id]': String(user.id),
  });

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${c.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
  });
  const data = await res.json<{ url?: string; error?: { message?: string } }>().catch(() => ({}) as never);
  if (!res.ok || !data.url) {
    return c.json({ error: data?.error?.message ?? 'פתיחת התשלום נכשלה' }, 502);
  }
  return c.json({ url: data.url });
});

/** Redeems a one-time Pro code — how early customers and refunds are handled. */
billing.post('/redeem', requireAuth, async (c) => {
  const user = c.get('user');
  const body = await jsonBody(c);
  const code = str(body.code, 64).toUpperCase();
  if (!code) return c.json({ error: 'נא להזין קוד' }, 400);

  const configured = (c.env.LICENSE_CODES ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const match = configured.find((entry) => entry.split(':')[0]!.trim().toUpperCase() === code);
  if (!match) return c.json({ error: 'הקוד לא תקין' }, 400);

  const alreadyUsed = await c.env.DB.prepare('SELECT code FROM license_redemptions WHERE code = ?')
    .bind(code)
    .first();
  if (alreadyUsed) return c.json({ error: 'הקוד הזה כבר מומש' }, 409);

  const days = Number.parseInt(match.split(':')[1] ?? '', 10);
  const until = Number.isFinite(days) && days > 0 ? new Date(Date.now() + days * 24 * 3600 * 1000).toISOString() : null;

  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO license_redemptions (code, user_id, redeemed_at) VALUES (?, ?, ?)').bind(
      code,
      user.id,
      new Date().toISOString()
    ),
    c.env.DB.prepare("UPDATE users SET plan = 'pro', plan_until = ? WHERE id = ?").bind(until, user.id),
  ]);

  return c.json({ ok: true, plan_until: until });
});

/** Stripe webhook. Mounted before the auth middleware — Stripe has no session. */
billing.post('/webhook', async (c) => {
  const secret = c.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return c.json({ error: 'webhook not configured' }, 501);

  const payload = await c.req.text();
  const signature = c.req.header('Stripe-Signature') ?? '';
  if (!(await verifyStripeSignature(payload, signature, secret))) {
    return c.json({ error: 'invalid signature' }, 400);
  }

  const event = JSON.parse(payload) as {
    type?: string;
    data?: { object?: Record<string, unknown> };
  };
  const object = event.data?.object ?? {};

  if (event.type === 'checkout.session.completed') {
    const userId = Number.parseInt(String(object.client_reference_id ?? ''), 10);
    const customer = typeof object.customer === 'string' ? object.customer : null;
    if (Number.isFinite(userId)) {
      await c.env.DB.prepare("UPDATE users SET plan = 'pro', plan_until = NULL, billing_ref = ? WHERE id = ?")
        .bind(customer, userId)
        .run();
    }
  } else if (event.type === 'customer.subscription.deleted') {
    const customer = typeof object.customer === 'string' ? object.customer : null;
    // The paid period is already covered, so access ends at the period end.
    const endsAt = typeof object.current_period_end === 'number'
      ? new Date(object.current_period_end * 1000).toISOString()
      : new Date().toISOString();
    if (customer) {
      await c.env.DB.prepare('UPDATE users SET plan_until = ? WHERE billing_ref = ?').bind(endsAt, customer).run();
    }
  }

  return c.json({ received: true });
});

/**
 * Verifies Stripe's `t=...,v1=...` header: HMAC-SHA256 over "timestamp.payload".
 */
export async function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string,
  toleranceSeconds = 300,
  now: Date = new Date()
): Promise<boolean> {
  const parts = new Map(
    header
      .split(',')
      .map((part) => part.split('='))
      .filter((pair): pair is [string, string] => pair.length === 2)
      .map(([key, value]) => [key!.trim(), value!.trim()] as [string, string])
  );
  const timestamp = parts.get('t');
  const expected = parts.get('v1');
  if (!timestamp || !expected) return false;

  const age = Math.abs(now.getTime() / 1000 - Number.parseInt(timestamp, 10));
  if (!Number.isFinite(age) || age > toleranceSeconds) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const computed = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');

  if (computed.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export default billing;
