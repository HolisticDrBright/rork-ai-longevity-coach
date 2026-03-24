# Clinic Backend Architecture

## Overview

This document outlines the architecture for a HIPAA-aligned clinical practice management system supporting patient records, labs, biometrics, protocols, and an intelligent alert engine.

---

## A) Technology Stack Recommendation

### Backend Stack
| Component | Technology | Rationale |
|-----------|------------|-----------|
| API Framework | Hono + tRPC | Already in use, type-safe, fast |
| Database | PostgreSQL (Supabase/Neon) | ACID compliance, JSON support, row-level security |
| Auth | Supabase Auth / Clerk | MFA support, RBAC, session management |
| File Storage | Supabase Storage / S3 | Signed URLs, encryption at rest |
| Background Jobs | Trigger.dev / Inngest | Event-driven, serverless-friendly |
| Email/SMS | Resend + Twilio | Transactional alerts |
| Caching | Upstash Redis | Rate limiting, session cache |

### Why This Stack?
- **PostgreSQL**: Healthcare data requires ACID transactions, audit trails, and complex queries
- **Supabase**: Provides auth, storage, and database with built-in RLS (Row Level Security)
- **tRPC**: Type-safe APIs reduce bugs in critical healthcare workflows
- **Event-driven jobs**: Alert engine needs real-time and scheduled processing

---

## B) Database Schema

### Core Tables

