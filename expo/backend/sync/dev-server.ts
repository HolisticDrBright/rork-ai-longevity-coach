/**
 * Cross-repo round-trip entry: serves the REAL patient-sync/1 receiver
 * (the same createSyncReceiver the production hono.ts mounts) with
 * in-memory storage, seeded with one active connection from env.
 *
 * Used by AI Desktop Pro's process-level bridge test to prove a genuine
 * signed HTTP round trip between the two real codebases — no staging
 * environment, no real database, no real patient data.
 *
 *   bun run backend/sync/dev-server.ts
 *
 * Env: SYNC_DEV_PORT, PATIENT_SYNC_INBOUND_SECRET,
 *      PATIENT_SYNC_INBOUND_KEY_ID, SYNC_DEV_CONNECTION_ID,
 *      SYNC_DEV_ORGANIZATION_ID, SYNC_DEV_USER_ID.
 */
import { Hono } from "hono";
import { createSyncReceiver } from "./receiver";
import { createMemorySyncStorage } from "./storage";

const port = Number(process.env.SYNC_DEV_PORT ?? 3997);
const secret = process.env.PATIENT_SYNC_INBOUND_SECRET ?? "";
const keyId = process.env.PATIENT_SYNC_INBOUND_KEY_ID ?? "desktop-key-1";
if (!secret) {
  console.error("[sync-dev] PATIENT_SYNC_INBOUND_SECRET is required");
  process.exit(1);
}

const storage = createMemorySyncStorage();
const app = new Hono();

async function main() {
  const connection = await storage.insertConnection({
    desktopConnectionId: process.env.SYNC_DEV_CONNECTION_ID ?? "dev-connection-1",
    desktopOrganizationId: process.env.SYNC_DEV_ORGANIZATION_ID ?? "dev-org-1",
    userId: process.env.SYNC_DEV_USER_ID ?? "dev-user-1",
    status: "active",
    verifiedAt: new Date().toISOString(),
    revokedAt: null,
    revokeReason: null,
  });

  app.route("/patient-sync", createSyncReceiver({
    storage,
    resolveSecret: (k) => (k === keyId ? secret : null),
    log: (event) => console.log(`[sync-dev] ${event}`),
  }));

  // Introspection + drivers for the round-trip test (dev server only,
  // never deployed). These exercise the REAL outbound module against the
  // desktop's real callback boundary.
  const outboundConfig = {
    url: (process.env.PATIENT_SYNC_OUTBOUND_URL ?? "").replace(/\/$/, ""),
    secret: process.env.PATIENT_SYNC_OUTBOUND_SECRET ?? "",
    keyId: process.env.PATIENT_SYNC_OUTBOUND_KEY_ID ?? "alp-key-1",
  };
  const { queueAckEvidence, queueInboundEvent, dispatchOutboxOnce } = await import("./outbound");

  app.get("/__dev/resources", async (c) =>
    c.json({ resources: await storage.listResources(connection.id) }));
  app.get("/__dev/history", async (c) =>
    c.json({ history: await storage.listHistory(connection.id) }));
  app.post("/__dev/revoke", async (c) => {
    await storage.revokeConnection(connection.id, "revoked by round-trip test");
    return c.json({ ok: true });
  });
  app.post("/__dev/queue-ack", async (c) => {
    const body = await c.req.json();
    const row = await queueAckEvidence({
      storage, connectionId: connection.id, eventUid: String(body.eventUid ?? ""),
    });
    return c.json({ ok: true, providerEventId: row.providerEventId });
  });
  app.post("/__dev/queue-event", async (c) => {
    const body = await c.req.json();
    const row = await queueInboundEvent({
      storage,
      connectionId: connection.id,
      desktopConnectionId: connection.desktopConnectionId,
      resourceType: String(body.resourceType ?? "supplement_adherence"),
      payload: (body.payload ?? {}) as Record<string, unknown>,
      externalResourceId: body.externalResourceId ? String(body.externalResourceId) : null,
      resourceVersion: body.resourceVersion ? String(body.resourceVersion) : null,
    });
    return c.json({ ok: true, providerEventId: row.providerEventId });
  });
  app.post("/__dev/dispatch", async (c) => {
    const result = await dispatchOutboxOnce({
      storage,
      config: outboundConfig,
      desktopConnectionIdFor: async (id) =>
        id === connection.id ? connection.desktopConnectionId : null,
    });
    return c.json({ ok: true, ...result });
  });

  // Bun's global isn't in the Expo tsconfig; this entry runs under bun only.
  (globalThis as unknown as {
    Bun: { serve: (opts: { port: number; fetch: typeof app.fetch }) => unknown };
  }).Bun.serve({ port, fetch: app.fetch });
  console.log(`[sync-dev] patient-sync/1 receiver listening on ${port}`);
}

main();
