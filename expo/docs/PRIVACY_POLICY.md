# Privacy Policy

**AI Longevity Pro**
**Effective Date: March 27, 2026**
**Last Updated: March 27, 2026**

AI Longevity Pro ("we," "our," or "the Company") operates the AI Longevity Pro mobile application (the "App"). This Privacy Policy describes how we collect, use, store, and protect your personal and health-related information.

By using the App, you agree to the practices described in this policy. If you do not agree, please do not use the App.

---

## 1. Data We Collect

### 1.1 Account Information
- Name, email address, date of birth
- Authentication credentials (managed via Supabase Auth)
- Profile preferences and settings

### 1.2 Health and Biometric Data
- Lab results (blood panels, metabolic markers, hormone levels)
- Biometric measurements (weight, body composition, blood pressure, heart rate)
- Nutrition and dietary logs (including food images processed via Passio API)
- Wearable device data synced from Apple Health, Google Health Connect, or supported third-party devices
- Supplement and medication tracking entries
- Sleep, exercise, and lifestyle data

### 1.3 Practitioner/Clinic Data
If you use our practitioner portal, we additionally collect:
- Practitioner credentials and clinic affiliation
- Patient-practitioner relationship records
- Clinical notes and assessment data entered by practitioners
- Coaching session logs and care plan data

### 1.4 Technical Data
- Device type, operating system version, and app version
- Crash reports and performance data (via Sentry, with PHI scrubbing enabled)
- IP address (for security and fraud prevention only; not stored long-term)

### 1.5 Webhook Event Data
- Coaching and assessment event metadata transmitted to authorized integrations configured by you or your practitioner

---

## 2. How We Use Your Data

We use your data to:

- Provide personalized longevity insights, health scores, and recommendations
- Enable food recognition and nutritional analysis (via Passio API)
- Allow practitioners to view and manage patient health data within the clinic module
- Generate health trend reports and biomarker tracking
- Send coaching and assessment event notifications via configured webhooks
- Diagnose and fix technical issues (via anonymized and PHI-scrubbed error reports)
- Improve app functionality and user experience
- Comply with legal obligations

We do **not** use your data for advertising. We do **not** sell your data to third parties.

---

## 3. Data Storage and Security

### 3.1 Cloud Storage
Your data is stored in a PostgreSQL database managed by Supabase. Supabase provides:
- Encryption at rest (AES-256)
- Encryption in transit (TLS 1.2+)
- Row-Level Security (RLS) policies ensuring users can only access their own data
- Regular automated backups with point-in-time recovery

### 3.2 On-Device Storage
Sensitive data cached on your device is protected by:
- AES-GCM encryption for health data stored in AsyncStorage
- Cryptographic keys managed via Expo SecureStore (backed by iOS Keychain / Android Keystore)
- Data is scoped to your authenticated session and cleared on logout

### 3.3 Security Controls
We implement HIPAA-aligned security controls including:
- Immutable audit logging of all data access and modifications
- Role-based access control (RBAC) for practitioner and admin roles
- Automatic session expiration and token rotation
- PHI scrubbing on all error reports sent to Sentry
- Webhook payload signing with HMAC-SHA256

---

## 4. Third-Party Services

We use the following third-party services to operate the App:

| Service | Purpose | Data Shared |
|---------|---------|-------------|
| **Supabase** | Authentication, database, storage | Account info, health data (encrypted) |
| **Sentry** | Error tracking and performance monitoring | Anonymized crash data (PHI scrubbed) |
| **Passio API** | Food image recognition and nutritional data | Food images (processed in real-time, not retained by Passio) |
| **Fly.io** | Backend API hosting | API requests (encrypted in transit) |

We require all third-party providers to maintain security standards consistent with our own. We do not share your data with any third party for marketing or advertising purposes.

---

## 5. Practitioner Access

If you are linked to a practitioner or clinic within the App:

- Your practitioner can view your health data, lab results, biometrics, and coaching assessments
- Practitioners can add clinical notes and care plans to your record
- Practitioner access is governed by the patient-practitioner relationship you authorize
- You can revoke practitioner access at any time from your account settings
- All practitioner access is logged in the immutable audit trail

Practitioners using the clinic module agree to additional data handling obligations under their practitioner agreement.

---

## 6. Data Retention

| Data Type | Retention Period |
|-----------|-----------------|
| Account and profile data | Duration of account + 30 days after deletion |
| Health and biometric data | Duration of account + 30 days after deletion |
| Audit logs | 6 years (immutable, regulatory compliance) |
| Error/crash reports (Sentry) | 90 days |
| Practitioner clinical notes | Duration of patient-practitioner relationship + 6 years |

After the retention period, data is permanently deleted or irreversibly anonymized.

---

## 7. Your Rights

You have the right to:

- **Access** your data: Export a complete copy of your health data in a machine-readable format (JSON) from the App settings
- **Delete** your data: Request full account and data deletion from the App settings or by contacting us. Deletion is processed within 30 days, except for audit logs retained for regulatory compliance
- **Correct** your data: Update or correct any inaccurate information via the App or by contacting us
- **Restrict processing**: Request that we limit how your data is used
- **Portability**: Export your data and transfer it to another service
- **Withdraw consent**: Revoke consent for optional data processing at any time

To exercise any of these rights, use the in-app settings or contact us at **privacy@ailongevitypro.com**.

Residents of California (CCPA), the European Economic Area (GDPR), and other jurisdictions with applicable data protection laws may have additional rights. We will respond to verified requests within the timeframes required by applicable law.

---

## 8. Children's Privacy

The App is not intended for use by individuals under the age of 18. We do not knowingly collect personal information from children. If we learn that we have collected data from a child under 18, we will delete it promptly. If you believe a child has provided us with personal information, contact us at **privacy@ailongevitypro.com**.

---

## 9. Changes to This Policy

We may update this Privacy Policy from time to time. When we make material changes, we will:

- Update the "Last Updated" date at the top of this policy
- Notify you via in-app notification or email
- Require re-acceptance for material changes affecting health data handling

Continued use of the App after changes constitutes acceptance of the updated policy.

---

## 10. Contact Us

If you have questions or concerns about this Privacy Policy or our data practices:

**AI Longevity Pro**
Email: privacy@ailongevitypro.com

For data protection inquiries in the EU, you may also contact your local supervisory authority.
