export type UserRole = 'clinician' | 'staff' | 'patient';

export type Permission = 
  | 'view_patients'
  | 'edit_patients'
  | 'delete_patients'
  | 'view_labs'
  | 'edit_labs'
  | 'upload_labs'
  | 'view_notes'
  | 'edit_notes'
  | 'sign_notes'
  | 'view_biometrics'
  | 'edit_biometrics'
  | 'view_care_plans'
  | 'edit_care_plans'
  | 'manage_alerts'
  | 'view_alerts'
  | 'manage_users'
  | 'view_audit_log'
  | 'export_data';

export interface ClinicUser {
  id: string;
  email: string;
  phone?: string;
  role: UserRole;
  permissions: Permission[];
  mfaEnabled: boolean;
  isActive: boolean;
  firstName: string;
  lastName: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

export interface Patient {
  id: string;
  userId?: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  sex: 'male' | 'female' | 'other';
  email?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelationship?: string;
  status: 'active' | 'inactive' | 'archived';
  tags: string[];
  assignedClinicianId?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

export interface PatientHealthHistory {
  id: string;
  patientId: string;
  conditions: string[];
  pastConditions: string[];
  familyHistory: string[];
  currentMedications: Medication[];
  pastMedications: Medication[];
  allergies: Allergy[];
  smokingStatus?: string;
  alcoholUse?: string;
  exerciseFrequency?: string;
  dietType?: string;
  sleepHoursAvg?: number;
  stressLevel?: number;
  pregnant: boolean;
  nursing: boolean;
  menstrualStatus?: string;
  updatedAt: string;
  updatedBy?: string;
}

export interface Medication {
  name: string;
  dose: string;
  frequency: string;
  prescriber?: string;
  startDate?: string;
  endDate?: string;
}

export interface Allergy {
  allergen: string;
  reaction: string;
  severity: 'mild' | 'moderate' | 'severe' | 'life_threatening';
}

export type EncounterType = 'initial' | 'follow_up' | 'phone' | 'telehealth' | 'message';
export type EncounterStatus = 'draft' | 'signed' | 'amended' | 'locked';

export interface Encounter {
  id: string;
  patientId: string;
  clinicianId: string;
  encounterDate: string;
  encounterType: EncounterType;
  subjective?: string;
  objective?: string;
  assessment?: string;
  plan?: string;
  notes?: string;
  attachments: EncounterAttachment[];
  status: EncounterStatus;
  signedAt?: string;
  signedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EncounterAttachment {
  fileId: string;
  name: string;
  type: string;
}

export type LabProcessingStatus = 'pending' | 'processing' | 'parsed' | 'manual_entry' | 'error';

export interface LabDocument {
  id: string;
  patientId: string;
  fileName: string;
  fileType: 'pdf' | 'jpg' | 'png';
  fileSizeBytes: number;
  storagePath: string;
  thumbnailPath?: string;
  labDate?: string;
  labCompany?: string;
  orderingProvider?: string;
  panelName?: string;
  processingStatus: LabProcessingStatus;
  parsedAt?: string;
  uploadedBy: string;
  uploadedAt: string;
  createdAt: string;
}

export interface LabTest {
  id: string;
  code: string;
  name: string;
  category?: string;
  unit: string;
  refRangeLow?: number;
  refRangeHigh?: number;
  functionalRangeLow?: number;
  functionalRangeHigh?: number;
  criticalLow?: number;
  criticalHigh?: number;
  description?: string;
  isActive: boolean;
}

export type LabResultStatus = 'normal' | 'low' | 'high' | 'critical_low' | 'critical_high';
export type EntryMethod = 'manual' | 'parsed' | 'api';

export interface LabResult {
  id: string;
  patientId: string;
  labDocumentId?: string;
  labTestId: string;
  labTest?: LabTest;
  value: number;
  valueText?: string;
  unit: string;
  refRangeLow?: number;
  refRangeHigh?: number;
  status: LabResultStatus;
  resultDate: string;
  enteredBy: string;
  entryMethod: EntryMethod;
  createdAt: string;
}

export interface BiometricType {
  id: string;
  code: string;
  name: string;
  unit: string;
  category: 'vital' | 'metabolic' | 'body_composition' | 'sleep' | 'activity';
  normalLow?: number;
  normalHigh?: number;
  warningLow?: number;
  warningHigh?: number;
  criticalLow?: number;
  criticalHigh?: number;
  isActive: boolean;
}

export type BiometricStatus = 'normal' | 'warning_low' | 'warning_high' | 'critical_low' | 'critical_high';
export type BiometricSource = 'manual' | 'device_sync' | 'cgm' | 'app';
export type BiometricContext = 'fasting' | 'post_meal' | 'pre_exercise' | 'post_exercise' | 'bedtime' | 'waking' | 'random';

export interface BiometricReading {
  id: string;
  patientId: string;
  biometricTypeId: string;
  biometricType?: BiometricType;
  value: number;
  unit: string;
  readingTime: string;
  context?: BiometricContext;
  notes?: string;
  source: BiometricSource;
  deviceName?: string;
  status: BiometricStatus;
  createdAt: string;
}

export type CarePlanStatus = 'draft' | 'active' | 'paused' | 'completed' | 'archived';

export interface CarePlanGoal {
  id: string;
  goal: string;
  targetDate?: string;
  status: 'pending' | 'in_progress' | 'achieved' | 'not_achieved';
}

export interface CarePlanSupplement {
  id: string;
  name: string;
  brand?: string;
  dose: string;
  frequency: string;
  timing: string;
  notes?: string;
  orderLink?: string;
}

export interface CarePlanPeptide {
  id: string;
  name: string;
  dose: string;
  frequency: string;
  route: string;
  cycleInfo?: string;
  notes?: string;
}

export interface CarePlanLifestyleTask {
  id: string;
  type: string;
  name: string;
  target?: number;
  unit?: string;
  frequency: string;
  notes?: string;
}

export interface CarePlan {
  id: string;
  patientId: string;
  clinicianId: string;
  name: string;
  description?: string;
  startDate: string;
  endDate?: string;
  status: CarePlanStatus;
  goals: CarePlanGoal[];
  supplements: CarePlanSupplement[];
  peptides: CarePlanPeptide[];
  lifestyleTasks: CarePlanLifestyleTask[];
  dietPlan?: {
    type: string;
    restrictions: string[];
    notes?: string;
  };
  notes?: string;
  version: number;
  parentVersionId?: string;
  createdAt: string;
  updatedAt: string;
}

export type AlertRuleScope = 'global' | 'patient';
export type AlertRuleCategory = 'lab' | 'biometric' | 'upload' | 'adherence' | 'symptom';
export type AlertTriggerType = 'event' | 'threshold' | 'pattern' | 'scheduled';
export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type NotificationChannel = 'in_app' | 'email' | 'sms' | 'push';

export interface AlertRuleCondition {
  event?: string;
  metric?: string;
  labCode?: string;
  operator?: '>' | '<' | '>=' | '<=' | '==' | '!=';
  value?: number;
  count?: number;
  windowHours?: number;
  durationMinutes?: number;
}

export interface AlertRule {
  id: string;
  scope: AlertRuleScope;
  patientId?: string;
  name: string;
  description?: string;
  category: AlertRuleCategory;
  triggerType: AlertTriggerType;
  condition: AlertRuleCondition;
  severity: AlertSeverity;
  notifyChannels: NotificationChannel[];
  notifyRoles: UserRole[];
  dedupeWindowMinutes: number;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

export type AlertEventStatus = 'new' | 'viewed' | 'acknowledged' | 'snoozed' | 'resolved' | 'dismissed';

export interface AlertEvent {
  id: string;
  ruleId?: string;
  rule?: AlertRule;
  patientId: string;
  patient?: Patient;
  triggerType: AlertTriggerType;
  triggerData: Record<string, unknown>;
  title: string;
  message: string;
  severity: AlertSeverity;
  status: AlertEventStatus;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  acknowledgmentNotes?: string;
  snoozedUntil?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  resolutionNotes?: string;
  createdAt: string;
}

export type NotificationStatus = 'pending' | 'sent' | 'delivered' | 'failed' | 'bounced';

export interface Notification {
  id: string;
  alertEventId: string;
  userId: string;
  channel: NotificationChannel;
  status: NotificationStatus;
  sentAt?: string;
  deliveredAt?: string;
  attempts: number;
  lastError?: string;
  subject?: string;
  body?: string;
  createdAt: string;
}

export type AuditAction = 'create' | 'read' | 'update' | 'delete' | 'export' | 'login' | 'logout' | 'sign' | 'upload';
export type AuditResourceType = 
  | 'patient'
  | 'health_history'
  | 'encounter'
  | 'lab_document'
  | 'lab_result'
  | 'biometric_reading'
  | 'care_plan'
  | 'alert_rule'
  | 'alert_event'
  | 'user'
  | 'session';

export interface AuditLogEntry {
  id: string;
  userId?: string;
  userRole?: UserRole;
  ipAddress?: string;
  userAgent?: string;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId?: string;
  description?: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  createdAt: string;
}

export interface PatientListFilters {
  search?: string;
  status?: Patient['status'];
  tags?: string[];
  assignedClinicianId?: string;
  hasAlerts?: boolean;
}

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface DashboardStats {
  totalPatients: number;
  activePatients: number;
  criticalAlerts: number;
  pendingReviews: number;
  recentLabUploads: number;
  todayEncounters: number;
}

export interface PatientTimeline {
  patientId: string;
  events: TimelineEvent[];
}

export interface TimelineEvent {
  id: string;
  type: 'lab_upload' | 'lab_result' | 'biometric' | 'encounter' | 'care_plan' | 'alert';
  title: string;
  description?: string;
  date: string;
  data?: Record<string, unknown>;
}

export interface BiometricSummary {
  biometricTypeId: string;
  typeName: string;
  latestValue: number;
  latestDate: string;
  avgValue: number;
  minValue: number;
  maxValue: number;
  readingCount: number;
  trend: 'improving' | 'stable' | 'worsening' | 'unknown';
}

export interface GlucoseStats {
  averageGlucose: number;
  timeInRange: number;
  timeAboveRange: number;
  timeBelowRange: number;
  highestReading: number;
  lowestReading: number;
  readingCount: number;
  estimatedA1c?: number;
}

export interface AlertSummary {
  total: number;
  bySeverity: Record<AlertSeverity, number>;
  byStatus: Record<AlertEventStatus, number>;
  byCategory: Record<AlertRuleCategory, number>;
}

export interface PatientThresholds {
  id: string;
  patientId: string;
  glucoseHigh: number;
  glucoseLow: number;
  glucoseCriticalHigh: number;
  glucoseCriticalLow: number;
  bpSystolicHigh: number;
  bpSystolicLow: number;
  bpDiastolicHigh: number;
  bpDiastolicLow: number;
  updatedAt: string;
  updatedBy?: string;
}

export const DEFAULT_THRESHOLDS: Omit<PatientThresholds, 'id' | 'patientId' | 'updatedAt' | 'updatedBy'> = {
  glucoseHigh: 180,
  glucoseLow: 70,
  glucoseCriticalHigh: 250,
  glucoseCriticalLow: 54,
  bpSystolicHigh: 140,
  bpSystolicLow: 90,
  bpDiastolicHigh: 90,
  bpDiastolicLow: 60,
};
