// Money and quote-total arithmetic.
//
// Everything is integer agorot (1 ₪ = 100 agorot). Quantities may be fractional
// (2.5 hours, 13.7 m²), so a line total is the one place we round — after that
// the whole document is integer maths and the printed totals always add up.

export type DiscountType = 'none' | 'percent' | 'amount';

export type QuoteLineInput = {
  quantity: number;
  unit_price: number; // agorot
};

export type QuoteTotals = {
  subtotal: number;
  discount_amount: number;
  net: number;
  vat_amount: number;
  total: number;
};

/** Rounds half away from zero, the way an invoice is expected to round. */
export function roundAgorot(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

export function lineTotal(line: QuoteLineInput): number {
  const qty = Number.isFinite(line.quantity) ? line.quantity : 0;
  const price = Number.isFinite(line.unit_price) ? line.unit_price : 0;
  return roundAgorot(qty * price);
}

export function computeTotals(
  lines: QuoteLineInput[],
  opts: { discount_type?: DiscountType; discount_value?: number; vat_rate?: number } = {}
): QuoteTotals {
  const subtotal = lines.reduce((sum, line) => sum + lineTotal(line), 0);

  const discountType: DiscountType = opts.discount_type ?? 'none';
  const rawDiscountValue = Number.isFinite(opts.discount_value) ? (opts.discount_value as number) : 0;
  let discount = 0;
  if (discountType === 'percent') {
    const pct = clamp(rawDiscountValue, 0, 100);
    discount = roundAgorot((subtotal * pct) / 100);
  } else if (discountType === 'amount') {
    discount = roundAgorot(clamp(rawDiscountValue, 0, subtotal));
  }
  // A discount can never make the document negative, whatever was typed in.
  discount = clamp(discount, 0, Math.max(subtotal, 0));

  const net = subtotal - discount;
  const vatRate = clamp(Number.isFinite(opts.vat_rate) ? (opts.vat_rate as number) : 0, 0, 100);
  const vat = roundAgorot((net * vatRate) / 100);

  return { subtotal, discount_amount: discount, net, vat_amount: vat, total: net + vat };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/** Parses free-typed shekel input ("1,250.5", "₪90", "") into agorot. */
export function shekelsToAgorot(input: string | number | null | undefined): number {
  if (typeof input === 'number') return roundAgorot(input * 100);
  if (!input) return 0;
  const cleaned = String(input).replace(/[^\d.,-]/g, '').replace(/,/g, '');
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? roundAgorot(value * 100) : 0;
}

export function formatAgorot(agorot: number, opts: { withSymbol?: boolean } = {}): string {
  const value = (Number.isFinite(agorot) ? agorot : 0) / 100;
  const formatted = value.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return opts.withSymbol === false ? formatted : `₪${formatted}`;
}
