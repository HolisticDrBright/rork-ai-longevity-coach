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

// PostgREST reachability probes at boot (log-only: /health NEVER depends on
// them and a failure never stops the server). Two layers:
//
//  1. postgrest_transport — raw HEAD to the /rest/v1/ root with the anon key:
//     no table, no RLS. ANY HTTP status proves the data-API transport works
//     from this container; only a thrown fetch means unreachable.
//  2. postgrest_probe — an anonymous head-count on `organizations` through
//     supabase-js. The organizations RLS policy invokes an authenticated-only
//     private helper, so 42501 "permission denied for function ..." is the
//     EXPECTED anon outcome and is classified `restricted` (reachable; key
//     accepted; policy evaluated) — NOT a failure. Signed-in behavior is
//     diagnosed by the [clinical.orgs.mine]/[trpc] request logs, not here.
if (missingClinicalEnv.length === 0) {
  void (async () => {
    const base = (process.env.CLINICAL_SUPABASE_URL ?? "").replace(/\/+$/, "");
    try {
      const res = await fetch(`${base}/rest/v1/`, {
        method: "HEAD",
        headers: { apikey: process.env.CLINICAL_SUPABASE_ANON_KEY ?? "" },
      });
      console.log(`[Server] postgrest_transport=reachable status=${res.status}`);
    } catch (e) {
      const err = e as Error;
      console.warn(
        `[Server] postgrest_transport=unreachable ${err?.name ?? "Error"}: ${(err?.message ?? "").slice(0, 160)}`,
      );
    }
    try {
      const { createClinicalAnonClient } = await import("./clinical-supabase");
      const { error, status } = await createClinicalAnonClient()
        .from("organizations")
        .select("id", { head: true, count: "exact" })
        .limit(0);
      if (!error) {
        console.log(`[Server] postgrest_probe=ok status=${status ?? 200}`);
      } else if (error.code === "42501" || /permission denied/i.test(error.message ?? "")) {
        console.log(
          `[Server] postgrest_probe=restricted (expected for anon — PostgREST reached, RLS policy evaluated) code=${error.code ?? "42501"}`,
        );
      } else {
        console.warn(
          `[Server] postgrest_probe=failed status=${status ?? "?"} code=${error.code ?? "?"} message=${(error.message ?? "").slice(0, 160)}`,
        );
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