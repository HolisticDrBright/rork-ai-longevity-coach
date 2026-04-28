import type { AlertEvent, AlertSeverity, AlertEventStatus } from '@/types/clinic';

export interface MockPatient {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  sex: 'male' | 'female' | 'other';
  email?: string;
  phone?: string;
  country: string;
  status: 'active' | 'inactive' | 'archived';
  tags: string[];
  createdAt: string;
  updatedAt: string;
  alertCount: number;
  lastActivity?: string;
  latestAlert?: AlertEvent;
}

export interface MockAlertWithPatient extends AlertEvent {
  patientName: string;
}

const now = Date.now();
const minutesAgo = (m: number) => new Date(now - m * 60 * 1000).toISOString();
const hoursAgo = (h: number) => new Date(now - h * 60 * 60 * 1000).toISOString();
const daysAgo = (d: number) => new Date(now - d * 24 * 60 * 60 * 1000).toISOString();

export const mockClinicPatients: MockPatient[] = [
  {
    id: 'mock-p1',
    firstName: 'Sarah',
    lastName: 'Chen',
    dateOfBirth: '1986-03-14',
    sex: 'female',
    email: 'sarah.chen@example.com',
    phone: '+1 (415) 555-0142',
    country: 'US',
    status: 'active',
    tags: ['Hashimoto', 'High Priority'],
    createdAt: daysAgo(120),
    updatedAt: minutesAgo(35),
    alertCount: 3,
    lastActivity: minutesAgo(35),
  },
  {
    id: 'mock-p2',
    firstName: 'Marcus',
    lastName: 'Johnson',
    dateOfBirth: '1972-07-22',
    sex: 'male',
    email: 'marcus.j@example.com',
    phone: '+1 (646) 555-0119',
    country: 'US',
    status: 'active',
    tags: ['Cardio Risk', 'Pre-diabetic'],
    createdAt: daysAgo(89),
    updatedAt: hoursAgo(2),
    alertCount: 2,
    lastActivity: hoursAgo(2),
  },
  {
    id: 'mock-p3',
    firstName: 'Elena',
    lastName: 'Vasquez',
    dateOfBirth: '1991-11-03',
    sex: 'female',
    email: 'elena.v@example.com',
    country: 'US',
    status: 'active',
    tags: ['Mold Toxicity', 'Lyme'],
    createdAt: daysAgo(45),
    updatedAt: hoursAgo(6),
    alertCount: 1,
    lastActivity: hoursAgo(6),
  },
  {
    id: 'mock-p4',
    firstName: 'David',
    lastName: 'Park',
    dateOfBirth: '1979-01-18',
    sex: 'male',
    email: 'd.park@example.com',
    country: 'US',
    status: 'active',
    tags: ['Longevity', 'Athlete'],
    createdAt: daysAgo(220),
    updatedAt: hoursAgo(18),
    alertCount: 0,
    lastActivity: hoursAgo(18),
  },
  {
    id: 'mock-p5',
    firstName: 'Priya',
    lastName: 'Patel',
    dateOfBirth: '1994-05-29',
    sex: 'female',
    email: 'priya.patel@example.com',
    country: 'US',
    status: 'active',
    tags: ['Hormone Optimization'],
    createdAt: daysAgo(60),
    updatedAt: daysAgo(1),
    alertCount: 1,
    lastActivity: daysAgo(1),
  },
  {
    id: 'mock-p6',
    firstName: 'James',
    lastName: 'O’Connor',
    dateOfBirth: '1965-09-11',
    sex: 'male',
    email: 'jim.oc@example.com',
    country: 'US',
    status: 'active',
    tags: ['Cardiac', 'Metabolic'],
    createdAt: daysAgo(310),
    updatedAt: daysAgo(2),
    alertCount: 2,
    lastActivity: daysAgo(2),
  },
  {
    id: 'mock-p7',
    firstName: 'Aisha',
    lastName: 'Williams',
    dateOfBirth: '1988-12-04',
    sex: 'female',
    email: 'aisha.w@example.com',
    country: 'US',
    status: 'active',
    tags: ['Postpartum', 'Thyroid'],
    createdAt: daysAgo(30),
    updatedAt: daysAgo(3),
    alertCount: 0,
    lastActivity: daysAgo(3),
  },
  {
    id: 'mock-p8',
    firstName: 'Thomas',
    lastName: 'Reyes',
    dateOfBirth: '1958-04-25',
    sex: 'male',
    email: 't.reyes@example.com',
    country: 'US',
    status: 'inactive',
    tags: ['Longevity'],
    createdAt: daysAgo(420),
    updatedAt: daysAgo(14),
    alertCount: 0,
    lastActivity: daysAgo(14),
  },
];

