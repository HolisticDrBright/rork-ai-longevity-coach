/**
 * The patient-sync/1 receiver boundary, driven through real HTTP semantics
 * (Hono app.request) against in-memory storage. Signature-before-parse,
 * replay, idempotency, out-of-order, tombstones, tenant agreement — every
 * refusal is a typed, PHI-free code.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createSyncReceiver, receiptId } from "@/backend/sync/receiver";
import { createMemorySyncStorage, type SyncStorage } from "@/backend/sync/storage";
import { sha256Hex } from "@/backend/sync/contract";
import {
  DESKTOP_CONNECTION_ID, DESKTOP_ORG_ID, INBOUND_KEY_ID, INBOUND_SECRET,
  PATIENT_USER_ID, buildEnvelope, signedHeaders,
} from "./sync-helpers";

let storage: SyncStorage;
let app: ReturnType<typeof createSyncReceiver>;
let connectionRowId = "";

const post = (rawBody: string, headers: Record<string, string>) =>
  app.request("/v1/envelopes", { method: "POST", headers, body: rawBody });

beforeEach(async () => {
  storage = createMemorySyncStorage();
  const row = await storage.insertConnection({
    desktopConnectionId: DESKTOP_CONNECTION_ID,
    desktopOrganizationId: DESKTOP_ORG_ID,
    userId: PATIENT_USER_ID,
    status: "active",
    verifiedAt: new Date().toISOString(),
    revokedAt: null,
    revokeReason: null,
  });
  connectionRowId = row.id;
  app = createSyncReceiver({
    storage,
    resolveSecret: (keyId) => (keyId === INBOUND_KEY_ID ? INBOUND_SECRET : null),
  });
});

describe("signed delivery", () => {
  it("accepts a valid signed envelope and returns a deterministic delivered receipt", async () => {
    const envelope = buildEnvelope();
    const raw = JSON.stringify(envelope);
    const res = await post(raw, signedHeaders(raw));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.duplicate).toBe(false);
    expect(body.receipts).toHaveLength(1);
    expect(body.receipts[0]).toMatchObject({
      kind: "delivered",
      eventUid: envelope.eventUid,
      providerEventId: receiptId("del", envelope.eventUid),
    });
    const resource = await storage.getResource(connectionRowId, "protocol_version", "res-1");
    expect(resource?.resourceVersion).toBe(envelope.resourceVersion);
    expect(resource?.provenance.practitionerReviewed).toBe(true);
  });

  it("re-delivery of the same eventUid is idempotent: same receipts, marked duplicate, applied once", async () => {
    const envelope = buildEnvelope();
    const raw = JSON.stringify(envelope);
    const first = await (await post(raw, signedHeaders(raw))).json();
    const second = await (await post(raw, signedHeaders(raw))).json();
    expect(second.duplicate).toBe(true);
    expect(second.receipts.map((r: { providerEventId: string }) => r.providerEventId))
      .toEqual(first.receipts.map((r: { providerEventId: string }) => r.providerEventId));
    const history = await storage.listHistory(connectionRowId);
    expect(history.filter((h) => h.kind === "envelope_received")).toHaveLength(1);
  });

  it("an out-of-order OLDER version never overwrites a newer resource, but is still receipted", async () => {
    const newer = buildEnvelope({
      resourceVersion: "9", occurredAt: "2026-07-30T12:00:00.000Z",
      payload: { title: "v9" }, payloadHash: sha256Hex(JSON.stringify({ title: "v9" })),
    });
    const older = buildEnvelope({
      resourceVersion: "3", occurredAt: "2026-07-30T09:00:00.000Z",
      payload: { title: "v3" }, payloadHash: sha256Hex(JSON.stringify({ title: "v3" })),
    });
    const rawNewer = JSON.stringify(newer);
    const rawOlder = JSON.stringify(older);
    expect((await post(rawNewer, signedHeaders(rawNewer))).status).toBe(200);
    const late = await post(rawOlder, signedHeaders(rawOlder));
    expect(late.status).toBe(200);
    const resource = await storage.getResource(connectionRowId, "protocol_version", "res-1");
    expect(resource?.resourceVersion).toBe("9");
    const history = await storage.listHistory(connectionRowId);
    expect(history.some((h) => h.kind === "envelope_received_stale")).toBe(true);
  });

  it("a resource_withdrawal tombstones the target and auto-acknowledges", async () => {
    const share = buildEnvelope();
    const rawShare = JSON.stringify(share);
    await post(rawShare, signedHeaders(rawShare));

    const withdrawalPayload = {
      withdrawnResourceType: "protocol_version", resourceId: "res-1",
      reason: "superseded by an in-person plan",
    };
    const withdrawal = buildEnvelope({
      resourceType: "resource_withdrawal",
      payload: withdrawalPayload,
      payloadHash: sha256Hex(JSON.stringify(withdrawalPayload)),
    });
    const raw = JSON.stringify(withdrawal);
    const res = await post(raw, signedHeaders(raw));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.receipts.map((r: { kind: string }) => r.kind)).toEqual(["delivered", "acknowledged"]);
    const resource = await storage.getResource(connectionRowId, "protocol_version", "res-1");
    expect(resource?.tombstoned).toBe(true);
    expect(resource?.payload).toEqual({});
    // The envelope history is preserved — a tombstone is not a delete.
    expect(await storage.getEnvelopeByEventUid(share.eventUid)).not.toBeNull();
  });
});

describe("security boundary", () => {
  it("refuses a tampered body: constant-time signature mismatch, never parsed", async () => {
    const envelope = buildEnvelope();
    const raw = JSON.stringify(envelope);
    const headers = signedHeaders(raw);
    const res = await post(raw.replace("approved", "tampered"), headers);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("invalid_signature");
  });

  it("refuses unsigned garbage as a SIGNATURE failure (parse never ran)", async () => {
    const res = await post("{not json", { "content-type": "application/json" });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("missing_signature_headers");
  });

  it("refuses an expired timestamp", async () => {
    const raw = JSON.stringify(buildEnvelope());
    const res = await post(raw, signedHeaders(raw, { timestamp: Date.now() - 10 * 60_000 }));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("timestamp_outside_tolerance");
  });

  it("refuses an unknown key id", async () => {
    const raw = JSON.stringify(buildEnvelope());
    const res = await post(raw, signedHeaders(raw, { keyId: "rotated-away" }));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unknown_key_id");
  });

  it("refuses a replayed nonce durably", async () => {
    const raw = JSON.stringify(buildEnvelope());
    const headers = signedHeaders(raw, { nonce: "nonce-replay-1" });
    expect((await post(raw, headers)).status).toBe(200);
    const replay = await post(raw, headers);
    expect(replay.status).toBe(409);
    expect((await replay.json()).error.code).toBe("replay");
  });

  it("valid signature + invalid JSON is 400 — proving parse comes AFTER the signature", async () => {
    const raw = "{definitely not json";
    const res = await post(raw, signedHeaders(raw));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_json");
  });

  it("refuses oversize bodies (413) and wrong content types (415)", async () => {
    const bigPayload = { pad: "x".repeat(70000) };
    const big = JSON.stringify(buildEnvelope({
      payload: bigPayload, payloadHash: sha256Hex(JSON.stringify(bigPayload)),
    }));
    expect((await post(big, signedHeaders(big))).status).toBe(413);

    const raw = JSON.stringify(buildEnvelope());
    const wrongType = await post(raw, { ...signedHeaders(raw), "content-type": "text/plain" });
    expect(wrongType.status).toBe(415);
  });

  it("binds the endpoint exactly: other paths and methods are 404", async () => {
    expect((await app.request("/v1/envelopes", { method: "GET" })).status).toBe(404);
    expect((await app.request("/v1/other", { method: "POST" })).status).toBe(404);
  });
});

describe("connection and tenant agreement", () => {
  it("refuses an unknown connection id without leaking anything", async () => {
    const raw = JSON.stringify(buildEnvelope({ connectionId: "6f000000-0000-4000-8000-999999999999" }));
    const res = await post(raw, signedHeaders(raw));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("unknown_connection");
  });

  it("refuses a cross-organization envelope for a real connection", async () => {
    const raw = JSON.stringify(buildEnvelope({ organizationId: "some-other-org" }));
    const res = await post(raw, signedHeaders(raw));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("wrong_organization");
  });

  it("refuses deliveries to a revoked connection — revocation is immediate", async () => {
    await storage.revokeConnection(connectionRowId, "patient disconnected");
    const raw = JSON.stringify(buildEnvelope());
    const res = await post(raw, signedHeaders(raw));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("connection_revoked");
  });

  it("refuses a contract violation with a typed 422", async () => {
    const raw = JSON.stringify({ ...buildEnvelope(), surprise: true });
    const res = await post(raw, signedHeaders(raw));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("unknown_field");
  });
});
