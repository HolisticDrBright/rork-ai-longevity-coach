/**
 * Outbound dispatch: signed callbacks from AI Longevity Pro TO the desktop
 * worker's callback boundary.
 *
 * Two callback shapes, exactly as the desktop callback server routes them:
 *   - delivery evidence:   { kind, eventUid, providerEventId, occurredAt }
 *   - inbound envelope:    { connectionId, providerEventId, contractVersion,
 *                            resourceType, payload, payloadHash, occurredAt,
 *                            externalResourceId?, resourceVersion? }
 *
 * Everything leaves through a durable outbox: queued rows survive restarts,
 * a delivery marks the row delivered, failures stay queued/failed for the
 * next pass — never silently dropped, never duplicated (the desktop dedupes
 * on (connection, providerEventId)).
 */
import { randomUUID } from "node:crypto";
import { CONTRACT_VERSION, sha256Hex } from "./contract";
import { signRequest } from "./hmac";
import type { SyncStorage, SyncOutboxRow } from "./storage";

export interface OutboundConfig {
  url: string;
  secret: string;
  keyId: string;
}

export async function postSignedCallback(opts: {
  config: OutboundConfig;
  body: Record<string, unknown>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
  nonce?: string;
}): Promise<{ status: number; body: unknown }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const rawBody = Buffer.from(JSON.stringify(opts.body), "utf8");
  const timestamp = (opts.now ?? Date.now)();
  const nonce = opts.nonce ?? randomUUID();
  const signature = signRequest({ rawBody, secret: opts.config.secret, timestamp, nonce });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  try {
    const response = await fetchImpl(`${opts.config.url}/sync/callback`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sync-signature": signature,
        "x-sync-key-id": opts.config.keyId,
        "x-sync-timestamp": String(timestamp),
        "x-sync-nonce": nonce,
      },
      body: rawBody,
      signal: controller.signal,
    });
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }
    return { status: response.status, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}

/** Queue a patient-generated inbound event for delivery to the desktop. */
export async function queueInboundEvent(opts: {
  storage: SyncStorage;
  connectionId: string;
  desktopConnectionId: string;
  resourceType: string;
  payload: Record<string, unknown>;
  externalResourceId?: string | null;
  resourceVersion?: string | null;
  occurredAt?: string;
}): Promise<SyncOutboxRow> {
  const occurredAt = opts.occurredAt ?? new Date().toISOString();
  return opts.storage.queueOutbox({
    connectionId: opts.connectionId,
    providerEventId: `alp-in-${randomUUID()}`,
    resourceType: opts.resourceType,
    payload: opts.payload,
    payloadHash: sha256Hex(JSON.stringify(opts.payload)),
    occurredAt,
    externalResourceId: opts.externalResourceId ?? null,
    resourceVersion: opts.resourceVersion ?? null,
  });
}

/** Queue delivery evidence (e.g. a patient acknowledgment) for an envelope. */
export async function queueAckEvidence(opts: {
  storage: SyncStorage;
  connectionId: string;
  eventUid: string;
}): Promise<SyncOutboxRow> {
  const occurredAt = new Date().toISOString();
  const payload = { kind: "acknowledged", eventUid: opts.eventUid };
  return opts.storage.queueOutbox({
    connectionId: opts.connectionId,
    providerEventId: `alp-ack-${sha256Hex(opts.eventUid).slice(0, 16)}`,
    resourceType: "delivery_receipt",
    payload,
    payloadHash: sha256Hex(JSON.stringify(payload)),
    occurredAt,
    externalResourceId: opts.eventUid,
    resourceVersion: null,
  });
}

/**
 * One dispatch pass over the outbox. Delivered rows are marked delivered;
 * refusals record a SAFE error string. A 409 replay or duplicate:true from
 * the desktop means the work already landed — that is success, not failure.
 */
export async function dispatchOutboxOnce(opts: {
  storage: SyncStorage;
  config: OutboundConfig;
  desktopConnectionIdFor: (connectionId: string) => Promise<string | null>;
  fetchImpl?: typeof fetch;
  limit?: number;
  log?: (event: string, fields?: Record<string, string | number | boolean | null>) => void;
}): Promise<{ delivered: number; failed: number }> {
  const log = opts.log ?? (() => undefined);
  const rows = await opts.storage.listQueuedOutbox(opts.limit ?? 20);
  let delivered = 0;
  let failed = 0;
  for (const row of rows) {
    const desktopConnectionId = await opts.desktopConnectionIdFor(row.connectionId);
    if (!desktopConnectionId) {
      await opts.storage.markOutbox(row.id, "failed", "connection_missing");
      failed += 1;
      continue;
    }
    const body: Record<string, unknown> =
      row.resourceType === "delivery_receipt" && typeof row.payload.eventUid === "string"
        ? {
            kind: String(row.payload.kind ?? "acknowledged"),
            eventUid: String(row.payload.eventUid),
            providerEventId: row.providerEventId,
            occurredAt: row.occurredAt,
          }
        : {
            connectionId: desktopConnectionId,
            providerEventId: row.providerEventId,
            contractVersion: CONTRACT_VERSION,
            resourceType: row.resourceType,
            payload: row.payload,
            payloadHash: row.payloadHash,
            occurredAt: row.occurredAt,
            externalResourceId: row.externalResourceId,
            resourceVersion: row.resourceVersion,
          };
    try {
      const result = await postSignedCallback({
        config: opts.config, body, fetchImpl: opts.fetchImpl,
      });
      if (result.status === 200 || result.status === 409) {
        await opts.storage.markOutbox(row.id, "delivered");
        delivered += 1;
      } else {
        await opts.storage.markOutbox(row.id, "failed", `desktop_${result.status}`);
        failed += 1;
        log("sync_outbox_refused", { status: result.status, resourceType: row.resourceType });
      }
    } catch {
      // Unreachable desktop: keep the row queued for the next pass.
      await opts.storage.markOutbox(row.id, "queued", "desktop_unreachable");
      failed += 1;
      log("sync_outbox_unreachable", { resourceType: row.resourceType });
    }
  }
  return { delivered, failed };
}
