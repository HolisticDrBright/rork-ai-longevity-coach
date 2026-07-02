export const HIPAA_VERSION = '1.0.0';

export const BAA_REQUIRED_SERVICES = [
  {
    service: '@rork-ai/toolkit-sdk (AI Analysis)',
    type: 'AI Processing',
    phiExposure: 'HIGH',
    description: 'Lab images and health data sent for AI analysis (biomarker extraction, clinical analysis). PHI is transmitted to AI endpoints.',
    baaStatus: 'REQUIRED',
    mitigation: 'Data is sent only during active analysis sessions. No PHI is persisted by the service beyond processing. Consider de-identification before transmission.',
  },
  {
    service: '@react-native-async-storage/async-storage',
    type: 'Local Storage',
    phiExposure: 'HIGH',
    description: 'All PHI stored locally on device, obfuscated via the secureStorage XOR wrapper. On native the XOR key is held in expo-secure-store (Keychain/Keystore); on web the key is persisted in localStorage, which is obfuscation only, not encryption.',
    baaStatus: 'N/A (local only)',
    mitigation: 'XOR obfuscation with SecureStore-held key on native (not cryptographic-grade encryption). Upgrade to AES-256-GCM for true encryption at rest.',
  },
  {
    service: 'expo-secure-store',
    type: 'Secure Key Storage',
    phiExposure: 'LOW',
    description: 'Stores encryption key and PIN hash. Uses iOS Keychain / Android Keystore.',
    baaStatus: 'N/A (local only)',
    mitigation: 'Hardware-backed encryption on device.',
  },
  {
    service: 'expo-document-picker / expo-file-system',
    type: 'File Access',
    phiExposure: 'MEDIUM',
    description: 'Used to pick and read lab document files (PDFs, images) which contain PHI.',
    baaStatus: 'N/A (local only)',
    mitigation: 'Files read into memory temporarily for AI analysis. Not persisted in cache.',
  },
  {
    service: 'Hono Backend (tRPC)',
    type: 'API Server',
    phiExposure: 'MEDIUM',
    description: 'Backend API server processes nutrition analysis, supplement recommendations, and clinic data.',
    baaStatus: 'REQUIRED (if hosted by third party)',
    mitigation: 'Secure headers added (HSTS, no-cache, no-sniff). Error messages sanitized. Protected procedures available for auth-gated endpoints.',
  },
  {
    service: 'Passio API (nutrition)',
    type: 'External API',
    phiExposure: 'LOW',
    description: 'Food recognition API for nutrition tracking. Receives food images, not direct health data.',
    baaStatus: 'RECOMMENDED',
    mitigation: 'Only food images sent, not linked to patient identifiers.',
  },
];

export const PHI_FIELDS_INVENTORY = [
  { field: 'UserProfile', storage: 'longevity_user_profile', encrypted: true, phi: true, description: 'Name, email, DOB, sex, weight, height' },
  { field: 'LifestyleProfile', storage: 'longevity_lifestyle_profile', encrypted: true, phi: true, description: 'Sleep, stress, diet, exercise data' },
  { field: 'Contraindications', storage: 'longevity_contraindications', encrypted: true, phi: true, description: 'Pregnancy, medications, allergies, conditions' },
  { field: 'QuestionnaireResponses', storage: 'longevity_questionnaire_responses', encrypted: true, phi: true, description: 'Symptom severity scores' },
  { field: 'ClinicalIntake', storage: 'longevity_clinical_intake', encrypted: true, phi: true, description: 'Chief complaint, symptoms, clinical data' },
  { field: 'LabPanels', storage: 'longevity_lab_panels', encrypted: true, phi: true, description: 'Biomarker values, lab results, analyses' },
  { field: 'HormoneEntries', storage: 'longevity_hormone_entries', encrypted: true, phi: true, description: 'Hormone symptom tracking, cycle data' },
  { field: 'Protocols', storage: 'longevity_protocols', encrypted: true, phi: true, description: 'Supplement/peptide protocols, dosing' },
  { field: 'DailyAdherence', storage: 'longevity_daily_adherence', encrypted: true, phi: true, description: 'Protocol adherence, daily symptoms' },
  { field: 'WeeklyCheckIns', storage: 'longevity_weekly_checkins', encrypted: true, phi: true, description: 'Weight, vitals, notes' },
  { field: 'PeptidePlans', storage: 'longevity_user_peptide_plans', encrypted: true, phi: true, description: 'Peptide usage logs' },
  { field: 'DietProfile', storage: 'nutrition_diet_profile', encrypted: true, phi: true, description: 'Dietary restrictions, allergies' },
  { field: 'FoodLogs', storage: 'nutrition_food_logs', encrypted: true, phi: true, description: 'Meal photos, nutrition data' },
  { field: 'SupplementClicks', storage: 'supplements_click_events', encrypted: true, phi: true, description: 'Affiliate click tracking (patient IDs referenced, linking individuals to supplement interest)' },
  { field: 'AuditLogs', storage: 'hipaa_audit_log', encrypted: false, phi: false, description: 'Access audit trail with checksums. No PHI in log content. Retained through PHI purge (HIPAA retention).' },
];

