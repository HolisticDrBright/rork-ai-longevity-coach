/**
 * The patient-sync/1 RECEIVER — the AI Longevity Pro half of the bridge.
 *
 * POST /patient-sync/v1/envelopes, and nothing else. Every request:
 *
 *   method + exact path binding -> content-type check (415) -> size cap
 *   (413) -> raw bytes -> HMAC verification (constant-time, timestamp
 *   window, key-id resolution) BEFORE any parsing (401) -> durable nonce
 *   replay ledger (409) -> JSON parse (400) -> EXACT contract validation
 *   (422) -> connection + organization agreement (403) -> idempotent
 *   processing -> deterministic receipts.
 *
 * Responses are sanitized ({ok,...} / {error:{code}}); nothing echoes
 * bodies, and logs carry no payloads, tokens, secrets, or PHI.
 */
import { Hono } from "hono";
import {
  CONTRACT_VERSION, MAX_BODY_BYTES, ContractViolation,
  sha256Hex, validateWireEnvelope, type WireOutboundEnvelope,
} from "./contract";
import {
  KEY_ID_HEADER, NONCE_HEADER, SIGNATURE_HEADER, TIMESTAMP_HEADER,
  SignatureViolation, verifyRequest,
} from "./hmac";
import type { SyncStorage } from "./storage";

export interface ReceiverOptions {
  storage: SyncStorage;
  resolveSecret: (keyId: string) => string | null;
  toleranceMs?: number;
  now?: () => Date;
  log?: (event: string, fields?: Record<string, string | number | boolean | null>) => void;
}

/** Deterministic receipt ids: replays of the same event mint the same ids. */
export const receiptId = (kind: string, eventUid: string) =>
  `alp-${kind}-${sha256Hex(eventUid).slice(0, 16)}`;

export interface WireReceipt {
  providerEventId: string;
  kind: "delivered" | "acknowledged";
  occurredAt: string;
  eventUid: string;
}

/** Resource types the receiver applies + auto-acknowledges in the response. */
const AUTO_ACK_TYPES = new Set(["resource_withdrawal"]);

