import { describe, test, expect } from 'vitest';
import {
  mapDbToAlertRule,
  mapDbToAlertEvent,
  mapDbToPatient,
  mapDbToHealthHistory,
  mapDbToLabDocument,
  mapDbToLabTest,
  mapDbToLabResult,
  mapDbToBiometricType,
  mapDbToReading,
  mapDbToThresholds,
  calculateLabStatus,
  calculateBiometricStatus,
  computeAlertSummary,
  computeBiometricTrend,
  computeGlucoseStats,
} from '../../backend/trpc/routes/clinic/utils';
import {
  makeAlertRuleRow,
  makeAlertEventRow,
  makePatientRow,
  makeHealthHistoryRow,
  makeLabDocumentRow,
  makeLabTestRow,
  makeLabResultRow,
  makeBiometricTypeRow,
  makeBiometricReadingRow,
  makeThresholdsRow,
} from './test-helpers';

describe('mapDbToAlertRule', () => {
  test('maps all fields correctly from DB row', () => {
    const row = makeAlertRuleRow();
    const result = mapDbToAlertRule(row);

    expect(result.id).toBe('rule-001');
    expect(result.scope).toBe('global');
    expect(result.patientId).toBeUndefined();
    expect(result.name).toBe('High Glucose Alert');
    expect(result.description).toBe('Triggers when glucose exceeds threshold');
    expect(result.category).toBe('biometric');
    expect(result.triggerType).toBe('threshold');
    expect(result.condition).toEqual({ metric: 'glucose', operator: '>', value: 200 });
    expect(result.severity).toBe('critical');
    expect(result.notifyChannels).toEqual(['in_app', 'email']);
    expect(result.notifyRoles).toEqual(['clinician']);
    expect(result.dedupeWindowMinutes).toBe(60);
    expect(result.isEnabled).toBe(true);
    expect(result.createdAt).toBe('2026-01-15T10:00:00Z');
    expect(result.updatedAt).toBe('2026-01-15T10:00:00Z');
    expect(result.createdBy).toBe('clinician-001');
  });

  test('defaults notifyChannels to [in_app] when null', () => {
    const row = makeAlertRuleRow({ notify_channels: null });
    const result = mapDbToAlertRule(row);
    expect(result.notifyChannels).toEqual(['in_app']);
  });

  test('defaults notifyRoles to [clinician] when null', () => {
    const row = makeAlertRuleRow({ notify_roles: null });
    const result = mapDbToAlertRule(row);
    expect(result.notifyRoles).toEqual(['clinician']);
  });

  test('defaults dedupeWindowMinutes to 60 when null', () => {
    const row = makeAlertRuleRow({ dedupe_window_minutes: null });
    const result = mapDbToAlertRule(row);
    expect(result.dedupeWindowMinutes).toBe(60);
  });

  test('defaults condition to {} when null', () => {
    const row = makeAlertRuleRow({ condition: null });
    const result = mapDbToAlertRule(row);
    expect(result.condition).toEqual({});
  });

  test('handles patient-scoped rules', () => {
    const row = makeAlertRuleRow({ scope: 'patient', patient_id: 'patient-123' });
    const result = mapDbToAlertRule(row);
    expect(result.scope).toBe('patient');
    expect(result.patientId).toBe('patient-123');
  });
});

