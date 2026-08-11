// Quote lifecycle rules, kept free of D1 and Hono so they can be unit tested.

export type QuoteStatus = 'draft' | 'sent' | 'viewed' | 'approved' | 'declined' | 'cancelled';
/** What the UI shows. 'expired' is derived from the validity date, never stored. */
export type EffectiveStatus = QuoteStatus | 'expired';

export const OPEN_STATUSES: QuoteStatus[] = ['sent', 'viewed'];
export const FOLLOW_UP_AFTER_DAYS = 3;

export const STATUS_LABELS: Record<EffectiveStatus, string> = {
  draft: 'טיוטה',
  sent: 'נשלחה',
  viewed: 'נצפתה',
  approved: 'אושרה',
  declined: 'נדחתה',
  cancelled: 'בוטלה',
  expired: 'פג תוקף',
};

export function isOpen(status: QuoteStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

/** A quote is only editable before it has left the building. */
export function isEditable(status: QuoteStatus): boolean {
  return status === 'draft';
}

export function effectiveStatus(
  quote: { status: QuoteStatus; valid_until?: string | null },
  now: Date = new Date()
): EffectiveStatus {
  if (isOpen(quote.status) && isExpired(quote.valid_until, now)) return 'expired';
  return quote.status;
}

/** Validity runs to the end of `valid_until`, so a quote valid "until today" still is. */
export function isExpired(validUntil: string | null | undefined, now: Date = new Date()): boolean {
  if (!validUntil) return false;
  const end = Date.parse(`${validUntil}T23:59:59.999Z`);
  if (!Number.isFinite(end)) return false;
  return now.getTime() > end;
}

export function needsFollowUp(
  quote: { status: QuoteStatus; sent_at?: string | null; valid_until?: string | null },
  now: Date = new Date()
): boolean {
  if (!isOpen(quote.status)) return false;
  if (isExpired(quote.valid_until, now)) return false;
  if (!quote.sent_at) return false;
  const sent = Date.parse(quote.sent_at);
  if (!Number.isFinite(sent)) return false;
  return daysBetween(sent, now.getTime()) >= FOLLOW_UP_AFTER_DAYS;
}

export function daysBetween(fromMs: number, toMs: number): number {
  return Math.floor((toMs - fromMs) / (24 * 60 * 60 * 1000));
}

const ALLOWED_TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  draft: ['sent', 'cancelled'],
  sent: ['viewed', 'approved', 'declined', 'cancelled', 'draft'],
  viewed: ['approved', 'declined', 'cancelled', 'draft'],
  approved: ['draft'],
  declined: ['draft', 'sent'],
  cancelled: ['draft'],
};

export function canTransition(from: QuoteStatus, to: QuoteStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

export function formatQuoteNumber(prefix: string, seq: number): string {
  const padded = String(Math.max(1, Math.floor(seq))).padStart(4, '0');
  return `${(prefix ?? '').trim()}${padded}`;
}

export function addDays(isoDate: string, days: number): string {
  const base = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(base.getTime())) return isoDate;
  base.setUTCDate(base.getUTCDate() + days);
  return toIsoDate(base);
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Calendar-month key used for the free-plan quota and the monthly charts. */
export function monthKey(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 7);
}

export type WinRate = { sent: number; won: number; rate: number };

/** Win rate counts decided quotes only — pending ones aren't losses yet. */
export function winRate(quotes: { status: QuoteStatus }[]): WinRate {
  const decided = quotes.filter((q) => q.status === 'approved' || q.status === 'declined');
  const won = decided.filter((q) => q.status === 'approved').length;
  return { sent: decided.length, won, rate: decided.length === 0 ? 0 : won / decided.length };
}
