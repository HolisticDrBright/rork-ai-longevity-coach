export function createMockQueryBuilder(resolvedData: {
  data?: unknown;
  error?: unknown;
  count?: number;
}) {
  const builder: Record<string, unknown> = {};

  const chainMethods = [
    'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte',
    'in', 'not', 'or', 'and',
    'order', 'limit', 'range',
    'is', 'ilike',
  ];

  for (const method of chainMethods) {
    builder[method] = () => builder;
  }

  builder.single = () =>
    Promise.resolve({
      data: resolvedData.data ?? null,
      error: resolvedData.error ?? null,
      count: resolvedData.count ?? null,
    });

  builder.then = (resolve: (val: unknown) => void) =>
    resolve({
      data: Array.isArray(resolvedData.data) ? resolvedData.data : resolvedData.data ? [resolvedData.data] : [],
      error: resolvedData.error ?? null,
      count: resolvedData.count ?? (Array.isArray(resolvedData.data) ? resolvedData.data.length : 0),
    });

  return builder;
}

export function createMockSupabaseClient(tableHandlers: Record<string, ReturnType<typeof createMockQueryBuilder>>) {
  return {
    from: (table: string) => {
      if (tableHandlers[table]) {
        return tableHandlers[table];
      }
      return createMockQueryBuilder({ data: [], error: null });
    },
    auth: {
      getUser: () => Promise.resolve({
        data: { user: { id: 'test-user-id', email: 'test@example.com', role: 'authenticated' } },
        error: null,
      }),
    },
  };
}

export const MOCK_USER = {
  id: 'clinician-001',
  email: 'doc@clinic.test',
  role: 'authenticated',
};

export const MOCK_CONTEXT = {
  user: MOCK_USER,
  sessionToken: 'mock-jwt-token',
  req: new Request('http://localhost'),
};

export function makeAlertRuleRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'rule-001',
    scope: 'global',
    patient_id: undefined,
    name: 'High Glucose Alert',
    description: 'Triggers when glucose exceeds threshold',
    category: 'biometric',
    trigger_type: 'threshold',
    condition: { metric: 'glucose', operator: '>', value: 200 },
    severity: 'critical',
    notify_channels: ['in_app', 'email'],
    notify_roles: ['clinician'],
    dedupe_window_minutes: 60,
    quiet_hours_start: undefined,
    quiet_hours_end: undefined,
    is_enabled: true,
    created_at: '2026-01-15T10:00:00Z',
    updated_at: '2026-01-15T10:00:00Z',
    created_by: 'clinician-001',
    clinician_id: 'clinician-001',
    ...overrides,
  };
}

export function makeAlertEventRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'event-001',
    rule_id: 'rule-001',
    patient_id: 'patient-001',
    trigger_type: 'threshold',
    trigger_data: { metric: 'glucose', value: 250 },
    title: 'Critical glucose reading',
    message: 'Patient glucose is 250 mg/dL',
    severity: 'critical',
    status: 'new',
    acknowledged_at: undefined,
    acknowledged_by: undefined,
    acknowledgment_notes: undefined,
    snoozed_until: undefined,
    resolved_at: undefined,
    resolved_by: undefined,
    resolution_notes: undefined,
    created_at: '2026-01-15T12:00:00Z',
    clinician_id: 'clinician-001',
    ...overrides,
  };
}

export function makePatientRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'patient-001',
    first_name: 'Jane',
    last_name: 'Doe',
    date_of_birth: '1985-06-15',
    sex: 'female',
    email: 'jane@example.com',
    phone: '555-0100',
    address_line1: '123 Main St',
    address_line2: undefined,
    city: 'Portland',
    state: 'OR',
    zip_code: '97201',
    country: 'US',
    emergency_contact_name: 'John Doe',
    emergency_contact_phone: '555-0101',
    emergency_contact_relationship: 'Spouse',
    status: 'active',
    tags: ['diabetes', 'high-risk'],
    assigned_clinician_id: 'clinician-001',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-15T00:00:00Z',
    created_by: 'clinician-001',
    clinician_id: 'clinician-001',
    ...overrides,
  };
}