describe('mapDbToAlertEvent', () => {
  test('maps all fields correctly from DB row', () => {
    const row = makeAlertEventRow();
    const result = mapDbToAlertEvent(row);

    expect(result.id).toBe('event-001');
    expect(result.ruleId).toBe('rule-001');
    expect(result.patientId).toBe('patient-001');
    expect(result.triggerType).toBe('threshold');
    expect(result.triggerData).toEqual({ metric: 'glucose', value: 250 });
    expect(result.title).toBe('Critical glucose reading');
    expect(result.message).toBe('Patient glucose is 250 mg/dL');
    expect(result.severity).toBe('critical');
    expect(result.status).toBe('new');
    expect(result.rule).toBeUndefined();
  });

  test('attaches rule when provided', () => {
    const ruleRow = makeAlertRuleRow();
    const rule = mapDbToAlertRule(ruleRow);
    const eventRow = makeAlertEventRow();
    const result = mapDbToAlertEvent(eventRow, rule);

    expect(result.rule).toBeDefined();
    expect(result.rule?.id).toBe('rule-001');
    expect(result.rule?.name).toBe('High Glucose Alert');
  });

  test('defaults triggerData to {} when null', () => {
    const row = makeAlertEventRow({ trigger_data: null });
    const result = mapDbToAlertEvent(row);
    expect(result.triggerData).toEqual({});
  });

  test('maps acknowledged event fields', () => {
    const row = makeAlertEventRow({
      status: 'acknowledged',
      acknowledged_at: '2026-01-15T13:00:00Z',
      acknowledged_by: 'clinician-002',
      acknowledgment_notes: 'Reviewed and noted',
    });
    const result = mapDbToAlertEvent(row);
    expect(result.status).toBe('acknowledged');
    expect(result.acknowledgedAt).toBe('2026-01-15T13:00:00Z');
    expect(result.acknowledgedBy).toBe('clinician-002');
    expect(result.acknowledgmentNotes).toBe('Reviewed and noted');
  });

  test('maps resolved event fields', () => {
    const row = makeAlertEventRow({
      status: 'resolved',
      resolved_at: '2026-01-15T14:00:00Z',
      resolved_by: 'clinician-001',
      resolution_notes: 'Patient stabilized',
    });
    const result = mapDbToAlertEvent(row);
    expect(result.status).toBe('resolved');
    expect(result.resolvedAt).toBe('2026-01-15T14:00:00Z');
    expect(result.resolvedBy).toBe('clinician-001');
    expect(result.resolutionNotes).toBe('Patient stabilized');
  });

  test('maps snoozed event fields', () => {
    const row = makeAlertEventRow({
      status: 'snoozed',
      snoozed_until: '2026-01-15T15:00:00Z',
    });
    const result = mapDbToAlertEvent(row);
    expect(result.status).toBe('snoozed');
    expect(result.snoozedUntil).toBe('2026-01-15T15:00:00Z');
  });
});

describe('mapDbToPatient', () => {
  test('maps all fields correctly', () => {
    const row = makePatientRow();
    const result = mapDbToPatient(row);

    expect(result.id).toBe('patient-001');
    expect(result.firstName).toBe('Jane');
    expect(result.lastName).toBe('Doe');
    expect(result.dateOfBirth).toBe('1985-06-15');
    expect(result.sex).toBe('female');
    expect(result.email).toBe('jane@example.com');
    expect(result.phone).toBe('555-0100');
    expect(result.addressLine1).toBe('123 Main St');
    expect(result.city).toBe('Portland');
    expect(result.state).toBe('OR');
    expect(result.zipCode).toBe('97201');
    expect(result.country).toBe('US');
    expect(result.emergencyContactName).toBe('John Doe');
    expect(result.status).toBe('active');
    expect(result.tags).toEqual(['diabetes', 'high-risk']);
    expect(result.assignedClinicianId).toBe('clinician-001');
  });

  test('defaults tags to empty array when null', () => {
    const row = makePatientRow({ tags: null });
    const result = mapDbToPatient(row);
    expect(result.tags).toEqual([]);
  });

  test('handles minimal patient row', () => {
    const row = makePatientRow({
      email: undefined,
      phone: undefined,
      address_line1: undefined,
      tags: [],
      assigned_clinician_id: undefined,
    });
    const result = mapDbToPatient(row);
    expect(result.email).toBeUndefined();
    expect(result.phone).toBeUndefined();
    expect(result.tags).toEqual([]);
  });
});

describe('mapDbToHealthHistory', () => {
  test('maps all fields correctly', () => {
    const row = makeHealthHistoryRow();
    const result = mapDbToHealthHistory(row);

    expect(result.id).toBe('hh-001');
    expect(result.patientId).toBe('patient-001');
    expect(result.conditions).toEqual(['type_2_diabetes', 'hypertension']);
    expect(result.pastConditions).toEqual(['appendicitis']);
    expect(result.familyHistory).toEqual(['heart_disease']);
    expect(result.currentMedications).toHaveLength(1);
    expect(result.currentMedications[0].name).toBe('Metformin');
    expect(result.allergies).toHaveLength(1);
    expect(result.allergies[0].allergen).toBe('Penicillin');
    expect(result.smokingStatus).toBe('never');
    expect(result.sleepHoursAvg).toBe(7.5);
    expect(result.stressLevel).toBe(4);
    expect(result.pregnant).toBe(false);
    expect(result.nursing).toBe(false);
  });

  test('defaults arrays to empty when null', () => {
    const row = makeHealthHistoryRow({
      conditions: null,
      past_conditions: null,
      family_history: null,
      current_medications: null,
      past_medications: null,
      allergies: null,
    });
    const result = mapDbToHealthHistory(row);
    expect(result.conditions).toEqual([]);
    expect(result.pastConditions).toEqual([]);
    expect(result.familyHistory).toEqual([]);
    expect(result.currentMedications).toEqual([]);
    expect(result.pastMedications).toEqual([]);
    expect(result.allergies).toEqual([]);
  });

  test('defaults pregnant and nursing to false when null', () => {
    const row = makeHealthHistoryRow({ pregnant: null, nursing: null });
    const result = mapDbToHealthHistory(row);
    expect(result.pregnant).toBe(false);
    expect(result.nursing).toBe(false);
  });
});

