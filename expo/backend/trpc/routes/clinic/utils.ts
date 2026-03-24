import type {
  AlertRule,
  AlertEvent,
  AlertSeverity,
  AlertEventStatus,
  AlertRuleCategory,
  Patient,
  PatientHealthHistory,
  LabDocument,
  LabTest,
  LabResult,
  LabResultStatus,
  BiometricType,
  BiometricReading,
  BiometricStatus,
  BiometricSummary,
  PatientThresholds,
} from "@/types/clinic";

export function mapDbToAlertRule(row: Record<string, unknown>): AlertRule {
  return {
    id: row.id as string,
    scope: row.scope as AlertRule['scope'],
    patientId: row.patient_id as string | undefined,
    name: row.name as string,
    description: row.description as string | undefined,
    category: row.category as AlertRule['category'],
    triggerType: row.trigger_type as AlertRule['triggerType'],
    condition: (row.condition as AlertRule['condition']) ?? {},
    severity: row.severity as AlertRule['severity'],
    notifyChannels: (row.notify_channels as AlertRule['notifyChannels']) ?? ['in_app'],
    notifyRoles: (row.notify_roles as AlertRule['notifyRoles']) ?? ['clinician'],
    dedupeWindowMinutes: (row.dedupe_window_minutes as number) ?? 60,
    quietHoursStart: row.quiet_hours_start as string | undefined,
    quietHoursEnd: row.quiet_hours_end as string | undefined,
    isEnabled: row.is_enabled as boolean,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    createdBy: row.created_by as string | undefined,
  };
}

export function mapDbToAlertEvent(row: Record<string, unknown>, rule?: AlertRule): AlertEvent {
  return {
    id: row.id as string,
    ruleId: row.rule_id as string | undefined,
    rule,
    patientId: row.patient_id as string,
    triggerType: row.trigger_type as AlertEvent['triggerType'],
    triggerData: (row.trigger_data as Record<string, unknown>) ?? {},
    title: row.title as string,
    message: row.message as string,
    severity: row.severity as AlertEvent['severity'],
    status: row.status as AlertEvent['status'],
    acknowledgedAt: row.acknowledged_at as string | undefined,
    acknowledgedBy: row.acknowledged_by as string | undefined,
    acknowledgmentNotes: row.acknowledgment_notes as string | undefined,
    snoozedUntil: row.snoozed_until as string | undefined,
    resolvedAt: row.resolved_at as string | undefined,
    resolvedBy: row.resolved_by as string | undefined,
    resolutionNotes: row.resolution_notes as string | undefined,
    createdAt: row.created_at as string,
  };
}

export function mapDbToPatient(row: Record<string, unknown>): Patient {
  return {
    id: row.id as string,
    firstName: row.first_name as string,
    lastName: row.last_name as string,
    dateOfBirth: row.date_of_birth as string,
    sex: row.sex as Patient['sex'],
    email: row.email as string | undefined,
    phone: row.phone as string | undefined,
    addressLine1: row.address_line1 as string | undefined,
    addressLine2: row.address_line2 as string | undefined,
    city: row.city as string | undefined,
    state: row.state as string | undefined,
    zipCode: row.zip_code as string | undefined,
    country: row.country as string,
    emergencyContactName: row.emergency_contact_name as string | undefined,
    emergencyContactPhone: row.emergency_contact_phone as string | undefined,
    emergencyContactRelationship: row.emergency_contact_relationship as string | undefined,
    status: row.status as Patient['status'],
    tags: (row.tags as string[]) ?? [],
    assignedClinicianId: row.assigned_clinician_id as string | undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    createdBy: row.created_by as string | undefined,
  };
}

export function mapDbToHealthHistory(row: Record<string, unknown>): PatientHealthHistory {
  return {
    id: row.id as string,
    patientId: row.patient_id as string,
    conditions: (row.conditions as string[]) ?? [],
    pastConditions: (row.past_conditions as string[]) ?? [],
    familyHistory: (row.family_history as string[]) ?? [],
    currentMedications: (row.current_medications as PatientHealthHistory['currentMedications']) ?? [],
    pastMedications: (row.past_medications as PatientHealthHistory['pastMedications']) ?? [],
    allergies: (row.allergies as PatientHealthHistory['allergies']) ?? [],
    smokingStatus: row.smoking_status as string | undefined,
    alcoholUse: row.alcohol_use as string | undefined,
    exerciseFrequency: row.exercise_frequency as string | undefined,
    dietType: row.diet_type as string | undefined,
    sleepHoursAvg: row.sleep_hours_avg as number | undefined,
    stressLevel: row.stress_level as number | undefined,
    pregnant: (row.pregnant as boolean) ?? false,
    nursing: (row.nursing as boolean) ?? false,
    menstrualStatus: row.menstrual_status as string | undefined,
    updatedAt: row.updated_at as string,
    updatedBy: row.updated_by as string | undefined,
  };
}

