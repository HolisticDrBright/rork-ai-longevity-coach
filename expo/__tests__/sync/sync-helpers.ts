import { sha256Hex, CONTRACT_VERSION, type WireOutboundEnvelope } from "@/backend/sync/contract";
import { signRequest } from "@/backend/sync/hmac";

export const INBOUND_SECRET = "test-inbound-secret";
export const INBOUND_KEY_ID = "desktop-key-1";
export const DESKTOP_CONNECTION_ID = "6f000000-0000-4000-8000-600000000001";
export const DESKTOP_ORG_ID = "6f000000-0000-4000-8000-600000000002";
export const PATIENT_USER_ID = "6f000000-0000-4000-8000-600000000003";

let uidSeq = 0;

export function buildEnvelope(
  overrides: Partial<WireOutboundEnvelope> = {},
): WireOutboundEnvelope {
  const payload = overrides.payload ?? { title: "Longevity protocol v2", status: "approved" };
  uidSeq += 1;
  return {
    contractVersion: CONTRACT_VERSION,
    eventUid: `e2e-uid-${String(uidSeq).padStart(4, "0")}`,
    idempotencyKey: `conn:protocol_version:res-1:${uidSeq}`,
    organizationId: DESKTOP_ORG_ID,
    connectionId: DESKTOP_CONNECTION_ID,
    scope: "protocols_supplements",
    resourceType: "protocol_version",
    resourceId: "res-1",
    resourceVersion: String(uidSeq),
    occurredAt: new Date().toISOString(),
    producer: "desktop",
    provenance: { producer: "desktop", practitionerReviewed: true },
    payload,
    payloadHash: sha256Hex(JSON.stringify(payload)),
    correlationId: null,
    causationId: null,
    ...overrides,
  };
}

export function signedHeaders(rawBody: string | Buffer, opts: {
  secret?: string;
  keyId?: string;
  timestamp?: number;
  nonce?: string;
} = {}): Record<string, string> {
  const timestamp = opts.timestamp ?? Date.now();
  const nonce = opts.nonce ?? `nonce-${Math.random().toString(36).slice(2)}-${++uidSeq}`;
  return {
    "content-type": "application/json",
    "x-sync-signature": signRequest({
      rawBody: Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, "utf8"),
      secret: opts.secret ?? INBOUND_SECRET,
      timestamp,
      nonce,
    }),
    "x-sync-key-id": opts.keyId ?? INBOUND_KEY_ID,
    "x-sync-timestamp": String(timestamp),
    "x-sync-nonce": nonce,
  };
}
