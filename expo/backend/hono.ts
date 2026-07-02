import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import * as Sentry from "@sentry/node";

import { appRouter } from "./trpc/app-router";
import { createContext } from "./trpc/create-context";
import { sentryMiddleware } from "./sentry-middleware";

const app = new Hono();

// ── CORS ────────────────────────────────────────────────────
// ALLOWED_ORIGINS: comma-separated list of allowed origins.
// - When set, only those origins are allowed.
// - When unset: '*' outside production (dev convenience); in production
//   we deny cross-origin by returning no Access-Control-Allow-Origin.
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
const isProduction = process.env.NODE_ENV === "production";

app.use(
  "*",
  cors({
    origin: (origin) => {
      if (allowedOrigins.length > 0) {
        return allowedOrigins.includes(origin) ? origin : null;
      }
      // No allowlist configured: permissive in dev, deny cross-origin in prod.
      return isProduction ? null : "*";
    },
  }),
);
app.use("*", secureHeaders());
app.use("*", sentryMiddleware());

// ── Request logger ──────────────────────────────────────────
// Must be registered BEFORE route handlers (tRPC) or it never runs.
app.use("*", async (c, next) => {
  console.log(`[REQ] ${c.req.method} ${c.req.url}`);
  await next();
});

app.use("*", async (c, next) => {
  await next();
  c.res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  c.res.headers.set("X-Content-Type-Options", "nosniff");
  c.res.headers.set("X-Frame-Options", "DENY");
  c.res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  c.res.headers.set("Pragma", "no-cache");
});

app.onError((err, c) => {
  try {
    Sentry.captureException(err, {
      tags: { source: "hono_onError", path: c.req.path, method: c.req.method },
    });
  } catch {
    // Sentry not available — log only
  }
  console.log("[API] Error occurred at", new Date().toISOString());
  return c.json({ error: "Internal server error" }, 500);
});

// ── Rate limiting (in-memory sliding window) ────────────────
// Simple per-IP sliding window: keeps the timestamps of each client's
// requests within the last 60s and rejects with 429 once the window
// holds RATE_LIMIT_PER_MIN entries. No dependencies; suitable for a
// single-process deployment (per-instance limits when scaled out).
const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN) > 0
  ? Number(process.env.RATE_LIMIT_PER_MIN)
  : 60;
const RATE_WINDOW_MS = 60_000;
const rateBuckets = new Map<string, number[]>();

// Periodically drop empty buckets so the map cannot grow unbounded.
const rateCleanupTimer = setInterval(() => {
  const cutoff = Date.now() - RATE_WINDOW_MS;
  for (const [key, timestamps] of rateBuckets) {
    const alive = timestamps.filter((t) => t > cutoff);
    if (alive.length === 0) rateBuckets.delete(key);
    else rateBuckets.set(key, alive);
  }
}, RATE_WINDOW_MS);
// Don't keep the process alive just for the cleanup timer (Node only).
(rateCleanupTimer as unknown as { unref?: () => void }).unref?.();

app.use("/api/trpc/*", async (c, next) => {
  // Identify the client: first hop of x-forwarded-for, else 'unknown'.
  const forwardedFor = c.req.header("x-forwarded-for");
  const ip = forwardedFor?.split(",")[0]?.trim() || "unknown";

  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  const timestamps = (rateBuckets.get(ip) ?? []).filter((t) => t > cutoff);

  if (timestamps.length >= RATE_LIMIT_PER_MIN) {
    return c.json({ error: "Too many requests" }, 429);
  }

  timestamps.push(now);
  rateBuckets.set(ip, timestamps);
  await next();
});

app.use(
  // "/trpc/*",
  "/api/trpc/*",
  trpcServer({
    endpoint: "/api/trpc",
    router: appRouter,
    createContext,
  }),
);

app.get("/", (c) => {
  return c.json({ status: "ok" });
});

app.get("/health", (c) => {
  const uptime = process.uptime();
  return c.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: Math.round(uptime),
    version: process.env.APP_VERSION || "1.0.0",
    environment: process.env.NODE_ENV || "production",
  });
});

export default app;
