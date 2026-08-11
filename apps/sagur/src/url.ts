import type { Context } from 'hono';
import type { AppEnv } from './types.ts';

/**
 * Absolute URL of the customer-facing quote page. APP_ORIGIN wins when set so
 * links stay on the custom domain even if the Worker is hit through *.workers.dev.
 */
export function shareUrl(c: Context<AppEnv>, token: string): string {
  const configured = (c.env.APP_ORIGIN ?? '').trim().replace(/\/$/, '');
  const origin = configured || new URL(c.req.url).origin;
  return `${origin}/q/${token}`;
}