export function mapDbToLabDocument(row: Record<string, unknown>): LabDocument {
  return {
    id: row.id as string,
    patientId: row.patient_id as string,
    fileName: row.file_name as string,
    fileType: row.file_type as LabDocument['fileType'],
    fileSizeBytes: row.file_size_bytes as number,
    storagePath: row.storage_path as string,
    thumbnailPath: row.thumbnail_path as string | undefined,
    labDate: row.lab_date as string | undefined,
    labCompany: row.lab_company as string | undefined,
    orderingProvider: row.ordering_provider as string | undefined,
    panelName: row.panel_name as string | undefined,
    processingStatus: row.processing_status as LabDocument['processingStatus'],
    parsedAt: row.parsed_at as string | undefined,
    uploadedBy: row.uploaded_by as string,
    uploadedAt: row.uploaded_at as string,
    createdAt: row.created_at as string,
  };
}

export function mapDbToLabTest(row: Record<string, unknown>): LabTest {
  return {
    id: row.id as string,
    code: row.code as string,
    name: row.name as string,
    category: row.category as string | undefined,
    unit: row.unit as string,
    refRangeLow: row.ref_range_low as number | undefined,
    refRangeHigh: row.ref_range_high as number | undefined,
    functionalRangeLow: row.functional_range_low as number | undefined,
    functionalRangeHigh: row.functional_range_high as number | undefined,
    criticalLow: row.critical_low as number | undefined,
    criticalHigh: row.critical_high as number | undefined,
    description: row.description as string | undefined,
    isActive: row.is_active as boolean,
  };
}

export function mapDbToLabResult(row: Record<string, unknown>, labTest?: LabTest): LabResult {
  return {
    id: row.id as string,
    patientId: row.patient_id as string,
    labDocumentId: row.lab_document_id as string | undefined,
    labTestId: row.lab_test_id as string,
    labTest,
    value: row.value as number,
    valueText: row.value_text as string | undefined,
    unit: row.unit as string,
    refRangeLow: row.ref_range_low as number | undefined,
    refRangeHigh: row.ref_range_high as number | undefined,
    status: row.status as LabResultStatus,
    resultDate: row.result_date as string,
    enteredBy: row.entered_by as string,
    entryMethod: row.entry_method as LabResult['entryMethod'],
    createdAt: row.created_at as string,
  };
}

export function mapDbToBiometricType(row: Record<string, unknown>): BiometricType {
  return {
    id: row.id as string,
    code: row.code as string,
    name: row.name as string,
    unit: row.unit as string,
    category: row.category as BiometricType['category'],
    normalLow: row.normal_low as number | undefined,
    normalHigh: row.normal_high as number | undefined,
    warningLow: row.warning_low as number | undefined,
    warningHigh: row.warning_high as number | undefined,
    criticalLow: row.critical_low as number | undefined,
    criticalHigh: row.critical_high as number | undefined,
    isActive: row.is_active as boolean,
  };
}

export function mapDbToReading(row: Record<string, unknown>, bioType?: BiometricType): BiometricReading {
  return {
    id: row.id as string,
    patientId: row.patient_id as string,
    biometricTypeId: row.biometric_type_id as string,
    biometricType: bioType,
    value: row.value as number,
    unit: row.unit as string,
    readingTime: row.reading_time as string,
    context: row.context as BiometricReading['context'],
    notes: row.notes as string | undefined,
    source: row.source as BiometricReading['source'],
    deviceName: row.device_name as string | undefined,
    status: row.status as BiometricStatus,
    createdAt: row.created_at as string,
  };
}

export function mapDbToThresholds(row: Record<string, unknown>): PatientThresholds {
  return {
    id: row.id as string,
    patientId: row.patient_id as string,
    glucoseHigh: row.glucose_high as number,
    glucoseLow: row.glucose_low as number,
    glucoseCriticalHigh: row.glucose_critical_high as number,
    glucoseCriticalLow: row.glucose_critical_low as number,
    bpSystolicHigh: row.bp_systolic_high as number,
    bpSystolicLow: row.bp_systolic_low as number,
    bpDiastolicHigh: row.bp_diastolic_high as number,
    bpDiastolicLow: row.bp_diastolic_low as number,
    updatedAt: row.updated_at as string,
    updatedBy: row.updated_by as string | undefined,
  };
}

