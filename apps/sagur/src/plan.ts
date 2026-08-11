// Plan entitlements. Free is deliberately usable — the limit bites exactly when
// the tool has already started paying for itself.

export const FREE_MONTHLY_QUOTES = 3;
export const TRIAL_DAYS = 14;

export type PlanUser = {
  plan: string;
  plan_until?: string | null;
  trial_ends_at?: string | null;
};

export type Entitlements = {
  plan: 'free' | 'pro';
  /** Pro features are on because of a paid subscription. */
  paid: boolean;
  /** Pro features are on because the trial is still running. */
  trialing: boolean;
  trial_days_left: number;
  monthly_quote_limit: number | null; // null = unlimited
  can_remove_branding: boolean;
  can_upload_logo: boolean;
  can_customise_colour: boolean;
};

export function entitlements(user: PlanUser, now: Date = new Date()): Entitlements {
  const paid = user.plan === 'pro' && notPast(user.plan_until, now);
  const trialing = !paid && inFuture(user.trial_ends_at, now);
  const pro = paid || trialing;
  return {
    plan: pro ? 'pro' : 'free',
    paid,
    trialing,
    trial_days_left: trialing ? daysLeft(user.trial_ends_at!, now) : 0,
    monthly_quote_limit: pro ? null : FREE_MONTHLY_QUOTES,
    can_remove_branding: pro,
    can_upload_logo: pro,
    can_customise_colour: pro,
  };
}

export function quotaExceeded(ent: Entitlements, usedThisMonth: number): boolean {
  return ent.monthly_quote_limit !== null && usedThisMonth >= ent.monthly_quote_limit;
}

function notPast(iso: string | null | undefined, now: Date): boolean {
  if (!iso) return true; // open-ended subscription
  return inFuture(iso, now);
}

function inFuture(iso: string | null | undefined, now: Date): boolean {
  if (!iso) return false;
  const ts = Date.parse(iso);
  return Number.isFinite(ts) && ts > now.getTime();
}

function daysLeft(iso: string, now: Date): number {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return 0;
  return Math.max(0, Math.ceil((ts - now.getTime()) / (24 * 60 * 60 * 1000)));
}