describe('mapDbToLabDocument', () => {
  test('maps all fields correctly', () => {
    const row = makeLabDocumentRow();
    const result = mapDbToLabDocument(row);

    expect(result.id).toBe('doc-001');
    expect(result.patientId).toBe('patient-001');
    expect(result.fileName).toBe('bloodwork_jan2026.pdf');
    expect(result.fileType).toBe('pdf');
    expect(result.fileSizeBytes).toBe(245000);
    expect(result.storagePath).toBe('labs/patient-001/bloodwork_jan2026.pdf');
    expect(result.labCompany).toBe('Quest Diagnostics');
    expect(result.panelName).toBe('Comprehensive Metabolic Panel');
    expect(result.processingStatus).toBe('parsed');
    expect(result.uploadedBy).toBe('clinician-001');
  });
});

describe('mapDbToLabTest', () => {
  test('maps all fields correctly', () => {
    const row = makeLabTestRow();
    const result = mapDbToLabTest(row);

    expect(result.id).toBe('labtest-001');
    expect(result.code).toBe('TSH');
    expect(result.name).toBe('Thyroid Stimulating Hormone');
    expect(result.category).toBe('thyroid');
    expect(result.unit).toBe('mIU/L');
    expect(result.refRangeLow).toBe(0.4);
    expect(result.refRangeHigh).toBe(4.0);
    expect(result.functionalRangeLow).toBe(1.0);
    expect(result.functionalRangeHigh).toBe(2.5);
    expect(result.criticalLow).toBe(0.1);
    expect(result.criticalHigh).toBe(10.0);
    expect(result.isActive).toBe(true);
  });
});

describe('mapDbToLabResult', () => {
  test('maps all fields correctly without labTest', () => {
    const row = makeLabResultRow();
    const result = mapDbToLabResult(row);

    expect(result.id).toBe('result-001');
    expect(result.patientId).toBe('patient-001');
    expect(result.labDocumentId).toBe('doc-001');
    expect(result.labTestId).toBe('labtest-001');
    expect(result.value).toBe(2.5);
    expect(result.unit).toBe('mIU/L');
    expect(result.status).toBe('normal');
    expect(result.resultDate).toBe('2026-01-10');
    expect(result.enteredBy).toBe('clinician-001');
    expect(result.entryMethod).toBe('manual');
    expect(result.labTest).toBeUndefined();
  });

  test('attaches labTest when provided', () => {
    const row = makeLabResultRow();
    const labTest = mapDbToLabTest(makeLabTestRow());
    const result = mapDbToLabResult(row, labTest);

    expect(result.labTest).toBeDefined();
    expect(result.labTest?.code).toBe('TSH');
  });
});

describe('mapDbToBiometricType', () => {
  test('maps all fields correctly', () => {
    const row = makeBiometricTypeRow();
    const result = mapDbToBiometricType(row);

    expect(result.id).toBe('biotype-001');
    expect(result.code).toBe('glucose');
    expect(result.name).toBe('Blood Glucose');
    expect(result.unit).toBe('mg/dL');
    expect(result.category).toBe('metabolic');
    expect(result.normalLow).toBe(70);
    expect(result.normalHigh).toBe(100);
    expect(result.warningLow).toBe(60);
    expect(result.warningHigh).toBe(140);
    expect(result.criticalLow).toBe(54);
    expect(result.criticalHigh).toBe(250);
    expect(result.isActive).toBe(true);
  });
});

