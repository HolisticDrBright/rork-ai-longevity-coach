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
import { isDeployedEnvironment } from "./deployment";
import { startScribeWorkers } from "./scribe/runtime";

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

// Provider posture (modes only, never values). Fixture providers are REFUSED
// in deployed environments — endpoints fail closed, never fall back.
const deployed = isDeployedEnvironment();
console.log(
  `[Server] deployment=${deployed ? "deployed" : "local"} scribe_mode=${process.env.SCRIBE_MODE?.trim() || "(unset→fixture)"} lens_ai_mode=${process.env.LENS_AI_MODE?.trim() || "(unset→fixture)"}`,
);
const scribeModeRaw = process.env.SCRIBE_MODE?.trim().toLowerCase() || "fixture";
if (deployed && !["live", "disabled"].includes(scribeModeRaw)) {
  console.warn(
    "[Server] WARNING: deployed without SCRIBE_MODE=disabled (or live) — the fixture scribe provider is refused in deployed environments, so every scribe endpoint fails closed until an explicit mode is set.",
  );
}
const lensAiModeRaw = process.env.LENS_AI_MODE?.trim().toLowerCase() || "fixture";
if (deployed && !["live", "disabled"].includes(lensAiModeRaw)) {
  console.warn(
    "[Server] WARNING: deployed without LENS_AI_MODE=disabled (or live) — the fixture lens AI is refused in deployed environments; AI-assisted questions stay off (the deterministic lens engine is unaffected).",
  );
}

// Durable scribe workers (transcription completion + deletion). Single-tick,
// idempotent, DB-claimed with SKIP LOCKED — safe across instances.
startScribeWorkers();

// PostgREST reachability probe: one anonymous HEAD count against the data
// API at boot. RLS shows anon zero rows, so no data can be exposed — this
// only proves the /rest/v1 path works end-to-end from this container (the
// auth path succeeding while the data path silently fails is otherwise
// invisible until the first real query). Log-only: /health NEVER depends on
// it, and a failure never stops the server.
if (missingClinicalEnv.length === 0) {
  void (async () => {
    try {
      const { createClinicalAnonClient } = await import("./clinical-supabase");
      const { error, status } = await createClinicalAnonClient()
        .from("organizations")
        .select("id", { head: true, count: "exact" })
        .limit(0);
      if (error) {
        console.warn(
          `[Server] postgrest_probe=failed status=${status ?? "?"} code=${error.code ?? "?"} message=${(error.message ?? "").slice(0, 160)}`,
        );
      } else {
        console.log(`[Server] postgrest_probe=ok status=${status ?? 200}`);
      }
    } catch (e) {
      const err = e as Error;
      console.warn(
        `[Server] postgrest_probe=threw ${err?.name ?? "Error"}: ${(err?.message ?? "").slice(0, 160)}`,
      );
    }
  })();
}

serve({
  fetch: app.fetch,
  port,
  hostname: "0.0.0.0",
});

console.log(`[Server] Running on http://0.0.0.0:${port}`);