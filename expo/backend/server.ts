// import app from "./hono";

// const port = parseInt(process.env.PORT || "3000", 10);

// console.log(`[Server] Starting on port ${port}...`);

// export default {
//   port,
//   fetch: app.fetch,
// };

// console.log(`[Server] Listening on http://0.0.0.0:${port}`);

import { serve } from "@hono/node-server";
import app from "./hono";

const port = Number(process.env.PORT || 3000);

// Startup env validation: name-only (never values). The clinical desktop
// routes need these; the legacy mobile paths do not, so warn loudly instead
// of refusing to boot. Individual requests still fail with a clear
// "not configured" error until they are set (clinical-supabase.ts).
const missingClinicalEnv = ["CLINICAL_SUPABASE_URL", "CLINICAL_SUPABASE_ANON_KEY"].filter(
  (name) => !process.env[name],
);
if (missingClinicalEnv.length > 0) {
  console.warn(
    `[Server] WARNING: ${missingClinicalEnv.join(", ")} not set — clinical (desktop) routes will answer "not configured" until provided. See backend/ENV.md.`,
  );
}
if (!process.env.CORS_ALLOWED_ORIGINS) {
  console.warn(
    "[Server] WARNING: CORS_ALLOWED_ORIGINS not set — browser origins will be refused by the origin guard.",
  );
}

serve({
  fetch: app.fetch,
  port,
  hostname: "0.0.0.0",
});

console.log(`[Server] Running on http://0.0.0.0:${port}`);