describe('mapDbToReading', () => {
  test('maps all fields correctly without biometricType', () => {
    const row = makeBiometricReadingRow();
    const result = mapDbToReading(row);

    expect(result.id).toBe('reading-001');
    expect(result.patientId).toBe('patient-001');
    expect(result.biometricTypeId).toBe('biotype-001');
    expect(result.value).toBe(95);
    expect(result.unit).toBe('mg/dL');
    expect(result.readingTime).toBe('2026-01-15T08:00:00Z');
    expect(result.context).toBe('fasting');
    expect(result.source).toBe('manual');
    expect(result.status).toBe('normal');
    expect(result.biometricType).toBeUndefined();
  });

  test('attaches biometricType when provided', () => {
    const row = makeBiometricReadingRow();
    const bioType = mapDbToBiometricType(makeBiometricTypeRow());
    const result = mapDbToReading(row, bioType);

    expect(result.biometricType).toBeDefined();
    expect(result.biometricType?.code).toBe('glucose');
  });
});

describe('mapDbToThresholds', () => {
  test('maps all fields correctly', () => {
    const row = makeThresholdsRow();
    const result = mapDbToThresholds(row);

    expect(result.id).toBe('thresh-001');
    expect(result.patientId).toBe('patient-001');
    expect(result.glucoseHigh).toBe(180);
    expect(result.glucoseLow).toBe(70);
    expect(result.glucoseCriticalHigh).toBe(250);
    expect(result.glucoseCriticalLow).toBe(54);
    expect(result.bpSystolicHigh).toBe(140);
    expect(result.bpSystolicLow).toBe(90);
    expect(result.bpDiastolicHigh).toBe(90);
    expect(result.bpDiastolicLow).toBe(60);
  });
});

describe('calculateLabStatus', () => {
  test('returns normal when value is within ref range', () => {
    expect(calculateLabStatus(2.0, 0.4, 4.0, 0.1, 10.0)).toBe('normal');
  });

  test('returns normal when value equals ref low boundary', () => {
    expect(calculateLabStatus(0.4, 0.4, 4.0)).toBe('normal');
  });

  test('returns normal when value equals ref high boundary', () => {
    expect(calculateLabStatus(4.0, 0.4, 4.0)).toBe('normal');
  });

  test('returns low when value is below ref range but above critical', () => {
    expect(calculateLabStatus(0.3, 0.4, 4.0, 0.1, 10.0)).toBe('low');
  });

  test('returns high when value is above ref range but below critical', () => {
    expect(calculateLabStatus(5.0, 0.4, 4.0, 0.1, 10.0)).toBe('high');
  });

  test('returns critical_low when value is below critical threshold', () => {
    expect(calculateLabStatus(0.05, 0.4, 4.0, 0.1, 10.0)).toBe('critical_low');
  });

  test('returns critical_high when value is above critical threshold', () => {
    expect(calculateLabStatus(12.0, 0.4, 4.0, 0.1, 10.0)).toBe('critical_high');
  });

  test('returns normal when no ranges defined', () => {
    expect(calculateLabStatus(999)).toBe('normal');
  });

  test('checks critical before ref ranges (critical takes priority)', () => {
    expect(calculateLabStatus(0.05, 0.4, 4.0, 0.1, 10.0)).toBe('critical_low');
    expect(calculateLabStatus(15.0, 0.4, 4.0, 0.1, 10.0)).toBe('critical_high');
  });

  test('handles only ref range (no critical)', () => {
    expect(calculateLabStatus(0.2, 0.4, 4.0)).toBe('low');
    expect(calculateLabStatus(5.0, 0.4, 4.0)).toBe('high');
    expect(calculateLabStatus(2.0, 0.4, 4.0)).toBe('normal');
  });

  test('handles only critical range (no ref)', () => {
    expect(calculateLabStatus(0.05, undefined, undefined, 0.1, 10.0)).toBe('critical_low');
    expect(calculateLabStatus(12.0, undefined, undefined, 0.1, 10.0)).toBe('critical_high');
    expect(calculateLabStatus(5.0, undefined, undefined, 0.1, 10.0)).toBe('normal');
  });

  test('handles edge values at critical boundaries', () => {
    expect(calculateLabStatus(0.1, 0.4, 4.0, 0.1, 10.0)).toBe('low');
    expect(calculateLabStatus(10.0, 0.4, 4.0, 0.1, 10.0)).toBe('high');
  });
});

