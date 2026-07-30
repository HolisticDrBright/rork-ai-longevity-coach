/**
 * patient-sync/1 contract — EXACT parity with the AI Desktop Pro contract
 * of record, plus fail-closed validation. A drift in keys, enums, or the
 * version identifier fails here before it can fail in production.
 */
import { describe, expect, it } from "vitest";
import {
  CONTRACT_VERSION, INBOUND_RESOURCE_TYPES, MAX_PAYLOAD_BYTES,
  OUTBOUND_RESOURCE_TYPES, SYNC_SCOPES, ContractViolation,
  sha256Hex, validateWireEnvelope,
} from "@/backend/sync/contract";
import { buildEnvelope } from "./sync-helpers";

describe("contract parity with the desktop contract of record", () => {
  it("uses the exact wire version identifier", () => {
    expect(CONTRACT_VERSION).toBe("patient-sync/1");
  });

  it("carries exactly the desktop's 9 outbound resource types", () => {
    expect([...OUTBOUND_RESOURCE_TYPES].sort()).toEqual([
      "appointment_summary", "checkin_assignment", "lab_summary", "message",
      "nutrition_plan", "program_enrollment", "protocol_version",
      "resource_withdrawal", "supplement_instructions",
    ]);
  });

  it("carries exactly the desktop's 13 inbound resource types", () => {
    expect([...INBOUND_RESOURCE_TYPES].sort()).toEqual([
      "appointment_request", "checkin_response", "consent_change",
      "delivery_receipt", "outcome_report", "patient_message",
      "program_progress", "protocol_adherence", "quiz_response",
      "read_receipt", "supplement_adherence", "symptom_report",
      "wearable_summary",
    ]);
  });

  it("carries exactly the desktop's 11 consent scopes", () => {
    expect([...SYNC_SCOPES].sort()).toEqual([
      "appointments", "billing_links", "forms_checkins", "lab_summaries",
      "messaging", "nutrition", "programs", "protocols_supplements",
      "research_n_of_1", "symptoms_adherence", "wearables",
    ]);
  });

  it("accepts exactly the agreed wire keys and nothing else", () => {
    const envelope = buildEnvelope();
    expect(Object.keys(envelope).sort()).toEqual([
      "causationId", "connectionId", "contractVersion", "correlationId",
      "eventUid", "idempotencyKey", "occurredAt", "organizationId",
      "payload", "payloadHash", "producer", "provenance", "resourceId",
      "resourceType", "resourceVersion", "scope",
    ]);
    expect(() => validateWireEnvelope(envelope)).not.toThrow();
  });

  it("matches the desktop's payload size limit", () => {
    expect(MAX_PAYLOAD_BYTES).toBe(65536);
  });
});

describe("fail-closed validation", () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ["unknown field", { ...buildEnvelope(), surprise: 1 }, "unknown_field"],
    ["missing field", (() => { const e: Record<string, unknown> = { ...buildEnvelope() }; delete e.eventUid; return e; })(), "missing_field"],
    ["wrong contract version", { ...buildEnvelope(), contractVersion: "patient-sync/2" }, "unsupported_contract_version"],
    ["numeric contract version is NOT silently accepted", { ...buildEnvelope(), contractVersion: 1 }, "unsupported_contract_version"],
    ["wrong producer", { ...buildEnvelope(), producer: "mobile" }, "unknown_producer"],
    ["unknown scope", { ...buildEnvelope(), scope: "everything" }, "unknown_scope"],
    ["unknown resource type", { ...buildEnvelope(), resourceType: "raw_note" }, "unknown_resource_type"],
    ["malformed hash", { ...buildEnvelope(), payloadHash: "zz" }, "malformed_hash"],
    ["array payload", { ...buildEnvelope(), payload: [1, 2] as unknown as Record<string, unknown> }, "payload_not_object"],
    ["invalid timestamp", { ...buildEnvelope(), occurredAt: "yesterday-ish" }, "invalid_timestamp"],
  ];
  for (const [name, raw, code] of cases) {
    it(`refuses ${name} (${code})`, () => {
      try {
        validateWireEnvelope(raw);
        throw new Error("expected refusal");
      } catch (e) {
        expect(e).toBeInstanceOf(ContractViolation);
        expect((e as ContractViolation).code).toBe(code);
      }
    });
  }

  it("refuses a hash that does not match the payload", () => {
    const envelope = buildEnvelope();
    envelope.payloadHash = sha256Hex(JSON.stringify({ tampered: true }));
    try {
      validateWireEnvelope(envelope);
      throw new Error("expected refusal");
    } catch (e) {
      expect((e as ContractViolation).code).toBe("payload_hash_mismatch");
    }
  });

  it("refuses an oversized payload", () => {
    const envelope = buildEnvelope({ payload: { pad: "x".repeat(70000) } });
    envelope.payloadHash = sha256Hex(JSON.stringify(envelope.payload));
    try {
      validateWireEnvelope(envelope);
      throw new Error("expected refusal");
    } catch (e) {
      expect((e as ContractViolation).code).toBe("payload_too_large");
    }
  });
});
