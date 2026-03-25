import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";

import { appRouter } from "./trpc/app-router";
import { createContext } from "./trpc/create-context";
import { sentryMiddleware } from "./sentry-middleware";

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
  const { captureError } = require('../lib/sentry');
  captureError(err, { source: 'hono_onError', path: c.req.path, method: c.req.method });
  console.log("[API] Error occurred at", new Date().toISOString());
  return c.json({ error: "Internal server error" }, 500);
});

app.use(
  "/trpc/*",
  trpcServer({
    endpoint: "/api/trpc",
    router: appRouter,
    createContext,
  }),
);

app.get("/", (c) => {
  return c.json({ status: "ok" });
});

export default app;