export const mockClinicAlerts: MockAlertWithPatient[] = [
  {
    id: 'mock-a1',
    patientId: 'mock-p1',
    patientName: 'Sarah Chen',
    triggerType: 'threshold' as AlertEvent['triggerType'],
    triggerData: { source: 'lab', marker: 'TSH', value: 8.4, ref: '0.4–4.0 mIU/L' },
    title: 'TSH critically elevated',
    message: 'Latest panel shows TSH 8.4 mIU/L (ref 0.4–4.0). Recommend immediate review and dose adjustment.',
    severity: 'critical' as AlertSeverity,
    status: 'new' as AlertEventStatus,
    createdAt: minutesAgo(35),
  },
  {
    id: 'mock-a2',
    patientId: 'mock-p2',
    patientName: 'Marcus Johnson',
    triggerType: 'pattern' as AlertEvent['triggerType'],
    triggerData: { source: 'wearable', metric: 'restingHeartRate', value: 92, baseline: 64 },
    title: 'Resting HR sustained spike',
    message: 'Resting heart rate averaged 92 bpm over 48 hours (baseline 64). HRV down 38%.',
    severity: 'high' as AlertSeverity,
    status: 'new' as AlertEventStatus,
    createdAt: hoursAgo(2),
  },
  {
    id: 'mock-a3',
    patientId: 'mock-p1',
    patientName: 'Sarah Chen',
    triggerType: 'event' as AlertEvent['triggerType'],
    triggerData: { source: 'symptom', symptoms: ['heart palpitations', 'fatigue'] },
    title: 'New cardiac symptom reported',
    message: 'Patient logged heart palpitations and severe fatigue this morning. Possible thyroid storm watch.',
    severity: 'high' as AlertSeverity,
    status: 'new' as AlertEventStatus,
    createdAt: hoursAgo(4),
  },
  {
    id: 'mock-a4',
    patientId: 'mock-p3',
    patientName: 'Elena Vasquez',
    triggerType: 'event' as AlertEvent['triggerType'],
    triggerData: { source: 'message', request: 'connection' },
    title: 'Patient requested a consult',
    message: 'Elena is requesting a 15-min check-in regarding mold protocol side effects.',
    severity: 'medium' as AlertSeverity,
    status: 'new' as AlertEventStatus,
    createdAt: hoursAgo(6),
  },
  {
    id: 'mock-a5',
    patientId: 'mock-p2',
    patientName: 'Marcus Johnson',
    triggerType: 'threshold' as AlertEvent['triggerType'],
    triggerData: { source: 'lab', marker: 'ApoB', value: 142 },
    title: 'ApoB above target',
    message: 'ApoB 142 mg/dL — outside cardiovascular optimization target (<80). Trending up.',
    severity: 'high' as AlertSeverity,
    status: 'viewed' as AlertEventStatus,
    createdAt: hoursAgo(20),
  },
  {
    id: 'mock-a6',
    patientId: 'mock-p5',
    patientName: 'Priya Patel',
    triggerType: 'event' as AlertEvent['triggerType'],
    triggerData: { source: 'symptom', symptoms: ['cycle irregularity'] },
    title: 'Cycle pattern change',
    message: 'Patient logged 14 days of cycle irregularity. Consider DUTCH retest.',
    severity: 'medium' as AlertSeverity,
    status: 'new' as AlertEventStatus,
    createdAt: daysAgo(1),
  },
  {
    id: 'mock-a7',
    patientId: 'mock-p6',
    patientName: 'James O’Connor',
    triggerType: 'pattern' as AlertEvent['triggerType'],
    triggerData: { source: 'wearable', metric: 'spo2', value: 88 },
    title: 'Overnight SpO₂ desaturation',
    message: 'Multiple desaturation events overnight (min 88%). Possible sleep apnea — recommend sleep study.',
    severity: 'critical' as AlertSeverity,
    status: 'new' as AlertEventStatus,
    createdAt: daysAgo(2),
  },
  {
    id: 'mock-a8',
    patientId: 'mock-p6',
    patientName: 'James O’Connor',
    triggerType: 'threshold' as AlertEvent['triggerType'],
    triggerData: { source: 'lab', marker: 'HbA1c', value: 6.2 },
    title: 'HbA1c trending into pre-diabetic',
    message: 'HbA1c 6.2% — up from 5.6% six months ago. Glycemic intervention recommended.',
    severity: 'medium' as AlertSeverity,
    status: 'viewed' as AlertEventStatus,
    createdAt: daysAgo(3),
  },
];