export function calculateLabStatus(
  value: number,
  refLow?: number,
  refHigh?: number,
  critLow?: number,
  critHigh?: number
): LabResultStatus {
  if (critLow !== undefined && value < critLow) return 'critical_low';
  if (critHigh !== undefined && value > critHigh) return 'critical_high';
  if (refLow !== undefined && value < refLow) return 'low';
  if (refHigh !== undefined && value > refHigh) return 'high';
  return 'normal';
}

export function calculateBiometricStatus(
  value: number,
  type: BiometricType
): BiometricStatus {
  if (type.criticalLow !== undefined && value < type.criticalLow) return 'critical_low';
  if (type.criticalHigh !== undefined && value > type.criticalHigh) return 'critical_high';
  if (type.warningLow !== undefined && value < type.warningLow) return 'warning_low';
  if (type.warningHigh !== undefined && value > type.warningHigh) return 'warning_high';
  return 'normal';
}

export function computeAlertSummary(
  events: Record<string, unknown>[],
  rulesMap: Map<string, string>
): {
  total: number;
  bySeverity: Record<AlertSeverity, number>;
  byStatus: Record<AlertEventStatus, number>;
  byCategory: Record<AlertRuleCategory, number>;
} {
  const bySeverity: Record<AlertSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const byStatus: Record<AlertEventStatus, number> = { new: 0, viewed: 0, acknowledged: 0, snoozed: 0, resolved: 0, dismissed: 0 };
  const byCategory: Record<AlertRuleCategory, number> = { lab: 0, biometric: 0, upload: 0, adherence: 0, symptom: 0 };

  events.forEach((event) => {
    const sev = event.severity as AlertSeverity;
    const stat = event.status as AlertEventStatus;
    if (sev in bySeverity) bySeverity[sev]++;
    if (stat in byStatus) byStatus[stat]++;
    if (event.rule_id) {
      const cat = rulesMap.get(event.rule_id as string) as AlertRuleCategory | undefined;
      if (cat && cat in byCategory) byCategory[cat]++;
    }
  });

  return { total: events.length, bySeverity, byStatus, byCategory };
}

export function computeBiometricTrend(
  typeReadings: Record<string, unknown>[],
  code: string,
  avgValue: number
): BiometricSummary['trend'] {
  if (typeReadings.length < 5) return 'unknown';

  const recentAvg = typeReadings.slice(0, 3).reduce((a, b) => a + (b.value as number), 0) / 3;
  const olderAvg = typeReadings.slice(-3).reduce((a, b) => a + (b.value as number), 0) / 3;
  const isDecreaseGood = code === 'glucose' || code === 'bp_systolic' || code === 'bp_diastolic';

  if (Math.abs(recentAvg - olderAvg) < avgValue * 0.05) {
    return 'stable';
  } else if (recentAvg < olderAvg) {
    return isDecreaseGood ? 'improving' : 'worsening';
  } else {
    return isDecreaseGood ? 'worsening' : 'improving';
  }
}

export function computeGlucoseStats(
  values: number[],
  highThreshold: number,
  lowThreshold: number
): {
  averageGlucose: number;
  timeInRange: number;
  timeAboveRange: number;
  timeBelowRange: number;
  highestReading: number;
  lowestReading: number;
  readingCount: number;
  estimatedA1c?: number;
} {
  if (values.length === 0) {
    return {
      averageGlucose: 0, timeInRange: 0, timeAboveRange: 0, timeBelowRange: 0,
      highestReading: 0, lowestReading: 0, readingCount: 0,
    };
  }

  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const inRange = values.filter((v) => v >= lowThreshold && v <= highThreshold).length;
  const above = values.filter((v) => v > highThreshold).length;
  const below = values.filter((v) => v < lowThreshold).length;

  return {
    averageGlucose: Math.round(avg),
    timeInRange: Math.round((inRange / values.length) * 100),
    timeAboveRange: Math.round((above / values.length) * 100),
    timeBelowRange: Math.round((below / values.length) * 100),
    highestReading: Math.max(...values),
    lowestReading: Math.min(...values),
    readingCount: values.length,
    estimatedA1c: Math.round(((avg + 46.7) / 28.7) * 10) / 10,
  };
}
