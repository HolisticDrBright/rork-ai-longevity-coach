/**
 * PHI-safe logging scrubber — the single place that decides what may never
 * appear in logs, Sentry, or analytics. Extracted from sentry-middleware so
 * tRPC procedures and ad-hoc logging share one implementation.
 *
 * Policy: log shapes and outcomes, never payloads. This scrubber is
 * defense-in-depth for the cases where an object does get logged — request
 * bodies, clinical values, patient identifiers, AI prompts and drafts are
 * redacted by key.
 */

export const PHI_KEYS = new Set([
  // identity
  'firstName', 'first_name', 'lastName', 'last_name', 'fullName', 'full_name',
  'name', 'patientName', 'patient_name', 'emergencyContactName', 'emergency_contact_name',
  'email', 'phone', 'dateOfBirth', 'date_of_birth', 'birth_date', 'dob', 'mrn',
  'addressLine1', 'address_line1', 'addressLine2', 'address_line2',
  'city', 'state', 'zipCode', 'zip_code',
  'emergencyContactPhone', 'emergency_contact_phone',
  'emergencyContactRelationship', 'emergency_contact_relationship',
  // credentials
  'authorization', 'Authorization', 'sessionToken', 'session_token',
  'access_token', 'accessToken', 'refresh_token', 'refreshToken',
  'access_token_encrypted', 'refresh_token_encrypted',
  'password', 'secret', 'token', 'token_hash', 'bearer', 'apiKey', 'api_key',
]);

export const PHI_VALUE_KEYS = new Set([
  // measurements / clinical values
  'value', 'marker_value', 'markerValue',
  'glucose_avg', 'systolic_bp', 'diastolic_bp',
  'weight', 'weight_kg', 'body_fat_percent', 'height',
  'hrv', 'resting_hr', 'avg_hr', 'respiratory_rate', 'spo2',
  'dose', 'allergen', 'reaction', 'chief_complaint_json',
  'conditions', 'past_conditions', 'current_medications', 'allergies',
  'symptoms_json', 'biomarkers_json', 'supplement_name',
  // free text / AI surfaces — prompts, drafts, notes can all carry PHI
  'prompt', 'messages', 'completion', 'draft', 'body', 'content',
  'note', 'notes', 'transcript', 'question', 'answer', 'summary',
]);

export function isPHIKey(key: string): boolean {
  return PHI_KEYS.has(key) || PHI_VALUE_KEYS.has(key);
}

export function scrubObject(obj: Record<string, unknown>): Record<string, unknown> {
  const scrubbed: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (isPHIKey(key)) {
      scrubbed[key] = '[REDACTED]';
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      scrubbed[key] = scrubObject(val as Record<string, unknown>);
    } else if (Array.isArray(val)) {
      scrubbed[key] = val.map((item) =>
        item && typeof item === 'object' ? scrubObject(item as Record<string, unknown>) : item,
      );
    } else {
      scrubbed[key] = val;
    }
  }
  return scrubbed;
}

/**
 * Log a structured event with PHI scrubbed. Use this instead of
 * console.log(payload) anywhere near request data.
 */
export function logSafe(message: string, data?: Record<string, unknown>): void {
  if (data) {
    console.log(message, JSON.stringify(scrubObject(data)));
  } else {
    console.log(message);
  }
}
