import type { Context, Next } from 'hono';

/**
 * Request hygiene for sensitive endpoints (P0):
 *  - Origin validation: browser-originated requests (Origin header present)
 *    must match the CORS allowlist; server-to-server calls send no Origin and
 *    pass. Never reflect or trust arbitrary origins.
 *  - Body-size cap via Content-Length (cheap, before any body read).
 *  - Per-IP fixed-window rate limiting (in-memory; suitable for a single
 *    instance — swap for a shared store when scaling horizontally).
 *
 * Nothing here logs URLs, tokens, or payloads — only status decisions.
 */

const isProd = (process.env.NODE_ENV ?? 'production') === 'production';
const DEV_ORIGINS = new Set([
  'http://localhost:3000',
  'http://localhost:8081',
  'http://localhost:19006',
]);

function allowedOrigin(origin: string): boolean {
  const allow = (process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (allow.includes(origin)) return true;
  if (!isProd && DEV_ORIGINS.has(origin)) return true;
  return false;
}

interface Window {
  count: number;
  resetAt: number;
}

export function requestGuards(opts: { maxBodyBytes: number; ratePerMinute: number }) {
  const windows = new Map<string, Window>();

  return async (c: Context, next: Next) => {
    const origin = c.req.header('origin');
    if (origin && !allowedOrigin(origin)) {
      return c.json({ error: { code: 'forbidden', message: 'Origin not allowed' } }, 403);
    }

    const len = Number(c.req.header('content-length') ?? '0');
    if (Number.isFinite(len) && len > opts.maxBodyBytes) {
      return c.json({ error: { code: 'invalid', message: 'Request body too large' } }, 413);
    }

    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      c.req.header('x-real-ip') ||
      'local';
    const now = Date.now();
    const w = windows.get(ip);
    if (!w || now >= w.resetAt) {
      windows.set(ip, { count: 1, resetAt: now + 60_000 });
    } else if (w.count >= opts.ratePerMinute) {
      return c.json({ error: { code: 'unavailable', message: 'Too many requests' } }, 429);
    } else {
      w.count += 1;
    }
    // Opportunistic cleanup so the map can't grow unbounded.
    if (windows.size > 10_000) {
      for (const [k, v] of windows) if (now >= v.resetAt) windows.delete(k);
    }

    await next();
  };
}
