/**
 * Patient-facing sync procedures — regression coverage for review findings.
 *
 * The revoke regression exists because an early draft queued a
 * connection-level consent_change; the desktop's record_sync_inbound
 * requires a SCOPE on consent_change (SQLSTATE 22023), so that event could
 * never land. Revocation enforcement is structural (403
 * connection_revoked on every future delivery), and the outbox must stay
 * free of out-of-contract events.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "@/backend/trpc/app-router";
import { setSyncStorageForTesting } from "@/backend/sync/service";
import { createMemorySyncStorage, type SyncStorage } from "@/backend/sync/storage";
import { DESKTOP_CONNECTION_ID, DESKTOP_ORG_ID, PATIENT_USER_ID } from "./sync-helpers";

let storage: SyncStorage;
let connectionId = "";

const ctx = {
  user: { id: PATIENT_USER_ID, email: "patient@test.local", role: "authenticated" },
  sessionToken: "test-jwt",
  req: new Request("http://localhost"),
};

const caller = () => appRouter.createCaller(ctx as never).sync;

beforeEach(async () => {
  vi.stubEnv("PATIENT_SYNC_ENABLED", "true");
  vi.stubEnv("PATIENT_SYNC_INBOUND_SECRET", "s-in");
  vi.stubEnv("PATIENT_SYNC_INBOUND_KEY_ID", "desktop-key-1");
  vi.stubEnv("PATIENT_SYNC_OUTBOUND_URL", "http://desktop.local:3998");
  vi.stubEnv("PATIENT_SYNC_OUTBOUND_SECRET", "s-out");
  vi.stubEnv("PATIENT_SYNC_OUTBOUND_KEY_ID", "alp-key-1");
  storage = createMemorySyncStorage();
  setSyncStorageForTesting(storage);
  const row = await storage.insertConnection({
    desktopConnectionId: DESKTOP_CONNECTION_ID,
    desktopOrganizationId: DESKTOP_ORG_ID,
    userId: PATIENT_USER_ID,
    status: "active",
    verifiedAt: new Date().toISOString(),
    revokedAt: null,
    revokeReason: null,
  });
  connectionId = row.id;
});

afterEach(() => {
  setSyncStorageForTesting(null);
  vi.unstubAllEnvs();
});

describe("sync.revoke", () => {
  it("revokes immediately and NEVER queues an out-of-contract consent_change", async () => {
    const result = await caller().revoke({ reason: "patient chose to disconnect" });
    expect(result.ok).toBe(true);
    const connection = await storage.getConnectionForUser(PATIENT_USER_ID);
    expect(connection?.status).toBe("revoked");
    expect(connection?.revokeReason).toBe("patient chose to disconnect");
    // The regression: nothing in the outbox — a scope-less consent_change
    // would be refused by the desktop (22023) and could never land.
    expect(await storage.listQueuedOutbox(50)).toHaveLength(0);
    const history = await storage.listHistory(connectionId);
    expect(history.some((h) => h.kind === "connection_revoked_by_patient")).toBe(true);
  });

  it("requires a reason and an active connection", async () => {
    await expect(caller().revoke({ reason: "" })).rejects.toThrowError();
    await caller().revoke({ reason: "first revoke" });
    await expect(caller().revoke({ reason: "second revoke" })).rejects.toThrowError(/No active/i);
  });
});

describe("sync.submitEvent", () => {
  it("queues ONLY contract-listed patient event types with hashed payloads", async () => {
    const result = await caller().submitEvent({
      resourceType: "supplement_adherence",
      payload: { adherence: "took the evening stack", day: "2026-07-30" },
      externalResourceId: "adh-r-1",
      resourceVersion: "1",
    });
    expect(result.ok).toBe(true);
    const queued = await storage.listQueuedOutbox(10);
    expect(queued).toHaveLength(1);
    expect(queued[0].resourceType).toBe("supplement_adherence");
    await expect(
      caller().submitEvent({
        resourceType: "consent_change" as never,
        payload: { action: "revoke_connection" },
      }),
    ).rejects.toThrowError();
  });
});
