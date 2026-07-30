/**
 * patient-sync/1 wire contract — RECEIVER side.
 *
 * The contract of record lives in AI Desktop Pro
 * (`src/adapters/live-types.ts`, `src/adapters/patient-sync-provider.ts`,
 * `scripts/sync/contract.mjs`, and `docs/clinical-runtime-migration.md`).
 * This module mirrors it EXACTLY — key for key, enum for enum — and fails
 * closed on anything else. Nothing here "approximately" matches: a mismatch
 * is a contract violation, refused with a typed code, never coerced.
 *
 * Wire identifier: the single self-identifying string `"patient-sync/1"`,
 * exactly as stored in the desktop's `sync_outbound_events.contract_version`
 * column, returned by `claim_sync_outbound`, and required by
 * `record_sync_inbound`.
 */
import { createHash } from "node:crypto";

export const CONTRACT_VERSION = "patient-sync/1";
export const MAX_PAYLOAD_BYTES = 65536;
export const MAX_BODY_BYTES = 65536;

/** Desktop -> patient-app resource types (desktop `queue_sync_export`). */
export const OUTBOUND_RESOURCE_TYPES = [
  "program_enrollment",
  "protocol_version",
  "supplement_instructions",
  "nutrition_plan",
  "appointment_summary",
  "message",
  "checkin_assignment",
  "lab_summary",
  "resource_withdrawal",
] as const;

/** Patient-app -> desktop resource types (desktop `record_sync_inbound`). */
export const INBOUND_RESOURCE_TYPES = [
  "program_progress",
  "quiz_response",
  "checkin_response",
  "protocol_adherence",
  "supplement_adherence",
  "symptom_report",
  "outcome_report",
  "wearable_summary",
  "patient_message",
  "appointment_request",
  "consent_change",
  "delivery_receipt",
  "read_receipt",
] as const;

/** The 11 independent consent scopes (desktop `sync_consent_scopes`). */
export const SYNC_SCOPES = [
  "programs",
  "protocols_supplements",
  "nutrition",
  "appointments",
  "messaging",
  "forms_checkins",
  "symptoms_adherence",
  "wearables",
  "lab_summaries",
  "billing_links",
  "research_n_of_1",
] as const;

export type OutboundResourceType = (typeof OUTBOUND_RESOURCE_TYPES)[number];
export type InboundResourceType = (typeof INBOUND_RESOURCE_TYPES)[number];
export type SyncScope = (typeof SYNC_SCOPES)[number];

/**
 * The wire envelope the desktop adapter POSTs to this receiver — the
 * projection of the desktop's PatientSyncOutboundEnvelopeV1 the two sides
 * agreed on. Worker-internal fields (eventId, attempts, leaseExpiresAt)
 * never cross the wire.
 */
export interface WireOutboundEnvelope {
  contractVersion: typeof CONTRACT_VERSION;
  eventUid: string;
  idempotencyKey: string;
  organizationId: string;
  connectionId: string;
  scope: SyncScope;
  resourceType: OutboundResourceType;
  resourceId: string;
  resourceVersion: string;
  occurredAt: string;
  producer: "desktop";
  provenance: Record<string, unknown>;
  payload: Record<string, unknown>;
  payloadHash: string;
  correlationId: string | null;
  causationId: string | null;
}

const REQUIRED_KEYS = [
  "contractVersion", "eventUid", "idempotencyKey", "organizationId",
  "connectionId", "scope", "resourceType", "resourceId", "resourceVersion",
  "occurredAt", "producer", "provenance", "payload", "payloadHash",
] as const;
const OPTIONAL_KEYS = ["correlationId", "causationId"] as const;
const KNOWN_KEYS = new Set<string>([...REQUIRED_KEYS, ...OPTIONAL_KEYS]);

export class ContractViolation extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ContractViolation";
    this.code = code;
  }
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Validate a parsed wire envelope EXACTLY. Unknown keys, missing keys, an
 * unexpected contract version, a wrong producer, an unknown scope or
 * resource type, an oversized payload, or a hash that does not match the
 * payload's canonical JSON text all throw ContractViolation.
 */
export function validateWireEnvelope(raw: unknown): WireOutboundEnvelope {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ContractViolation("not_an_object", "envelope is not an object");
  }
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!KNOWN_KEYS.has(key)) {
      throw new ContractViolation("unknown_field", `unknown envelope field: ${key}`);
    }
  }
  for (const key of REQUIRED_KEYS) {
    if (obj[key] === undefined || obj[key] === null) {
      throw new ContractViolation("missing_field", `missing envelope field: ${key}`);
    }
  }
  if (obj.contractVersion !== CONTRACT_VERSION) {
    throw new ContractViolation(
      "unsupported_contract_version",
      `unsupported contract version: ${String(obj.contractVersion)}`,
    );
  }
  if (obj.producer !== "desktop") {
    throw new ContractViolation("unknown_producer", `unknown producer: ${String(obj.producer)}`);
  }
  if (!SYNC_SCOPES.includes(obj.scope as SyncScope)) {
    throw new ContractViolation("unknown_scope", `unknown scope: ${String(obj.scope)}`);
  }
  if (!OUTBOUND_RESOURCE_TYPES.includes(obj.resourceType as OutboundResourceType)) {
    throw new ContractViolation(
      "unknown_resource_type",
      `unknown resource type: ${String(obj.resourceType)}`,
    );
  }
  for (const key of ["eventUid", "idempotencyKey", "organizationId", "connectionId",
    "resourceId", "resourceVersion", "occurredAt"] as const) {
    if (typeof obj[key] !== "string" || (obj[key] as string).length === 0) {
      throw new ContractViolation("invalid_field", `${key} must be a non-empty string`);
    }
  }
  if (!Number.isFinite(Date.parse(obj.occurredAt as string))) {
    throw new ContractViolation("invalid_timestamp", "occurredAt is not a valid timestamp");
  }
  if (typeof obj.provenance !== "object" || Array.isArray(obj.provenance)) {
    throw new ContractViolation("invalid_field", "provenance must be an object");
  }
  if (typeof obj.payload !== "object" || Array.isArray(obj.payload)) {
    throw new ContractViolation("payload_not_object", "payload must be an object");
  }
  const payloadText = JSON.stringify(obj.payload);
  if (Buffer.byteLength(payloadText, "utf8") > MAX_PAYLOAD_BYTES) {
    throw new ContractViolation("payload_too_large", "payload exceeds the size limit");
  }
  if (typeof obj.payloadHash !== "string" || !/^[0-9a-f]{64}$/.test(obj.payloadHash)) {
    throw new ContractViolation("malformed_hash", "payloadHash is not a sha256 hex digest");
  }
  if (sha256Hex(payloadText) !== obj.payloadHash) {
    throw new ContractViolation("payload_hash_mismatch", "payloadHash does not match payload");
  }
  return obj as unknown as WireOutboundEnvelope;
}