```sql
-- =====================
-- USERS & AUTHENTICATION
-- =====================

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  role TEXT NOT NULL CHECK (role IN ('clinician', 'staff', 'patient')),
  mfa_enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true
);

CREATE TABLE user_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL, -- e.g., 'view_labs', 'edit_notes', 'manage_alerts'
  granted_by UUID REFERENCES users(id),
  granted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_user_permissions_user ON user_permissions(user_id);

-- =====================
-- PATIENTS
-- =====================

CREATE TABLE patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id), -- NULL if patient doesn't have app access
  
  -- Demographics
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  date_of_birth DATE NOT NULL,
  sex TEXT CHECK (sex IN ('male', 'female', 'other')),
  email TEXT,
  phone TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state TEXT,
  zip_code TEXT,
  country TEXT DEFAULT 'US',
  
  -- Emergency Contact
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  emergency_contact_relationship TEXT,
  
  -- Status
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  tags TEXT[] DEFAULT '{}',
  assigned_clinician_id UUID REFERENCES users(id),
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);

CREATE INDEX idx_patients_user ON patients(user_id);
CREATE INDEX idx_patients_clinician ON patients(assigned_clinician_id);
CREATE INDEX idx_patients_status ON patients(status);
CREATE INDEX idx_patients_name ON patients(last_name, first_name);

-- =====================
-- HEALTH HISTORY
-- =====================

CREATE TABLE patient_health_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
  
  -- Conditions
  conditions TEXT[] DEFAULT '{}',
  past_conditions TEXT[] DEFAULT '{}',
  family_history TEXT[] DEFAULT '{}',
  
  -- Medications & Allergies
  current_medications JSONB DEFAULT '[]', -- [{name, dose, frequency, prescriber}]
  past_medications JSONB DEFAULT '[]',
  allergies JSONB DEFAULT '[]', -- [{allergen, reaction, severity}]
  
  -- Lifestyle
  smoking_status TEXT,
  alcohol_use TEXT,
  exercise_frequency TEXT,
  diet_type TEXT,
  sleep_hours_avg NUMERIC,
  stress_level INTEGER,
  
  -- Reproductive (if applicable)
  pregnant BOOLEAN DEFAULT false,
  nursing BOOLEAN DEFAULT false,
  menstrual_status TEXT,
  
  -- Metadata
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id)
);

CREATE UNIQUE INDEX idx_health_history_patient ON patient_health_history(patient_id);

-- =====================
-- ENCOUNTERS / NOTES
-- =====================

CREATE TABLE encounters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
  clinician_id UUID REFERENCES users(id),
  
  encounter_date TIMESTAMPTZ NOT NULL,
  encounter_type TEXT CHECK (encounter_type IN ('initial', 'follow_up', 'phone', 'telehealth', 'message')),
  
  -- SOAP Note (optional structure)
  subjective TEXT,
  objective TEXT,
  assessment TEXT,
  plan TEXT,
  
  -- Or free-form
  notes TEXT,
  
  -- Attachments
  attachments JSONB DEFAULT '[]', -- [{file_id, name, type}]
  
  -- Status
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'signed', 'amended', 'locked')),
  signed_at TIMESTAMPTZ,
  signed_by UUID REFERENCES users(id),
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_encounters_patient ON encounters(patient_id);
CREATE INDEX idx_encounters_clinician ON encounters(clinician_id);
CREATE INDEX idx_encounters_date ON encounters(encounter_date DESC);

-- =====================
-- LAB DOCUMENTS
-- =====================

CREATE TABLE lab_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
  
  -- File info
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL, -- 'pdf', 'jpg', 'png'
  file_size_bytes INTEGER,
  storage_path TEXT NOT NULL, -- S3/Supabase path
  thumbnail_path TEXT,
  
  -- Metadata
  lab_date DATE,
  lab_company TEXT,
  ordering_provider TEXT,
  panel_name TEXT,
  
  -- Processing status
  processing_status TEXT DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'parsed', 'manual_entry', 'error')),
  parsed_at TIMESTAMPTZ,
  
  -- Upload info
  uploaded_by UUID REFERENCES users(id),
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_lab_documents_patient ON lab_documents(patient_id);
CREATE INDEX idx_lab_documents_date ON lab_documents(lab_date DESC);
CREATE INDEX idx_lab_documents_status ON lab_documents(processing_status);

-- =====================
-- LAB RESULTS (Structured)
-- =====================

CREATE TABLE lab_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL, -- LOINC code or internal
  name TEXT NOT NULL,
  category TEXT, -- 'thyroid', 'lipid', 'metabolic', etc.
  unit TEXT NOT NULL,
  
  -- Reference ranges (defaults)
  ref_range_low NUMERIC,
  ref_range_high NUMERIC,
  functional_range_low NUMERIC,
  functional_range_high NUMERIC,
  
  -- Critical values
  critical_low NUMERIC,
  critical_high NUMERIC,
  
  description TEXT,
  is_active BOOLEAN DEFAULT true
);

CREATE INDEX idx_lab_tests_code ON lab_tests(code);
CREATE INDEX idx_lab_tests_category ON lab_tests(category);

CREATE TABLE lab_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
  lab_document_id UUID REFERENCES lab_documents(id) ON DELETE SET NULL,
  lab_test_id UUID REFERENCES lab_tests(id),
  
  -- Result
  value NUMERIC NOT NULL,
  value_text TEXT, -- For non-numeric results
  unit TEXT NOT NULL,
  
  -- Ranges (can override defaults)
  ref_range_low NUMERIC,
  ref_range_high NUMERIC,
  
  -- Status
  status TEXT CHECK (status IN ('normal', 'low', 'high', 'critical_low', 'critical_high')),
  
  -- Metadata
  result_date DATE NOT NULL,
  entered_by UUID REFERENCES users(id),
  entry_method TEXT CHECK (entry_method IN ('manual', 'parsed', 'api')),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_lab_results_patient ON lab_results(patient_id);
CREATE INDEX idx_lab_results_test ON lab_results(lab_test_id);
CREATE INDEX idx_lab_results_date ON lab_results(result_date DESC);
CREATE INDEX idx_lab_results_status ON lab_results(status);

-- =====================
-- BIOMETRICS READINGS
-- =====================

CREATE TABLE biometric_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL, -- 'glucose', 'bp_systolic', 'bp_diastolic', 'weight', 'hrv', etc.
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  category TEXT, -- 'vital', 'metabolic', 'body_composition', 'sleep'
  
  -- Default thresholds
  normal_low NUMERIC,
  normal_high NUMERIC,
  warning_low NUMERIC,
  warning_high NUMERIC,
  critical_low NUMERIC,
  critical_high NUMERIC,
  
  is_active BOOLEAN DEFAULT true
);

CREATE TABLE biometric_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
  biometric_type_id UUID REFERENCES biometric_types(id),
  
  value NUMERIC NOT NULL,
  unit TEXT NOT NULL,
  
  -- Context
  reading_time TIMESTAMPTZ NOT NULL,
  context TEXT, -- 'fasting', 'post_meal', 'pre_exercise', etc.
  notes TEXT,
  
  -- Source
  source TEXT CHECK (source IN ('manual', 'device_sync', 'cgm', 'app')),
  device_name TEXT,
  
  -- Status (calculated)
  status TEXT CHECK (status IN ('normal', 'warning_low', 'warning_high', 'critical_low', 'critical_high')),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_biometric_readings_patient ON biometric_readings(patient_id);
CREATE INDEX idx_biometric_readings_type ON biometric_readings(biometric_type_id);
CREATE INDEX idx_biometric_readings_time ON biometric_readings(reading_time DESC);
CREATE INDEX idx_biometric_readings_status ON biometric_readings(status);

-- =====================
-- PROTOCOLS / CARE PLANS
-- =====================

CREATE TABLE care_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
  clinician_id UUID REFERENCES users(id),
  
  name TEXT NOT NULL,
  description TEXT,
  
  -- Dates
  start_date DATE NOT NULL,
  end_date DATE,
  
  -- Status
  status TEXT DEFAULT 'active' CHECK (status IN ('draft', 'active', 'paused', 'completed', 'archived')),
  
  -- Content
  goals JSONB DEFAULT '[]', -- [{goal, target_date, status}]
  supplements JSONB DEFAULT '[]', -- [{name, dose, frequency, timing, link}]
  peptides JSONB DEFAULT '[]',
  lifestyle_tasks JSONB DEFAULT '[]',
  diet_plan JSONB,
  
  -- Notes
  notes TEXT,
  
  -- Versioning
  version INTEGER DEFAULT 1,
  parent_version_id UUID REFERENCES care_plans(id),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_care_plans_patient ON care_plans(patient_id);
CREATE INDEX idx_care_plans_status ON care_plans(status);

CREATE TABLE care_plan_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  care_plan_id UUID REFERENCES care_plans(id) ON DELETE CASCADE,
  
  task_type TEXT NOT NULL, -- 'supplement', 'peptide', 'lifestyle', 'lab', 'appointment'
  title TEXT NOT NULL,
  description TEXT,
  
  -- Schedule
  frequency TEXT, -- 'daily', 'weekly', 'as_needed'
  timing TEXT,
  due_date DATE,
  
  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'skipped', 'overdue')),
  completed_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_care_plan_tasks_plan ON care_plan_tasks(care_plan_id);

-- =====================
-- ALERT RULES
-- =====================

CREATE TABLE alert_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Scope
  scope TEXT NOT NULL CHECK (scope IN ('global', 'patient')),
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE, -- NULL for global
  
  -- Rule definition
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL, -- 'lab', 'biometric', 'upload', 'adherence', 'symptom'
  
  -- Trigger type
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('event', 'threshold', 'pattern', 'scheduled')),
  
  -- Condition (JSON for flexibility)
  condition JSONB NOT NULL,
  /*
    Examples:
    - Lab upload: {"event": "lab_document_uploaded"}
    - Glucose threshold: {"metric": "glucose", "operator": ">", "value": 180, "duration_minutes": null}
    - Pattern: {"metric": "glucose", "operator": ">", "value": 180, "count": 3, "window_hours": 24}
    - Critical lab: {"lab_code": "A1C", "operator": ">", "value": 9}
  */
  
  -- Severity
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
  
  -- Notifications
  notify_channels TEXT[] DEFAULT '{in_app}', -- ['in_app', 'email', 'sms']
  notify_roles TEXT[] DEFAULT '{clinician}', -- ['clinician', 'staff', 'patient']
  
  -- Rate limiting
  dedupe_window_minutes INTEGER DEFAULT 60,
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  
  -- Status
  is_enabled BOOLEAN DEFAULT true,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);

CREATE INDEX idx_alert_rules_scope ON alert_rules(scope, patient_id);
CREATE INDEX idx_alert_rules_category ON alert_rules(category);
CREATE INDEX idx_alert_rules_enabled ON alert_rules(is_enabled);

-- =====================
-- ALERT EVENTS
-- =====================

CREATE TABLE alert_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID REFERENCES alert_rules(id) ON DELETE SET NULL,
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
  
  -- What triggered it
  trigger_type TEXT NOT NULL,
  trigger_data JSONB NOT NULL, -- The data that caused the alert
  
  -- Alert info
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  severity TEXT NOT NULL,
  
  -- Status
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'viewed', 'acknowledged', 'snoozed', 'resolved', 'dismissed')),
  
  -- Acknowledgment
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES users(id),
  acknowledgment_notes TEXT,
  
  -- Snooze
  snoozed_until TIMESTAMPTZ,
  
  -- Resolution
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id),
  resolution_notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_alert_events_patient ON alert_events(patient_id);
CREATE INDEX idx_alert_events_status ON alert_events(status);
CREATE INDEX idx_alert_events_severity ON alert_events(severity);
CREATE INDEX idx_alert_events_created ON alert_events(created_at DESC);

-- =====================
-- NOTIFICATIONS
-- =====================

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_event_id UUID REFERENCES alert_events(id) ON DELETE CASCADE,
  
  -- Recipient
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  
  -- Channel
  channel TEXT NOT NULL CHECK (channel IN ('in_app', 'email', 'sms', 'push')),
  
  -- Delivery
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'failed', 'bounced')),
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  
  -- For retries
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  
  -- Content (for audit)
  subject TEXT,
  body TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_status ON notifications(status);
CREATE INDEX idx_notifications_alert ON notifications(alert_event_id);

-- =====================
-- AUDIT LOG
-- =====================

CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Who
  user_id UUID REFERENCES users(id),
  user_role TEXT,
  ip_address INET,
  user_agent TEXT,
  
  -- What
  action TEXT NOT NULL, -- 'create', 'read', 'update', 'delete', 'export', 'login', 'logout'
  resource_type TEXT NOT NULL, -- 'patient', 'lab_result', 'encounter', etc.
  resource_id UUID,
  
  -- Details
  description TEXT,
  old_values JSONB,
  new_values JSONB,
  
  -- When
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_log_user ON audit_log(user_id);
CREATE INDEX idx_audit_log_resource ON audit_log(resource_type, resource_id);
CREATE INDEX idx_audit_log_action ON audit_log(action);
CREATE INDEX idx_audit_log_created ON audit_log(created_at DESC);

-- Partition by month for performance (optional)
-- CREATE TABLE audit_log_y2024m01 PARTITION OF audit_log
--   FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');
```

