import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";

import { appRouter } from "./trpc/app-router";
import { createContext } from "./trpc/create-context";
import { sentryMiddleware } from "./sentry-middleware";
import { labsUploadApp } from "./labs/upload-route";
import { scribeApp } from "./scribe/routes";
import { requestGuards } from "./request-guards";

const app = new Hono();

// Environment-driven CORS allowlist (security finding #5: wildcard CORS).
// Native mobile requests send no Origin header and are unaffected. Browser
// origins must be listed in CORS_ALLOWED_ORIGINS (comma-separated). When the
// variable is unset, only localhost dev origins are allowed — never "*".
const isProd = (process.env.NODE_ENV ?? "production") === "production";
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const devOrigins = [
  "http://localhost:3000",
  "http://localhost:8081",
  "http://localhost:19006",
];

app.use(
  "*",
  cors({
    origin: (origin) => {
      // No Origin header (native mobile, server-to-server) → allow.
      if (!origin) return origin;
      if (allowedOrigins.includes(origin)) return origin;
      if (!isProd && devOrigins.includes(origin)) return origin;
      // Not allowlisted → deny (never reflect an arbitrary origin, never "*").
      return null;
    },
    credentials: true,
  }),
);
app.use("*", secureHeaders());
app.use("*", sentryMiddleware());

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
    const { captureError } = require('../lib/sentry');
    captureError(err, { source: 'hono_onError', path: c.req.path, method: c.req.method });
  } catch {
    // Sentry not available — log only
  }
  console.log("[API] Error occurred at", new Date().toISOString());
  return c.json({ error: "Internal server error" }, 500);
});

// Sensitive-surface hygiene: origin validation, body caps, per-IP rate limits.
app.use("/api/trpc/*", requestGuards({ maxBodyBytes: 1024 * 1024, ratePerMinute: 240 }));
app.use("/api/clinical/*", requestGuards({ maxBodyBytes: 16 * 1024 * 1024, ratePerMinute: 60 }));

app.use(
  // "/trpc/*",
  "/api/trpc/*",
  trpcServer({
    endpoint: "/api/trpc",
    router: appRouter,
    createContext,
  }),
);

// Multipart lab-PDF ingestion (can't ride the superjson tRPC link).
app.route("/api/clinical/labs", labsUploadApp);

// Scribe binary chunks, upload completion, and SIGNED provider callbacks.
// The callback endpoint authenticates cryptographically (HMAC), not by
// bearer token — requestGuards still applies body caps + rate limits via
// the /api/clinical/* rule above.
app.route("/api/clinical/scribe", scribeApp);

app.use("*", async (c, next) => {
  // Path only — query strings can carry tRPC GET inputs; tokens/PHI never log.
  console.log(`[REQ] ${c.req.method} ${new URL(c.req.url).pathname}`);
  await next();
});

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