export function makeLabTestRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'labtest-001',
    code: 'TSH',
    name: 'Thyroid Stimulating Hormone',
    category: 'thyroid',
    unit: 'mIU/L',
    ref_range_low: 0.4,
    ref_range_high: 4.0,
    functional_range_low: 1.0,
    functional_range_high: 2.5,
    critical_low: 0.1,
    critical_high: 10.0,
    description: 'TSH test',
    is_active: true,
    ...overrides,
  };
}

export function makeLabResultRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'result-001',
    patient_id: 'patient-001',
    lab_document_id: 'doc-001',
    lab_test_id: 'labtest-001',
    value: 2.5,
    value_text: undefined,
    unit: 'mIU/L',
    ref_range_low: 0.4,
    ref_range_high: 4.0,
    status: 'normal',
    result_date: '2026-01-10',
    entered_by: 'clinician-001',
    entry_method: 'manual',
    created_at: '2026-01-10T10:00:00Z',
    clinician_id: 'clinician-001',
    ...overrides,
  };
}

export function makeBiometricTypeRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'biotype-001',
    code: 'glucose',
    name: 'Blood Glucose',
    unit: 'mg/dL',
    category: 'metabolic',
    normal_low: 70,
    normal_high: 100,
    warning_low: 60,
    warning_high: 140,
    critical_low: 54,
    critical_high: 250,
    is_active: true,
    ...overrides,
  };
}

export function makeBiometricReadingRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'reading-001',
    patient_id: 'patient-001',
    biometric_type_id: 'biotype-001',
    value: 95,
    unit: 'mg/dL',
    reading_time: '2026-01-15T08:00:00Z',
    context: 'fasting',
    notes: undefined,
    source: 'manual',
    device_name: undefined,
    status: 'normal',
    created_at: '2026-01-15T08:00:00Z',
    clinician_id: 'clinician-001',
    ...overrides,
  };
}

export function makeHealthHistoryRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'hh-001',
    patient_id: 'patient-001',
    conditions: ['type_2_diabetes', 'hypertension'],
    past_conditions: ['appendicitis'],
    family_history: ['heart_disease'],
    current_medications: [{ name: 'Metformin', dose: '500mg', frequency: 'twice daily' }],
    past_medications: [],
    allergies: [{ allergen: 'Penicillin', reaction: 'Rash', severity: 'moderate' }],
    smoking_status: 'never',
    alcohol_use: 'occasional',
    exercise_frequency: '3x/week',
    diet_type: 'Mediterranean',
    sleep_hours_avg: 7.5,
    stress_level: 4,
    pregnant: false,
    nursing: false,
    menstrual_status: 'regular',
    updated_at: '2026-01-15T00:00:00Z',
    updated_by: 'clinician-001',
    clinician_id: 'clinician-001',
    ...overrides,
  };
}

export function makeLabDocumentRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'doc-001',
    patient_id: 'patient-001',
    file_name: 'bloodwork_jan2026.pdf',
    file_type: 'pdf',
    file_size_bytes: 245000,
    storage_path: 'labs/patient-001/bloodwork_jan2026.pdf',
    thumbnail_path: undefined,
    lab_date: '2026-01-10',
    lab_company: 'Quest Diagnostics',
    ordering_provider: 'Dr. Smith',
    panel_name: 'Comprehensive Metabolic Panel',
    processing_status: 'parsed',
    parsed_at: '2026-01-10T11:00:00Z',
    uploaded_by: 'clinician-001',
    uploaded_at: '2026-01-10T10:30:00Z',
    created_at: '2026-01-10T10:30:00Z',
    clinician_id: 'clinician-001',
    ...overrides,
  };
}

export function makeThresholdsRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'thresh-001',
    patient_id: 'patient-001',
    glucose_high: 180,
    glucose_low: 70,
    glucose_critical_high: 250,
    glucose_critical_low: 54,
    bp_systolic_high: 140,
    bp_systolic_low: 90,
    bp_diastolic_high: 90,
    bp_diastolic_low: 60,
    updated_at: '2026-01-15T00:00:00Z',
    updated_by: 'clinician-001',
    clinician_id: 'clinician-001',
    ...overrides,
  };
}