---

## C) API Design

### Authentication Endpoints

```
POST   /api/auth/login          - Email/password login
POST   /api/auth/mfa/verify     - MFA verification
POST   /api/auth/logout         - Logout (invalidate session)
POST   /api/auth/refresh        - Refresh access token
GET    /api/auth/me             - Current user info
```

### Patient Endpoints

```
GET    /api/patients                    - List patients (search, filter, paginate)
POST   /api/patients                    - Create patient
GET    /api/patients/:id                - Get patient details
PUT    /api/patients/:id                - Update patient
DELETE /api/patients/:id                - Soft delete (archive) patient
GET    /api/patients/:id/timeline       - Get patient timeline (labs, notes, biometrics)
POST   /api/patients/:id/export         - Export patient record (JSON/PDF)

GET    /api/patients/:id/health-history - Get health history
PUT    /api/patients/:id/health-history - Update health history
```

### Encounter/Notes Endpoints

```
GET    /api/patients/:id/encounters     - List encounters
POST   /api/patients/:id/encounters     - Create encounter
GET    /api/encounters/:id              - Get encounter
PUT    /api/encounters/:id              - Update encounter
POST   /api/encounters/:id/sign         - Sign/lock encounter
```

### Lab Endpoints

```
GET    /api/patients/:id/lab-documents  - List lab documents
POST   /api/patients/:id/lab-documents  - Upload lab document
GET    /api/lab-documents/:id           - Get document details
GET    /api/lab-documents/:id/download  - Get signed download URL
DELETE /api/lab-documents/:id           - Delete document

GET    /api/patients/:id/lab-results    - List lab results
POST   /api/patients/:id/lab-results    - Add lab result (manual entry)
PUT    /api/lab-results/:id             - Update lab result
DELETE /api/lab-results/:id             - Delete lab result

GET    /api/lab-tests                   - List available lab tests
POST   /api/lab-tests                   - Add lab test definition (admin)
```

