// Small input coercions. Every value that reaches the database goes through one
// of these, so a malformed request can only ever produce a boring default.

/** Reads a JSON body, treating anything malformed as an empty object. */
export async function jsonBody(c: {
  req: { json: <T>() => Promise<T> };
}): Promise<Record<string, unknown>> {
  const parsed = await c.req.json<unknown>().catch(() => null);
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

export function str(value: unknown, maxLength = 500, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  return value.trim().slice(0, maxLength);
}

export function optionalStr(value: unknown, maxLength = 500): string | null {
  const s = str(value, maxLength);
  return s === '' ? null : s;
}

export function num(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : fallback;
}

export function int(value: unknown, fallback = 0): number {
  return Math.trunc(num(value, fallback));
}

export function clampNum(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function bool(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return fallback;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isoDate(value: unknown, fallback: string): string {
  const s = str(value, 10);
  return ISO_DATE.test(s) && !Number.isNaN(Date.parse(s)) ? s : fallback;
}

export function optionalIsoDate(value: unknown): string | null {
  const s = str(value, 10);
  return ISO_DATE.test(s) && !Number.isNaN(Date.parse(s)) ? s : null;
}

const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;

export function hexColour(value: unknown, fallback: string): string {
  const s = str(value, 7);
  return HEX_COLOUR.test(s) ? s.toLowerCase() : fallback;
}

/** Only small, self-contained images may be stored as a logo or signature. */
export function dataImageUrl(value: unknown, maxBytes: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(trimmed)) return null;
  if (trimmed.length > maxBytes) return null;
  return trimmed;
}
