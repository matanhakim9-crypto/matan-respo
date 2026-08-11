import { Hono } from 'hono';
import { requireAuth } from '../auth.ts';
import { entitlements } from '../plan.ts';
import { getBusiness } from '../store.ts';
import { clampNum, dataImageUrl, hexColour, int, jsonBody, num, str } from '../validate.ts';
import type { AppEnv } from '../types.ts';

const MAX_LOGO_CHARS = 400_000; // ~300 KB of base64, plenty for a logo

const business = new Hono<AppEnv>();
business.use('*', requireAuth);

business.get('/', async (c) => {
  return c.json(await getBusiness(c.env, c.get('user').id));
});

business.put('/', async (c) => {
  const user = c.get('user');
  const current = await getBusiness(c.env, user.id);
  const ent = entitlements(user);
  const body = await jsonBody(c);

  // Branding is a Pro feature, so a free account keeps whatever it had.
  const logo = ent.can_upload_logo
    ? 'logo_data_url' in body
      ? dataImageUrl(body.logo_data_url, MAX_LOGO_CHARS)
      : current.logo_data_url
    : current.logo_data_url;
  const accent = ent.can_customise_colour ? hexColour(body.accent_color, current.accent_color) : current.accent_color;

  const next = {
    name: str(body.name, 120, current.name),
    owner_name: str(body.owner_name, 120, current.owner_name),
    phone: str(body.phone, 40, current.phone),
    email: str(body.email, 160, current.email),
    tax_id: str(body.tax_id, 40, current.tax_id),
    address: str(body.address, 240, current.address),
    logo_data_url: logo,
    accent_color: accent,
    vat_rate: clampNum(num(body.vat_rate, current.vat_rate), 0, 100),
    validity_days: clampNum(int(body.validity_days, current.validity_days), 1, 365),
    default_terms: str(body.default_terms, 4000, current.default_terms),
    quote_prefix: str(body.quote_prefix, 12, current.quote_prefix),
    next_quote_number: Math.max(1, int(body.next_quote_number, current.next_quote_number)),
  };

  await c.env.DB.prepare(
    `UPDATE businesses SET name = ?, owner_name = ?, phone = ?, email = ?, tax_id = ?, address = ?,
       logo_data_url = ?, accent_color = ?, vat_rate = ?, validity_days = ?, default_terms = ?,
       quote_prefix = ?, next_quote_number = ?, updated_at = ?
     WHERE user_id = ?`
  )
    .bind(
      next.name,
      next.owner_name,
      next.phone,
      next.email,
      next.tax_id,
      next.address,
      next.logo_data_url,
      next.accent_color,
      next.vat_rate,
      next.validity_days,
      next.default_terms,
      next.quote_prefix,
      next.next_quote_number,
      new Date().toISOString(),
      user.id
    )
    .run();

  return c.json(await getBusiness(c.env, user.id));
});

export default business;