export const SECURITY_CONTROLS = {
  encryptionAtRest: {
    status: 'PARTIAL',
    method: 'XOR obfuscation (UTF-8 + chunked base64) with a random key. Native: key held in expo-secure-store (Keychain/Keystore), giving at-rest protection backed by hardware key storage. Web: key persisted in localStorage — obfuscation only, NOT encryption.',
    note: 'XOR is not cryptographic-grade. For production HIPAA, upgrade to AES-256-GCM via a custom native module or server-side encryption. Web storage should not be considered encrypted.',
  },
  encryptionInTransit: {
    status: 'ENFORCED',
    method: 'HTTPS/TLS enforced via HSTS header. API base URL uses HTTPS.',
  },
  authentication: {
    status: 'IMPLEMENTED',
    method: '6-digit PIN with per-device salted SHA-256 hash (legacy constant-salt hashes upgraded on login) + optional biometric (Face ID / Touch ID / Fingerprint). Lockout state persists across app restarts.',
  },
  sessionManagement: {
    status: 'IMPLEMENTED',
    method: '5-minute inactivity timeout. App background detection. Manual lock.',
  },
  accessControl: {
    status: 'IMPLEMENTED',
    method: 'Role-based (patient/clinician). PIN gate before any PHI access.',
  },
  auditLogging: {
    status: 'IMPLEMENTED',
    method: 'Tamper-evident logs with SHA-256 checksums. 6-year retention. All PHI CRUD logged.',
  },
  breachDetection: {
    status: 'IMPLEMENTED',
    method: 'Rapid access detection, failed auth lockout (5 attempts / 15 min lockout), unusual hours monitoring.',
  },
  dataMinimization: {
    status: 'REVIEWED',
    note: 'All stored fields are necessary for app function. Photo base64 for food logs should be purged after analysis.',
  },
  dataDeletion: {
    status: 'PARTIAL',
    method: 'Local PHI purge via Profile > Privacy & Security > Delete All My Data. Encryption key destroyed; audit log retained per HIPAA retention. Remote rows are deleted best-effort from synced tables only — full server-side cascade deletion is not yet implemented.',
  },
  phiInLogs: {
    status: 'PARTIAL',
    method: 'Error objects are logged as message/code only (no row data) in the storage/state layer, and SSN, email, phone patterns are redacted from audit log details. Other layers of the app have not been fully audited for PHI in console output.',
  },
  apiSecurity: {
    status: 'IMPLEMENTED',
    method: 'Secure headers (HSTS, X-Frame-Options, no-cache). Error messages sanitized. Protected procedures available.',
  },
};

export const REMAINING_RECOMMENDATIONS = [
  'Upgrade encryption to AES-256-GCM using a custom native module for true HIPAA-grade encryption at rest.',
  'Implement server-side authentication with JWT tokens and session validation on every API call.',
  'Add MFA (multi-factor authentication) beyond PIN + biometric - consider TOTP or SMS verification.',
  'Sign a BAA with the AI toolkit provider (@rork-ai/toolkit-sdk) before processing real patient data.',
  'Sign a BAA with your hosting provider for the Hono backend.',
  'Implement automatic data expiration/retention policies for PHI that is no longer needed.',
  'Add network-level intrusion detection if deploying the backend publicly.',
  'Conduct a formal HIPAA risk assessment with a compliance officer.',
  'Implement PHI de-identification before sending lab images to AI analysis endpoints.',
  'Add end-to-end encryption for data transmitted between client and backend.',
  'Consider a HIPAA-compliant cloud database (e.g., AWS with BAA, Azure with BAA) instead of local-only storage for multi-device sync.',
];
