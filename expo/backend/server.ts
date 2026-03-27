import app from "./hono";

// Validate required environment variables on startup
const REQUIRED_ENV = [
  "EXPO_PUBLIC_SUPABASE_URL",
  "EXPO_PUBLIC_SUPABASE_ANON_KEY",
];

const OPTIONAL_ENV = [
  "EXPO_PUBLIC_SENTRY_DSN",
  "PASSIO_API_KEY",
  "EXPO_PUBLIC_WEBHOOK_SECRET",
  "EXPO_PUBLIC_WEBHOOK_BASE_URL",
  "CORS_ALLOWED_ORIGINS",
];

const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`[Server] FATAL: Missing required env vars: ${missing.join(", ")}`);
  process.exit(1);
}

const configured = OPTIONAL_ENV.filter((key) => !!process.env[key]);
const unconfigured = OPTIONAL_ENV.filter((key) => !process.env[key]);

const port = parseInt(process.env.PORT || "3000", 10);

console.log(`[Server] Starting on port ${port}...`);
console.log(`[Server] Environment: ${process.env.NODE_ENV || "production"}`);
console.log(`[Server] Optional services configured: ${configured.length > 0 ? configured.join(", ") : "none"}`);
if (unconfigured.length > 0) {
  console.log(`[Server] Optional services not configured: ${unconfigured.join(", ")}`);
}

export default {
  port,
  fetch: app.fetch,
};

console.log(`[Server] Listening on http://0.0.0.0:${port}`);