export function createSyncReceiver(opts: ReceiverOptions) {
  const { storage, resolveSecret } = opts;
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? (() => undefined);
  const app = new Hono();

  app.post("/v1/envelopes", async (c) => {
    const contentType = c.req.header("content-type") ?? "";
    if (!/^application\/json\b/.test(contentType)) {
      return c.json({ error: { code: "unsupported_content_type" } }, 415);
    }
    const rawBody = Buffer.from(await c.req.arrayBuffer());
    if (rawBody.byteLength > MAX_BODY_BYTES) {
      return c.json({ error: { code: "payload_too_large" } }, 413);
    }

    // SIGNATURE FIRST — over the exact raw bytes, before any parsing.
    try {
      verifyRequest({
        rawBody,
        signature: c.req.header(SIGNATURE_HEADER),
        keyId: c.req.header(KEY_ID_HEADER),
        timestamp: c.req.header(TIMESTAMP_HEADER),
        nonce: c.req.header(NONCE_HEADER),
        resolveSecret,
        nowMs: now().getTime(),
        toleranceMs: opts.toleranceMs,
      });
    } catch (e) {
      const code = e instanceof SignatureViolation ? e.code : "invalid_signature";
      log("sync_refused", { code });
      return c.json({ error: { code } }, 401);
    }

    const keyId = String(c.req.header(KEY_ID_HEADER));
    const nonce = String(c.req.header(NONCE_HEADER));
    const nonceResult = await storage.registerNonce(keyId, nonce);
    if (nonceResult.replay) {
      log("sync_replay_refused", { code: "replay" });
      return c.json({ error: { code: "replay" } }, 409);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return c.json({ error: { code: "invalid_json" } }, 400);
    }

    let envelope: WireOutboundEnvelope;
    try {
      envelope = validateWireEnvelope(parsed);
    } catch (e) {
      const code = e instanceof ContractViolation ? e.code : "contract_violation";
      log("sync_contract_refused", { code });
      return c.json({ error: { code } }, 422);
    }

    // Connection + organization agreement — only the explicit identifiers
    // from the Phase 5 invitation exchange, never any patient attribute.
    const connection = await storage.getConnectionByDesktopId(envelope.connectionId);
    if (!connection) {
      log("sync_connection_refused", { code: "unknown_connection" });
      return c.json({ error: { code: "unknown_connection" } }, 403);
    }
    if (connection.desktopOrganizationId !== envelope.organizationId) {
      log("sync_connection_refused", { code: "wrong_organization" });
      return c.json({ error: { code: "wrong_organization" } }, 403);
    }
    if (connection.status !== "active") {
      log("sync_connection_refused", { code: "connection_revoked" });
      return c.json({ error: { code: "connection_revoked" } }, 403);
    }

    // Idempotency: an eventUid we already processed returns the SAME
    // receipts, marked duplicate — never a second application.
    const existing = await storage.getEnvelopeByEventUid(envelope.eventUid);
    if (existing) {
      const receipts: WireReceipt[] = existing.receiptIds.map((id) => ({
        providerEventId: id,
        kind: id.startsWith("alp-ack-") ? "acknowledged" : "delivered",
        occurredAt: existing.receivedAt,
        eventUid: existing.eventUid,
      }));
      return c.json({ ok: true, duplicate: true, receipts });
    }

    const receivedAt = now().toISOString();
    const receipts: WireReceipt[] = [
      { providerEventId: receiptId("del", envelope.eventUid), kind: "delivered", occurredAt: receivedAt, eventUid: envelope.eventUid },
    ];

    if (envelope.resourceType === "resource_withdrawal") {
      // Tombstone the referenced resource; never delete received history.
      const withdrawnType = String(envelope.payload.withdrawnResourceType ?? "");
      const withdrawnId = String(envelope.payload.resourceId ?? envelope.resourceId);
      await storage.tombstoneResource(
        connection.id, withdrawnType, withdrawnId,
        String(envelope.payload.reason ?? "withdrawn by practitioner"),
        envelope.eventUid,
      );
      await storage.appendHistory(connection.id, "resource_withdrawn", withdrawnType);
    } else {
      // Out-of-order guard: an older resourceVersion never overwrites a
      // newer one — the envelope is still received + receipted, but the
      // materialized resource keeps the newest version.
      const current = await storage.getResource(
        connection.id, envelope.resourceType, envelope.resourceId,
      );
      const stale =
        current !== null
        && !current.tombstoned
        && current.occurredAt > envelope.occurredAt;
      if (!stale) {
        await storage.upsertResource({
          connectionId: connection.id,
          resourceType: envelope.resourceType,
          resourceId: envelope.resourceId,
          resourceVersion: envelope.resourceVersion,
          scope: envelope.scope,
          payload: envelope.payload,
          provenance: envelope.provenance,
          occurredAt: envelope.occurredAt,
          updatedAt: receivedAt,
          sourceEventUid: envelope.eventUid,
          tombstoned: false,
          tombstoneReason: null,
          acknowledgedAt: null,
        });
      }
      await storage.appendHistory(
        connection.id,
        stale ? "envelope_received_stale" : "envelope_received",
        envelope.resourceType,
      );
    }

    if (AUTO_ACK_TYPES.has(envelope.resourceType)) {
      receipts.push({
        providerEventId: receiptId("ack", envelope.eventUid),
        kind: "acknowledged",
        occurredAt: receivedAt,
        eventUid: envelope.eventUid,
      });
    }

    await storage.insertEnvelope({
      connectionId: connection.id,
      eventUid: envelope.eventUid,
      idempotencyKey: envelope.idempotencyKey,
      scope: envelope.scope,
      resourceType: envelope.resourceType,
      resourceId: envelope.resourceId,
      resourceVersion: envelope.resourceVersion,
      occurredAt: envelope.occurredAt,
      payload: envelope.payload,
      payloadHash: envelope.payloadHash,
      provenance: envelope.provenance,
      correlationId: envelope.correlationId ?? null,
      causationId: envelope.causationId ?? null,
      receivedAt,
      receiptIds: receipts.map((r) => r.providerEventId),
    });

    log("sync_envelope_received", {
      resourceType: envelope.resourceType,
      scope: envelope.scope,
      contractVersion: CONTRACT_VERSION,
    });
    return c.json({ ok: true, duplicate: false, receipts });
  });

  // Anything else under the receiver is an exact-binding miss.
  app.all("*", (c) => c.json({ error: { code: "not_found" } }, 404));
  return app;
}
