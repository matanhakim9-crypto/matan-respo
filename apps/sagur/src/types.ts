import type { QuoteStatus } from './domain.ts';

export type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Public origin for share links; falls back to the request origin. */
  APP_ORIGIN?: string;
  PRO_PRICE_AGOROT?: string;
  /** Billing secrets — set with `wrangler secret put`. Optional. */
  STRIPE_SECRET_KEY?: string;
  STRIPE_PRICE_ID?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  /** Comma-separated codes that unlock Pro manually (early customers, refunds). */
  LICENSE_CODES?: string;
};

export type SessionUser = {
  id: number;
  email: string;
  plan: string;
  plan_until: string | null;
  trial_ends_at: string | null;
};

export type Variables = {
  user: SessionUser;
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };

export type BusinessRow = {
  user_id: number;
  name: string;
  owner_name: string;
  phone: string;
  email: string;
  tax_id: string;
  address: string;
  logo_data_url: string | null;
  accent_color: string;
  vat_rate: number;
  validity_days: number;
  default_terms: string;
  quote_prefix: string;
  next_quote_number: number;
  updated_at: string;
};

export type CustomerRow = {
  id: number;
  user_id: number;
  name: string;
  contact_name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  archived: number;
  created_at: string;
};

export type CatalogItemRow = {
  id: number;
  user_id: number;
  name: string;
  details: string;
  unit: string;
  unit_price: number;
  use_count: number;
  archived: number;
  created_at: string;
};

export type QuoteRow = {
  id: number;
  user_id: number;
  customer_id: number | null;
  number: string;
  title: string;
  status: QuoteStatus;
  issue_date: string;
  valid_until: string | null;
  notes: string;
  terms: string;
  discount_type: 'none' | 'percent' | 'amount';
  discount_value: number;
  vat_rate: number;
  subtotal: number;
  discount_amount: number;
  vat_amount: number;
  total: number;
  public_token: string;
  sent_at: string | null;
  first_viewed_at: string | null;
  last_viewed_at: string | null;
  view_count: number;
  decided_at: string | null;
  decline_reason: string | null;
  signer_name: string | null;
  signature_image: string | null;
  signer_ip: string | null;
  signer_agent: string | null;
  created_at: string;
  updated_at: string;
};

export type QuoteItemRow = {
  id: number;
  quote_id: number;
  name: string;
  details: string;
  unit: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  sort_order: number;
};

export type QuoteEventRow = {
  id: number;
  quote_id: number;
  type: string;
  detail: string;
  created_at: string;
};
