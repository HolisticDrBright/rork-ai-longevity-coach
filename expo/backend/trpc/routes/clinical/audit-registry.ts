/**
 * Server-owned audit event registry (Phase 0).
 *
 * The audit trail stores identifiers and operational facts — never free-form
 * clinical content. Browsers therefore may NOT supply `action`, display text,
 * or arbitrary metadata: they name a registered event type and pass only the
 * metadata keys that event declares. Everything else — the stored action
 * string, resource type, and human-readable display text — is generated here,
 * server-side. Unknown event types, unknown metadata keys, wrong value types,
 * and oversized values are rejected before anything reaches the database
 * (which enforces its own caps again in record_audit_event, migration 0018).
 *
 * Domain events written by SECURITY DEFINER RPCs (biomarker.review,
 * review_task.resolve, lab_document.ingest, appointment.*) do not pass
 * through this registry — their content is composed inside the database
 * functions and is already server-owned.
 */

export type MetaScalar = string | number | boolean;

interface MetaSpec {
  type: 'string' | 'number' | 'boolean';
  /** For strings: hard length cap. */
  maxLength?: number;
  /** For strings: closed vocabulary when applicable. */
  oneOf?: string[];
}

export interface AuditEventSpec {
  /** Stored `action` — lowercase dotted, set by the server. */
  action: string;
  resourceType: string | null;
  /** Whether a patient reference is required / allowed / forbidden. */
  patient: 'required' | 'optional' | 'forbidden';
  resourceIdRequired?: boolean;
  /** The ONLY metadata keys accepted, with their types and caps. */
  metadata: Record<string, MetaSpec>;
  /** Server-generated display text — from validated metadata only. */
  display: (meta: Record<string, MetaScalar>) => string;
}

const DRAFT_KINDS = [
  'soap',
  'narrative',
  'follow-up',
  'referral',
  'patient-instructions',
  'lab-summary',
  'protocol-summary',
  'letter',
];

export const AUDIT_EVENTS: Record<string, AuditEventSpec> = {
  'chart.open': {
    action: 'chart.open',
    resourceType: 'patient',
    patient: 'required',
    metadata: {},
    display: () => 'Chart opened',
  },
  'chart.export_requested': {
    action: 'chart.export_requested',
    resourceType: 'patient',
    patient: 'required',
    metadata: {
      format: { type: 'string', oneOf: ['pdf', 'ccda', 'fhir', 'csv'] },
    },
    display: (m) => `Chart export requested (${String(m.format ?? 'unspecified')})`,
  },
  'note.draft_created': {
    action: 'note.draft_created',
    resourceType: 'note_draft',
    patient: 'required',
    metadata: {
      draft_kind: { type: 'string', oneOf: DRAFT_KINDS },
    },
    display: (m) => `Draft created (${String(m.draft_kind ?? 'unspecified')})`,
  },
  'document.viewed': {
    action: 'document.viewed',
    resourceType: 'lab_document',
    patient: 'required',
    resourceIdRequired: true,
    metadata: {},
    display: () => 'Source document viewed',
  },
  'settings.data_source_viewed': {
    action: 'settings.data_source_viewed',
    resourceType: null,
    patient: 'forbidden',
    metadata: {},
    display: () => 'Data source panel viewed',
  },
};

const MAX_STRING = 200;
const MAX_SERIALIZED = 1536;

export class AuditValidationError extends Error {}

/**
 * Validate a client submission against the registry. Returns the server-owned
 * row fields. Throws AuditValidationError with a safe message on any drift.
 */
export function buildRegistryEvent(input: {
  eventType: string;
  patientId?: string | null;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
}): {
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  safeMessage: string;
  metadata: Record<string, MetaScalar>;
} {
  const spec = AUDIT_EVENTS[input.eventType];
  if (!spec) throw new AuditValidationError('Unknown audit event type');

  if (spec.patient === 'required' && !input.patientId) {
    throw new AuditValidationError('This event requires a patient reference');
  }
  if (spec.patient === 'forbidden' && input.patientId) {
    throw new AuditValidationError('This event must not reference a patient');
  }
  if (spec.resourceIdRequired && !input.resourceId) {
    throw new AuditValidationError('This event requires a resource id');
  }

  const raw = input.metadata ?? {};
  const clean: Record<string, MetaScalar> = {};
  for (const [key, value] of Object.entries(raw)) {
    const meta = spec.metadata[key];
    if (!meta) throw new AuditValidationError(`Unknown metadata key: ${key}`);
    if (meta.type === 'string') {
      if (typeof value !== 'string') throw new AuditValidationError(`${key} must be a string`);
      if (value.length > (meta.maxLength ?? MAX_STRING)) {
        throw new AuditValidationError(`${key} is too long`);
      }
      if (meta.oneOf && !meta.oneOf.includes(value)) {
        throw new AuditValidationError(`${key} has an unrecognized value`);
      }
      clean[key] = value;
    } else if (meta.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new AuditValidationError(`${key} must be a number`);
      }
      clean[key] = value;
    } else {
      if (typeof value !== 'boolean') throw new AuditValidationError(`${key} must be a boolean`);
      clean[key] = value;
    }
  }
  // Required-key check: every declared key with a closed vocabulary is optional
  // by default; events declare requirements via display() falling back safely.

  if (JSON.stringify(clean).length > MAX_SERIALIZED) {
    throw new AuditValidationError('Metadata too large');
  }

  return {
    action: spec.action,
    resourceType: spec.resourceType,
    resourceId: input.resourceId ?? null,
    safeMessage: spec.display(clean),
    metadata: clean,
  };
}