### Biometrics Endpoints

```
GET    /api/patients/:id/biometrics             - List biometric readings
POST   /api/patients/:id/biometrics             - Add reading
GET    /api/patients/:id/biometrics/summary     - Get summary stats
GET    /api/patients/:id/biometrics/glucose     - Glucose-specific queries

GET    /api/biometric-types                     - List biometric types
POST   /api/biometric-types                     - Add type (admin)
```

### Care Plan Endpoints

```
GET    /api/patients/:id/care-plans     - List care plans
POST   /api/patients/:id/care-plans     - Create care plan
GET    /api/care-plans/:id              - Get care plan
PUT    /api/care-plans/:id              - Update care plan
POST   /api/care-plans/:id/activate     - Activate plan
POST   /api/care-plans/:id/pause        - Pause plan
POST   /api/care-plans/:id/complete     - Mark complete
```

### Alert Endpoints

```
GET    /api/alert-rules                 - List alert rules
POST   /api/alert-rules                 - Create rule
PUT    /api/alert-rules/:id             - Update rule
DELETE /api/alert-rules/:id             - Delete rule
POST   /api/alert-rules/:id/toggle      - Enable/disable

GET    /api/alerts                      - List alert events (inbox)
GET    /api/alerts/:id                  - Get alert details
POST   /api/alerts/:id/acknowledge      - Acknowledge alert
POST   /api/alerts/:id/snooze           - Snooze alert
POST   /api/alerts/:id/resolve          - Resolve alert
POST   /api/alerts/:id/dismiss          - Dismiss alert

GET    /api/alerts/summary              - Alert counts by severity/status
```