const alertById = new Map(mockClinicAlerts.map((a) => [a.patientId, a] as const));
mockClinicPatients.forEach((p) => {
  const a = alertById.get(p.id);
  if (a) {
    p.latestAlert = {
      id: a.id,
      patientId: a.patientId,
      triggerType: a.triggerType,
      triggerData: a.triggerData,
      title: a.title,
      message: a.message,
      severity: a.severity,
      status: a.status,
      createdAt: a.createdAt,
    };
  }
});

export const mockDashboardStats = {
  totalPatients: mockClinicPatients.length,
  activePatients: mockClinicPatients.filter((p) => p.status === 'active').length,
  criticalAlerts: mockClinicAlerts.filter((a) => a.severity === 'critical').length,
  pendingReviews: mockClinicAlerts.filter((a) => a.status === 'new').length + 2,
  recentLabUploads: 4,
  todayEncounters: 2,
};

export interface MockRecentActivity {
  id: string;
  type: 'lab_upload' | 'lab_result' | 'biometric' | 'encounter' | 'care_plan' | 'alert' | 'patient_created';
  patientId: string;
  patientName: string;
  title: string;
  description?: string;
  timestamp: string;
  severity?: string;
}

export const mockRecentActivity: MockRecentActivity[] = [
  {
    id: 'act-1',
    type: 'alert',
    patientId: 'mock-p1',
    patientName: 'Sarah Chen',
    title: 'TSH critically elevated',
    description: 'Latest thyroid panel flagged for review',
    timestamp: minutesAgo(35),
    severity: 'critical',
  },
  {
    id: 'act-2',
    type: 'lab_upload',
    patientId: 'mock-p2',
    patientName: 'Marcus Johnson',
    title: 'Lab document uploaded',
    description: 'Advanced lipid panel — Boston Heart',
    timestamp: hoursAgo(2),
  },
  {
    id: 'act-3',
    type: 'biometric',
    patientId: 'mock-p2',
    patientName: 'Marcus Johnson',
    title: 'Wearable anomaly',
    description: 'Resting HR sustained spike (48h)',
    timestamp: hoursAgo(2),
    severity: 'high',
  },
  {
    id: 'act-4',
    type: 'alert',
    patientId: 'mock-p3',
    patientName: 'Elena Vasquez',
    title: 'Connection request',
    description: 'Patient requesting consult re: mold protocol',
    timestamp: hoursAgo(6),
    severity: 'medium',
  },
  {
    id: 'act-5',
    type: 'lab_result',
    patientId: 'mock-p4',
    patientName: 'David Park',
    title: 'Quarterly panel completed',
    description: 'All markers within optimization range',
    timestamp: hoursAgo(18),
  },
  {
    id: 'act-6',
    type: 'alert',
    patientId: 'mock-p6',
    patientName: 'James O’Connor',
    title: 'SpO₂ desaturation overnight',
    description: 'Possible sleep apnea — recommend study',
    timestamp: daysAgo(2),
    severity: 'critical',
  },
];

export interface MockPendingReview {
  id: string;
  type: 'lab_document' | 'alert' | 'care_plan';
  patientId: string;
  patientName: string;
  title: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  createdAt: string;
}

export const mockPendingReviews: MockPendingReview[] = [
  {
    id: 'rev-1',
    type: 'alert',
    patientId: 'mock-p1',
    patientName: 'Sarah Chen',
    title: 'Review TSH 8.4 — adjust levothyroxine',
    priority: 'critical',
    createdAt: minutesAgo(35),
  },
  {
    id: 'rev-2',
    type: 'alert',
    patientId: 'mock-p6',
    patientName: 'James O’Connor',
    title: 'Sleep apnea workup recommendation',
    priority: 'critical',
    createdAt: daysAgo(2),
  },
  {
    id: 'rev-3',
    type: 'lab_document',
    patientId: 'mock-p2',
    patientName: 'Marcus Johnson',
    title: 'Review lab: Advanced lipid panel',
    priority: 'high',
    createdAt: hoursAgo(2),
  },
  {
    id: 'rev-4',
    type: 'alert',
    patientId: 'mock-p3',
    patientName: 'Elena Vasquez',
    title: 'Consult request — mold protocol',
    priority: 'medium',
    createdAt: hoursAgo(6),
  },
  {
    id: 'rev-5',
    type: 'alert',
    patientId: 'mock-p5',
    patientName: 'Priya Patel',
    title: 'Cycle irregularity — DUTCH retest',
    priority: 'medium',
    createdAt: daysAgo(1),
  },
];
