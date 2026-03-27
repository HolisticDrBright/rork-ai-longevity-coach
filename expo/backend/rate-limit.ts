/**
 * Simple in-memory rate limiter middleware for Hono.
 * Uses a sliding window approach per IP address.
 *
 * For production at scale, replace with Redis-backed rate limiting.
 */
import type { Context, Next } from 'hono';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) {
      store.delete(key);
    }
  }
}, 5 * 60 * 1000);

interface RateLimitOptions {
  /** Max requests per window */
  max: number;
  /** Window size in milliseconds */
  windowMs: number;
}

export function rateLimiter(options: RateLimitOptions = { max: 100, windowMs: 60_000 }) {
  return async (c: Context, next: Next) => {
    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
      c.req.header('x-real-ip') ??
      'unknown';

    const now = Date.now();
    const key = `rl:${ip}`;
    let entry = store.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + options.windowMs };
      store.set(key, entry);
    }

    entry.count++;

    c.res.headers.set('X-RateLimit-Limit', String(options.max));
    c.res.headers.set('X-RateLimit-Remaining', String(Math.max(0, options.max - entry.count)));
    c.res.headers.set('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > options.max) {
      return c.json(
        { error: 'Too many requests. Please try again later.' },
        429
      );
    }

    await next();
  };
}