### Dashboard Endpoints

```
GET    /api/dashboard/stats             - Overview stats
GET    /api/dashboard/recent-activity   - Recent patient activity
GET    /api/dashboard/pending-reviews   - Items needing review
```

---

## D) Background Jobs Design

### Job Types

| Job | Trigger | Frequency | Purpose |
|-----|---------|-----------|---------|
| `processLabUpload` | Event (upload) | Real-time | Generate thumbnail, queue for parsing |
| `parseLabDocument` | Event (upload) | Real-time | OCR/AI extraction (V2) |
| `evaluateAlertRules` | Event (new data) | Real-time | Check thresholds on new readings |
| `evaluatePatternRules` | Scheduled | Every 15 min | Check time-based patterns |
| `sendNotifications` | Event (alert) | Real-time | Dispatch email/SMS/push |
| `cleanupExpiredSessions` | Scheduled | Hourly | Security maintenance |
| `generateDailyDigest` | Scheduled | Daily 6 AM | Summary email for clinician |

### Alert Engine Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    DATA INGESTION                           │
├─────────────────────────────────────────────────────────────┤
│  Lab Upload  │  Biometric Reading  │  Lab Result Added     │
└──────┬───────┴──────────┬──────────┴──────────┬────────────┘
       │                  │                      │
       ▼                  ▼                      ▼