describe('calculateBiometricStatus', () => {
  const glucoseType = mapDbToBiometricType(makeBiometricTypeRow());

  test('returns normal when value is in normal range', () => {
    expect(calculateBiometricStatus(85, glucoseType)).toBe('normal');
  });

  test('returns warning_low when below warning threshold', () => {
    expect(calculateBiometricStatus(58, glucoseType)).toBe('warning_low');
  });

  test('returns warning_high when above warning threshold', () => {
    expect(calculateBiometricStatus(150, glucoseType)).toBe('warning_high');
  });

  test('returns critical_low when below critical threshold', () => {
    expect(calculateBiometricStatus(50, glucoseType)).toBe('critical_low');
  });

  test('returns critical_high when above critical threshold', () => {
    expect(calculateBiometricStatus(260, glucoseType)).toBe('critical_high');
  });

  test('critical takes priority over warning', () => {
    expect(calculateBiometricStatus(53, glucoseType)).toBe('critical_low');
    expect(calculateBiometricStatus(251, glucoseType)).toBe('critical_high');
  });

  test('handles type with no thresholds', () => {
    const minimalType = mapDbToBiometricType(makeBiometricTypeRow({
      warning_low: undefined,
      warning_high: undefined,
      critical_low: undefined,
      critical_high: undefined,
    }));
    expect(calculateBiometricStatus(999, minimalType)).toBe('normal');
    expect(calculateBiometricStatus(-10, minimalType)).toBe('normal');
  });

  test('handles boundary values', () => {
    expect(calculateBiometricStatus(54, glucoseType)).toBe('warning_low');
    expect(calculateBiometricStatus(60, glucoseType)).toBe('normal');
    expect(calculateBiometricStatus(140, glucoseType)).toBe('normal');
    expect(calculateBiometricStatus(250, glucoseType)).toBe('warning_high');
  });
});

describe('computeAlertSummary', () => {
  test('returns all zeros for empty events', () => {
    const result = computeAlertSummary([], new Map());
    expect(result.total).toBe(0);
    expect(result.bySeverity.critical).toBe(0);
    expect(result.byStatus.new).toBe(0);
    expect(result.byCategory.lab).toBe(0);
  });

  test('counts severity correctly', () => {
    const events = [
      { severity: 'critical', status: 'new', rule_id: null },
      { severity: 'critical', status: 'new', rule_id: null },
      { severity: 'high', status: 'viewed', rule_id: null },
      { severity: 'low', status: 'acknowledged', rule_id: null },
    ];
    const result = computeAlertSummary(events, new Map());
    expect(result.total).toBe(4);
    expect(result.bySeverity.critical).toBe(2);
    expect(result.bySeverity.high).toBe(1);
    expect(result.bySeverity.low).toBe(1);
    expect(result.bySeverity.medium).toBe(0);
  });

  test('counts status correctly', () => {
    const events = [
      { severity: 'high', status: 'new', rule_id: null },
      { severity: 'high', status: 'new', rule_id: null },
      { severity: 'high', status: 'resolved', rule_id: null },
    ];
    const result = computeAlertSummary(events, new Map());
    expect(result.byStatus.new).toBe(2);
    expect(result.byStatus.resolved).toBe(1);
  });

  test('counts categories from rules map', () => {
    const events = [
      { severity: 'high', status: 'new', rule_id: 'rule-1' },
      { severity: 'medium', status: 'new', rule_id: 'rule-1' },
      { severity: 'low', status: 'new', rule_id: 'rule-2' },
      { severity: 'info', status: 'new', rule_id: null },
    ];
    const rulesMap = new Map([
      ['rule-1', 'lab'],
      ['rule-2', 'biometric'],
    ]);
    const result = computeAlertSummary(events, rulesMap);
    expect(result.byCategory.lab).toBe(2);
    expect(result.byCategory.biometric).toBe(1);
    expect(result.byCategory.upload).toBe(0);
  });

  test('ignores events with unknown rule_id', () => {
    const events = [
      { severity: 'high', status: 'new', rule_id: 'unknown-rule' },
    ];
    const result = computeAlertSummary(events, new Map());
    expect(result.byCategory.lab).toBe(0);
    expect(result.byCategory.biometric).toBe(0);
  });
});

