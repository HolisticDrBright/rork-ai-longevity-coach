import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { requestId } from "hono/request-id";

import { appRouter } from "./trpc/app-router";
import { createContext } from "./trpc/create-context";
import { sentryMiddleware } from "./sentry-middleware";
import { rateLimiter } from "./rate-limit";
import { auditMiddleware } from "./audit-middleware";
import { createAnonSupabaseClient } from "./supabase-server";

const app = new Hono();

// Request ID for tracing
app.use("*", requestId());

// CORS — restrict to known origins in production
const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS
  ? process.env.CORS_ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : undefined;

app.use(
  "*",
  cors({
    origin: allowedOrigins
      ? (origin) => (allowedOrigins.includes(origin) ? origin : "")
      : "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Request-ID"],
    maxAge: 86400,
  })
);

// Security headers
app.use("*", secureHeaders());

// Rate limiting — 200 requests per minute per IP
app.use("*", rateLimiter({ max: 200, windowMs: 60_000 }));

// Sentry error tracking
app.use("*", sentryMiddleware());

// Audit logging for PHI access (runs after response)
app.use("*", auditMiddleware());

// Additional security headers
app.use("*", async (c, next) => {
  await next();
  c.res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  c.res.headers.set("X-Content-Type-Options", "nosniff");
  c.res.headers.set("X-Frame-Options", "DENY");
  c.res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  c.res.headers.set("Pragma", "no-cache");
});

// Global error handler — redact internal details
app.onError((err, c) => {
  try {
    const { captureError } = require('../lib/sentry');
    captureError(err, {
      source: 'hono_onError',
      path: c.req.path,
      method: c.req.method,
      requestId: c.get('requestId'),
    });
  } catch {
    // Sentry may not be available in all environments
  }
  console.log("[API] Error occurred at", new Date().toISOString(), "requestId:", c.get('requestId'));
  return c.json({ error: "Internal server error" }, 500);
});

// tRPC handler
app.use(
  "/trpc/*",
  trpcServer({
    endpoint: "/api/trpc",
    router: appRouter,
    createContext,
  }),
);

// Root status
app.get("/", (c) => {
  return c.json({ status: "ok" });
});

// Health check with DB connectivity
app.get("/health", async (c) => {
  const uptime = process.uptime();
  let dbStatus = "unknown";

  try {
    const sb = createAnonSupabaseClient();
    const { error } = await sb.from('clinic_lab_tests').select('id').limit(1);
    dbStatus = error ? "degraded" : "connected";
  } catch {
    dbStatus = "disconnected";
  }

  const healthy = dbStatus === "connected";

  return c.json(
    {
      status: healthy ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      uptime: Math.round(uptime),
      version: process.env.APP_VERSION || "1.0.0",
      environment: process.env.NODE_ENV || "production",
      database: dbStatus,
    },
    healthy ? 200 : 503
  );
});

export default app;