┌─────────────────────────────────────────────────────────────┐
│                  EVENT BUS / QUEUE                          │
│              (Trigger.dev / Inngest)                        │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  RULE EVALUATION ENGINE                     │
├─────────────────────────────────────────────────────────────┤
│  1. Fetch applicable rules (global + patient-specific)      │
│  2. Check dedupe window (avoid duplicate alerts)            │
│  3. Evaluate conditions against data                        │
│  4. Check quiet hours                                       │
│  5. Create alert_event if triggered                         │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  NOTIFICATION DISPATCHER                    │
├─────────────────────────────────────────────────────────────┤
│  1. Determine recipients (by role + preferences)            │
│  2. Create notification records                             │
│  3. Dispatch via channels (in_app, email, sms)              │
│  4. Update delivery status                                  │
└─────────────────────────────────────────────────────────────┘
```

### Alert Rule Condition Examples

```typescript
// Lab Upload Event
{
  trigger_type: "event",
  condition: { event: "lab_document_uploaded" }
}

// Single Threshold (immediate)
{
  trigger_type: "threshold",
  condition: {
    metric: "glucose",
    operator: ">",
    value: 250
  }
}

// Pattern Detection (multiple readings)
{
  trigger_type: "pattern",
  condition: {
    metric: "glucose",
    operator: ">",
    value: 180,
    count: 3,
    window_hours: 24
  }
}

// Critical Lab Value
{
  trigger_type: "threshold",
  condition: {
    lab_code: "CREATININE",
    operator: ">",
    value: 2.0
  }
}
```

---

## E) Clinician Portal Pages

### Page List

1. **Dashboard** - Overview, alerts, recent activity
2. **Patients List** - Search, filter, tags, quick actions
3. **Patient Detail** - Tabs: Overview, Timeline, Labs, Biometrics, Notes, Plans, Alerts
4. **Alerts Inbox** - Filter by severity, status, patient; bulk actions
5. **Alert Rules** - Manage global and patient-specific rules
6. **Lab Management** - Upload queue, parsing status, manual entry
7. **Settings** - Profile, notifications, team management

### Wireframe: Dashboard

```
┌─────────────────────────────────────────────────────────────┐
│  CLINIC DASHBOARD                           [Dr. Name] [⚙]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│  │  🔴 12      │ │  📋 8       │ │  👥 47      │           │
│  │  Critical   │ │  Pending    │ │  Active     │           │
│  │  Alerts     │ │  Reviews    │ │  Patients   │           │
│  └─────────────┘ └─────────────┘ └─────────────┘           │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  ALERTS REQUIRING ATTENTION                          │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │  🔴 Jane Doe - Glucose 285 mg/dL    [View] [Ack]    │   │
│  │  🟠 John Smith - New lab uploaded   [View] [Review] │   │
│  │  🟠 Mary Johnson - A1C 8.9%         [View] [Ack]    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  RECENT ACTIVITY                                     │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │  • Jane Doe uploaded lab results       2 hours ago  │   │
│  │  • John Smith logged glucose reading   3 hours ago  │   │
│  │  • Care plan updated for Mary J.       Yesterday    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Wireframe: Patient Detail