describe('computeBiometricTrend', () => {
  test('returns unknown when fewer than 5 readings', () => {
    const readings = Array.from({ length: 4 }, (_, i) => ({ value: 100 + i }));
    expect(computeBiometricTrend(readings, 'glucose', 100)).toBe('unknown');
  });

  test('returns stable when change is less than 5%', () => {
    const readings = [
      { value: 100 }, { value: 101 }, { value: 99 },
      { value: 100 }, { value: 100 }, { value: 101 }, { value: 99 },
    ];
    expect(computeBiometricTrend(readings, 'glucose', 100)).toBe('stable');
  });

  test('returns improving for glucose when decreasing', () => {
    const readings = [
      { value: 90 }, { value: 92 }, { value: 91 },
      { value: 110 }, { value: 115 }, { value: 120 }, { value: 118 },
    ];
    expect(computeBiometricTrend(readings, 'glucose', 105)).toBe('improving');
  });

  test('returns worsening for glucose when increasing', () => {
    const readings = [
      { value: 150 }, { value: 148 }, { value: 155 },
      { value: 100 }, { value: 102 }, { value: 98 }, { value: 101 },
    ];
    expect(computeBiometricTrend(readings, 'glucose', 120)).toBe('worsening');
  });

  test('returns improving for non-glucose metric when increasing', () => {
    const readings = [
      { value: 70 }, { value: 68 }, { value: 72 },
      { value: 55 }, { value: 52 }, { value: 53 }, { value: 54 },
    ];
    expect(computeBiometricTrend(readings, 'hrv', 60)).toBe('improving');
  });

  test('returns worsening for non-glucose metric when decreasing', () => {
    const readings = [
      { value: 40 }, { value: 42 }, { value: 38 },
      { value: 60 }, { value: 58 }, { value: 62 }, { value: 59 },
    ];
    expect(computeBiometricTrend(readings, 'hrv', 50)).toBe('worsening');
  });

  test('treats bp_systolic decrease as improving', () => {
    const readings = [
      { value: 120 }, { value: 118 }, { value: 122 },
      { value: 145 }, { value: 148 }, { value: 142 }, { value: 146 },
    ];
    expect(computeBiometricTrend(readings, 'bp_systolic', 135)).toBe('improving');
  });

  test('treats bp_diastolic decrease as improving', () => {
    const readings = [
      { value: 70 }, { value: 72 }, { value: 68 },
      { value: 88 }, { value: 90 }, { value: 86 }, { value: 89 },
    ];
    expect(computeBiometricTrend(readings, 'bp_diastolic', 80)).toBe('improving');
  });
});

describe('computeGlucoseStats', () => {
  test('returns zeros for empty values', () => {
    const result = computeGlucoseStats([], 180, 70);
    expect(result.averageGlucose).toBe(0);
    expect(result.readingCount).toBe(0);
    expect(result.timeInRange).toBe(0);
    expect(result.estimatedA1c).toBeUndefined();
  });

  test('calculates correct stats for all-in-range values', () => {
    const values = [100, 110, 120, 130, 90];
    const result = computeGlucoseStats(values, 180, 70);

    expect(result.averageGlucose).toBe(110);
    expect(result.timeInRange).toBe(100);
    expect(result.timeAboveRange).toBe(0);
    expect(result.timeBelowRange).toBe(0);
    expect(result.highestReading).toBe(130);
    expect(result.lowestReading).toBe(90);
    expect(result.readingCount).toBe(5);
    expect(result.estimatedA1c).toBeDefined();
  });

  test('calculates correct percentages with mixed values', () => {
    const values = [50, 100, 200, 150, 60];
    const result = computeGlucoseStats(values, 180, 70);

    expect(result.readingCount).toBe(5);
    expect(result.timeBelowRange).toBe(40);
    expect(result.timeInRange).toBe(40);
    expect(result.timeAboveRange).toBe(20);
    expect(result.highestReading).toBe(200);
    expect(result.lowestReading).toBe(50);
  });

  test('calculates estimatedA1c using DCCT formula', () => {
    const values = [150];
    const result = computeGlucoseStats(values, 180, 70);
    const expectedA1c = Math.round(((150 + 46.7) / 28.7) * 10) / 10;
    expect(result.estimatedA1c).toBe(expectedA1c);
  });

  test('handles single value', () => {
    const result = computeGlucoseStats([100], 180, 70);
    expect(result.averageGlucose).toBe(100);
    expect(result.timeInRange).toBe(100);
    expect(result.readingCount).toBe(1);
  });

  test('boundary values at thresholds', () => {
    const values = [70, 180];
    const result = computeGlucoseStats(values, 180, 70);
    expect(result.timeInRange).toBe(100);
    expect(result.timeAboveRange).toBe(0);
    expect(result.timeBelowRange).toBe(0);
  });
});
