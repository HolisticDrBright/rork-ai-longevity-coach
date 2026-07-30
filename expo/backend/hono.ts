import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";

import { appRouter } from "./trpc/app-router";
import { createContext } from "./trpc/create-context";
import { sentryMiddleware } from "./sentry-middleware";
import { readSyncBridgeConfig } from "./sync/config";
import { createSyncReceiver } from "./sync/receiver";
import { getSyncStorage } from "./sync/service";

const app = new Hono();

app.use("*", cors());
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

app.use(
  // "/trpc/*",
  "/api/trpc/*",
  trpcServer({
    endpoint: "/api/trpc",
    router: appRouter,
    createContext,
  }),
);

app.use("*", async (c, next) => {
  console.log(`[REQ] ${c.req.method} ${c.req.url}`);
  await next();
});

// patient-sync/1 receiver — mounted ONLY when the bridge is fully
// configured (PATIENT_SYNC_ENABLED plus the complete secret set). While
// disabled the paths simply do not exist, and nothing about the bridge
// leaks through responses or logs.
{
  const syncConfig = readSyncBridgeConfig();
  if (syncConfig.enabled) {
    app.route(
      "/patient-sync",
      createSyncReceiver({
        storage: getSyncStorage(),
        resolveSecret: (keyId: string) =>
          keyId === syncConfig.inboundKeyId ? syncConfig.inboundSecret : null,
        log: (event: string) => console.log(`[sync] ${event}`),
      }),
    );
    console.log("[sync] patient-sync/1 receiver mounted");
  } else {
    console.log(`[sync] receiver disabled: ${syncConfig.disabledReason}`);
  }
}

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
