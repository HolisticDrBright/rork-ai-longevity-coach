# App Store & Play Store Data Safety Declarations

Based on the actual data collected by AI Longevity Pro.

---

## Apple App Store — Privacy Nutrition Labels

### Data Types Collected

| Data Type | Category | Linked to Identity | Used for Tracking |
|---|---|---|---|
| Name | Contact Info | Yes | No |
| Email Address | Contact Info | Yes | No |
| Phone Number | Contact Info | Yes | No |
| Health & Fitness — Health | Health & Fitness | Yes | No |
| Health & Fitness — Fitness | Health & Fitness | Yes | No |
| User ID | Identifiers | Yes | No |
| Device ID | Identifiers | No | No |
| Crash Data | Diagnostics | No | No |
| Performance Data | Diagnostics | No | No |

### Data Use Purposes (per Apple categories)

| Purpose | Data Types |
|---|---|
| App Functionality | Name, Email, Phone, Health, Fitness, User ID |
| Analytics | Crash Data, Performance Data (de-identified) |

### Data NOT Collected
- Financial Info (no payments processed in-app)
- Location (no GPS data collected)
- Contacts (no address book access)
- Browsing History
- Search History
- Purchases
- Photos or Videos
- Audio Data
- Sensitive Info (beyond health data already declared)

### Key Declarations
- **Data Used to Track You**: No — we do not track users across other companies' apps or websites.
- **Data Linked to You**: Name, Email, Phone, Health, Fitness, User ID — all linked to the user's account.
- **Data Not Linked to You**: Crash Data, Performance Data — sent to Sentry with PHI scrubbed and no user identifier.

---

## Google Play Store — Data Safety

### Does your app collect or share any of the required user data types?

**Yes** — the app collects user data.

### Is all of the user data collected by your app encrypted in transit?

**Yes** — all network communication uses HTTPS/TLS 1.2+.

### Do you provide a way for users to request that their data is deleted?

**Yes** — users can delete all PHI from Profile > Privacy & Security > Delete All My Data.

---

### Data Types Collected

| Data Type | Collected | Shared | Purpose | Optional |
|---|---|---|---|---|
| **Personal Info — Name** | Yes | No | App functionality | No |
| **Personal Info — Email** | Yes | No | App functionality, Account management | No |
| **Personal Info — Phone** | Yes | No | App functionality | Yes |
| **Personal Info — Date of birth** | Yes | No | App functionality | No |
| **Health and fitness — Health info** | Yes | No | App functionality | No |
| **Health and fitness — Fitness info** | Yes | No | App functionality | No |
| **App activity — App interactions** | Yes | No | Analytics | No |
| **App info and performance — Crash logs** | Yes | No | Analytics | No |
| **App info and performance — Diagnostics** | Yes | No | Analytics | No |
| **Device or other IDs** | Yes | No | Analytics | No |

### Data NOT Collected
- Financial info
- Messages
- Photos and videos
- Audio files
- Files and docs
- Calendar
- Contacts
- Location

---

### Data Safety Questionnaire — Detailed Answers

**Q: Is this data collected, shared, or both?**
A: Collected only. No data is shared with third parties for their own purposes.

**Q: Is this data processed ephemerally?**
A: No — health data is persisted in the database for ongoing analysis.

**Q: Is this data required for your app, or can users choose whether it's collected?**
A: Health data collection is required for core app functionality. Phone number is optional.

**Q: Why is this user data collected?**
A: App functionality — to generate personalized health protocols, track biomarkers, and provide longevity insights.

**Q: Why is crash/diagnostic data collected?**
A: Analytics — to identify and fix bugs. All PHI is scrubbed before transmission to Sentry.

---

### Additional Notes for Reviewers

1. The app handles **Protected Health Information (PHI)** under HIPAA. A Business Associate Agreement (BAA) is in place with Supabase (database provider).
2. Sentry (error monitoring) receives only scrubbed error reports with no PHI — patient names, health values, email addresses, and authentication tokens are redacted before any payload leaves the app.
3. The app includes a full in-app privacy policy accessible from Profile > Settings > Privacy Policy.
4. Users can permanently delete all their data at any time from the app.
5. No advertising SDKs or tracking SDKs are included in the app.
