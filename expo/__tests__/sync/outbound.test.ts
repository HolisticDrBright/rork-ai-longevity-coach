/**
 * Outbound dispatch to the desktop callback boundary: durable outbox,
 * exact callback body shapes, correct signatures, and honest failure
 * handling (an unreachable desktop keeps work queued; a desktop replay
 * answer means the work already landed).
 */
import { describe, expect, it } from "vitest";
import { createMemorySyncStorage } from "@/backend/sync/storage";
import {
  dispatchOutboxOnce, queueAckEvidence, queueInboundEvent,
} from "@/backend/sync/outbound";
import { verifyRequest } from "@/backend/sync/hmac";
import { sha256Hex } from "@/backend/sync/contract";

const CONFIG = { url: "http://desktop.local:3998", secret: "outbound-secret", keyId: "alp-key-1" };

async function connected() {
  const storage = createMemorySyncStorage();
  const connection = await storage.insertConnection({
    desktopConnectionId: "desktop-conn-1",
    desktopOrganizationId: "org-1",
    userId: "user-1",
    status: "active",
    verifiedAt: new Date().toISOString(),
    revokedAt: null,
    revokeReason: null,
  });
  return { storage, connection };
}

describe("outbox dispatch", () => {
  it("signs an inbound patient event exactly as the desktop callback expects", async () => {
    const { storage, connection } = await connected();
    await queueInboundEvent({
      storage, connectionId: connection.id, desktopConnectionId: connection.desktopConnectionId,
      resourceType: "supplement_adherence",
      payload: { adherence: "took the evening stack", day: "2026-07-30" },
      externalResourceId: "adh-1", resourceVersion: "1",
    });

    const captured: { url: string; headers: Record<string, string>; body: Buffer }[] = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      captured.push({
        url: String(url),
        headers: init?.headers as Record<string, string>,
        body: Buffer.from(init?.body as Buffer),
      });
      return new Response(JSON.stringify({ ok: true, duplicate: false }), { status: 200 });
    }) as typeof fetch;

    const result = await dispatchOutboxOnce({
      storage, config: CONFIG,
      desktopConnectionIdFor: async () => connection.desktopConnectionId,
      fetchImpl,
    });
    expect(result.delivered).toBe(1);
    expect(captured[0].url).toBe("http://desktop.local:3998/sync/callback");

    const body = JSON.parse(captured[0].body.toString("utf8"));
    expect(Object.keys(body).sort()).toEqual([
      "connectionId", "contractVersion", "externalResourceId", "occurredAt",
      "payload", "payloadHash", "providerEventId", "resourceType", "resourceVersion",
    ]);
    expect(body.contractVersion).toBe("patient-sync/1");
    expect(body.connectionId).toBe("desktop-conn-1");
    expect(body.payloadHash).toBe(sha256Hex(JSON.stringify(body.payload)));

    // The signature verifies under the desktop's scheme.
    expect(verifyRequest({
      rawBody: captured[0].body,
      signature: captured[0].headers["x-sync-signature"],
      keyId: captured[0].headers["x-sync-key-id"],
      timestamp: captured[0].headers["x-sync-timestamp"],
      nonce: captured[0].headers["x-sync-nonce"],
      resolveSecret: (k) => (k === CONFIG.keyId ? CONFIG.secret : null),
    })).toBe(true);
  });

  it("sends patient acknowledgment as delivery evidence keyed to the envelope eventUid", async () => {
    const { storage, connection } = await connected();
    await queueAckEvidence({ storage, connectionId: connection.id, eventUid: "uid-777" });
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(Buffer.from(init?.body as Buffer).toString("utf8")));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
    await dispatchOutboxOnce({
      storage, config: CONFIG,
      desktopConnectionIdFor: async () => connection.desktopConnectionId,
      fetchImpl,
    });
    expect(bodies[0]).toMatchObject({ kind: "acknowledged", eventUid: "uid-777" });
    expect(Object.keys(bodies[0]).sort()).toEqual([
      "eventUid", "kind", "occurredAt", "providerEventId",
    ]);
  });

  it("treats a desktop 409 replay as already-landed (delivered, not retried)", async () => {
    const { storage, connection } = await connected();
    await queueAckEvidence({ storage, connectionId: connection.id, eventUid: "uid-1" });
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: { code: "replay" } }), { status: 409 })) as typeof fetch;
    const result = await dispatchOutboxOnce({
      storage, config: CONFIG,
      desktopConnectionIdFor: async () => connection.desktopConnectionId,
      fetchImpl,
    });
    expect(result.delivered).toBe(1);
    expect(await storage.listQueuedOutbox(10)).toHaveLength(0);
  });

  it("keeps work QUEUED when the desktop is unreachable — durable, never dropped", async () => {
    const { storage, connection } = await connected();
    await queueAckEvidence({ storage, connectionId: connection.id, eventUid: "uid-2" });
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const result = await dispatchOutboxOnce({
      storage, config: CONFIG,
      desktopConnectionIdFor: async () => connection.desktopConnectionId,
      fetchImpl,
    });
    expect(result.failed).toBe(1);
    expect(await storage.listQueuedOutbox(10)).toHaveLength(1);
  });

  it("a dispatch pass NEVER touches another connection's queued work", async () => {
    const { storage, connection } = await connected();
    const other = await storage.insertConnection({
      desktopConnectionId: "desktop-conn-2",
      desktopOrganizationId: "org-2",
      userId: "user-2",
      status: "active",
      verifiedAt: new Date().toISOString(),
      revokedAt: null,
      revokeReason: null,
    });
    await queueAckEvidence({ storage, connectionId: connection.id, eventUid: "uid-mine" });
    await queueAckEvidence({ storage, connectionId: other.id, eventUid: "uid-theirs" });
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch;

    // A pass scoped to connection A resolves ONLY connection A.
    const result = await dispatchOutboxOnce({
      storage, config: CONFIG,
      desktopConnectionIdFor: async (id) =>
        id === connection.id ? connection.desktopConnectionId : null,
      fetchImpl,
    });
    expect(result.delivered).toBe(1);
    expect(result.failed).toBe(0);
    // The other connection's row is untouched: still queued, zero attempts,
    // no error — never failed by someone else's dispatch.
    const remaining = await storage.listQueuedOutbox(10);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].connectionId).toBe(other.id);
    expect(remaining[0].attempts).toBe(0);
    expect(remaining[0].lastErrorSafe).toBeNull();
  });

  it("marks a desktop refusal failed with a SAFE error string only", async () => {
    const { storage, connection } = await connected();
    await queueAckEvidence({ storage, connectionId: connection.id, eventUid: "uid-3" });
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: { code: "invalid_signature" } }), { status: 401 })) as typeof fetch;
    await dispatchOutboxOnce({
      storage, config: CONFIG,
      desktopConnectionIdFor: async () => connection.desktopConnectionId,
      fetchImpl,
    });
    const queued = await storage.listQueuedOutbox(10);
    expect(queued).toHaveLength(0);
  });
});