```
┌─────────────────────────────────────────────────────────────┐
│  ← Back    JANE DOE                    [Message] [Edit]     │
│            DOB: 1985-03-15 | F | Active                     │
├─────────────────────────────────────────────────────────────┤
│  [Overview] [Timeline] [Labs] [Biometrics] [Notes] [Plans]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ALERTS (3)                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  🔴 Glucose 285 - 2 hours ago          [Acknowledge] │   │
│  │  🟡 3 high readings in 24h             [View Details]│   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  GLUCOSE TREND (7 days)                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │     ╭─╮                                              │   │
│  │  ───┼─┼────────────────────────────── 180 threshold │   │
│  │     ╰─╯  ╭╮    ╭─╮                                   │   │
│  │  ────────╯╰────╯ ╰───────────────────               │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  CURRENT PROTOCOL                                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Metabolic Reset Protocol v2                         │   │
│  │  Started: Jan 15, 2025 | Status: Active              │   │
│  │  • Berberine 500mg 2x/day                           │   │
│  │  • Chromium 200mcg AM                               │   │
│  │  • Intermittent fasting 16:8                        │   │
│  │                                   [Edit] [View Full] │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## F) MVP vs V2 Plan

### MVP (Phase 1) - 6-8 weeks

**Core Features:**
- [ ] Patient CRUD with health history
- [ ] Lab document upload (no parsing)
- [ ] Manual lab result entry
- [ ] Biometric readings (glucose, BP, weight)
- [ ] Basic encounter notes
- [ ] Care plan management
- [ ] Simple threshold alerts (glucose, critical labs)
- [ ] In-app notifications
- [ ] Basic clinician dashboard
- [ ] Email alerts (critical only)
- [ ] Audit logging

**Auth:**
- [ ] Email/password login
- [ ] Role-based access (clinician, patient)
- [ ] Session management

### V2 (Phase 2) - 4-6 weeks

**Enhanced Features:**
- [ ] Lab document OCR/parsing
- [ ] Pattern-based alerts
- [ ] Alert rule builder UI
- [ ] SMS notifications
- [ ] Staff role with configurable permissions
- [ ] Patient timeline view
- [ ] Bulk operations
- [ ] Data export (patient record)
- [ ] MFA for clinicians

### V3 (Phase 3) - Future

- [ ] Device integrations (CGM, wearables)
- [ ] Appointment scheduling
- [ ] Messaging/chat
- [ ] Multi-clinician practice support
- [ ] AI-powered insights
- [ ] Patient portal app

---

## G) Security & Compliance Checklist

### Encryption
- [x] TLS 1.3 for all connections
- [ ] AES-256 encryption at rest (database)
- [ ] AES-256 encryption for file storage
- [ ] Encrypted backups

### Access Control
- [ ] Role-based access control (RBAC)
- [ ] Row-level security in database
- [ ] Signed URLs for file access (15 min expiry)
- [ ] Session timeout (30 min inactive)
- [ ] MFA for clinicians

### Audit
- [ ] All PHI access logged
- [ ] All modifications logged
- [ ] IP address and user agent captured
- [ ] Immutable audit log (append-only)

### Data Management
- [ ] Patient data export functionality
- [ ] Patient data deletion workflow
- [ ] Data retention policies
- [ ] Backup and recovery tested

### Infrastructure
- [ ] BAA signed with cloud provider
- [ ] Network isolation / VPC
- [ ] Regular security scans
- [ ] Penetration testing (annual)

---

## H) Edge Cases

1. **Incomplete Profile**: Allow patient creation with minimal data; flag for completion
2. **Missing Dosing Data**: Show "Data unavailable" rather than guess
3. **Contraindications**: Block certain protocols; require clinician override
4. **Timezone Handling**: Store all times in UTC; display in user's timezone
5. **Rate Limiting**: Cap API calls; prevent notification spam
6. **Concurrent Edits**: Use optimistic locking (version field)
7. **Large Files**: Limit upload size (25MB); compress images
8. **Network Failures**: Queue notifications for retry
9. **Duplicate Alerts**: Dedupe by rule + patient + time window
