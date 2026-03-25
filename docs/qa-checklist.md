# Pre-Submission QA Checklist

AI Longevity Pro — v1.0.0

---

## 1. Authentication Flows

- [ ] **Sign Up** — Create a new account with email + password. Verify the user lands on onboarding.
- [ ] **Sign In** — Sign in with existing credentials. Verify the user lands on the main app (Today tab).
- [ ] **Magic Link** — Request a magic link via email. Open the link and verify the user is authenticated and redirected into the app.
- [ ] **Sign Out** — Tap Profile > Privacy & Security > Lock Session. Verify the auth screen is shown and the session is cleared from secure storage.
- [ ] **Session Persistence** — Sign in, force-quit the app, reopen. Verify the user is still authenticated (token retrieved from expo-secure-store).
- [ ] **Biometric Auth** — Enable biometric unlock in Profile > Privacy & Security. Lock session, reopen. Verify Face ID / fingerprint prompt appears.
- [ ] **Invalid Credentials** — Attempt sign-in with wrong password. Verify a user-friendly error is shown (not a stack trace).
- [ ] **Expired Token** — Wait for token expiry (or manually clear). Verify the app gracefully redirects to auth screen.

---

## 2. Onboarding Completion

- [ ] **Questionnaire Flow** — Complete all onboarding questionnaire steps. Verify each question category records severity scores.
- [ ] **Lifestyle Profile** — Complete the lifestyle step (sleep, exercise, diet, stress). Verify values are saved.
- [ ] **Onboarding Redirect** — After completing onboarding, verify the user is redirected to the main app and the onboarding flag (`onboarding_completed`) is set to `true` in the `profiles` table.
- [ ] **Skip Prevention** — Verify the user cannot navigate to main app tabs without completing onboarding.
- [ ] **Reset Onboarding** — Tap Profile > Reset & Start Over. Verify the user is sent back to onboarding and prior data is cleared.

---

## 3. Clinic Routes (Clinician Portal)

- [ ] **Clinician Toggle** — Enable clinician mode in Profile > Clinician Mode. Verify the Clinic tab appears in the tab bar.
- [ ] **Patient List** — Navigate to Clinic > Patients. Verify the patient list loads from Supabase via tRPC.
- [ ] **Patient Detail** — Tap a patient. Verify the detail view shows demographics, labs, biometrics, and alerts.
- [ ] **Lab Results** — View lab results for a patient. Verify biomarker values, reference ranges, and dates render correctly.
- [ ] **Biometrics** — View biometric data for a patient. Verify HRV, resting HR, sleep, and activity data loads.
- [ ] **Alerts** — Navigate to Clinic > Alerts. Verify practitioner flags load with severity, date, and summary.
- [ ] **Dashboard** — Navigate to Clinic > Dashboard. Verify aggregate stats render (patient count, active alerts, recent activity).
- [ ] **Supplements Admin** — Navigate to Clinic > Supplements Admin. Verify the supplement management interface loads.
- [ ] **Error States** — Disconnect from network. Verify clinic routes show error states, not blank screens or crashes.

---

## 4. Data Persistence

- [ ] **Profile Data** — Edit profile fields, force-quit, reopen. Verify changes persist.
- [ ] **Lab Panel** — Add a lab panel with biomarkers. Force-quit, reopen. Verify the panel is still visible.
- [ ] **Nutrition Log** — Log a meal. Force-quit, reopen. Verify the meal log persists on the Nutrition tab.
- [ ] **Supplement Log** — Log a supplement dose. Force-quit, reopen. Verify the log persists.
- [ ] **Protocol Adherence** — Mark supplements/tasks as done for today. Force-quit, reopen. Verify adherence state persists.
- [ ] **Symptom Log** — Log a symptom with severity. Force-quit, reopen. Verify the entry persists.
- [ ] **Hormone Entry** — Add a hormone tracking entry. Force-quit, reopen. Verify it persists.
- [ ] **Wearable Data** — If a wearable is connected, verify synced data persists across restarts.
- [ ] **Questionnaire Responses** — Complete onboarding questionnaire. Verify responses are in the `questionnaire_responses` table.

---

## 5. RLS Verification (Row-Level Security)

- [ ] **User Isolation — Profiles** — Sign in as User A. Query `profiles` from Supabase dashboard using User B's token. Verify User B cannot see User A's profile.
- [ ] **User Isolation — Health Data** — Sign in as User A, add a lab panel. Sign in as User B. Verify User B's Labs tab does not show User A's lab panel.
- [ ] **User Isolation — Meal Logs** — User A logs a meal. Verify User B cannot see it via tRPC or direct Supabase query.
- [ ] **User Isolation — Clinic Data** — If User A is a clinician, verify they can only see patients assigned to them (via `clinic_patients.clinician_id`).
- [ ] **Direct API Test** — Use `curl` with User A's token to call a tRPC endpoint. Verify only User A's data is returned.
- [ ] **RLS on All Tables** — Run the following query in Supabase SQL editor to confirm RLS is enabled on all tables:
  ```sql
  SELECT tablename, rowsecurity
  FROM pg_tables
  WHERE schemaname = 'public'
  ORDER BY tablename;
  ```
  Verify every table shows `rowsecurity = true`.
- [ ] **Policy Coverage** — Run:
  ```sql
  SELECT tablename, policyname, cmd
  FROM pg_policies
  WHERE schemaname = 'public'
  ORDER BY tablename, cmd;
  ```
  Verify every table has policies for SELECT, INSERT, UPDATE, and DELETE.

---

## 6. Sentry Error Capture Verification

- [ ] **Client-Side Capture** — Trigger a JavaScript error in the app (e.g., navigate to a broken route). Verify the error appears in Sentry dashboard within 60 seconds.
- [ ] **Unhandled Promise Rejection** — Create an unhandled async error. Verify Sentry captures it with `source: unhandledRejection` tag.
- [ ] **Backend Capture** — Trigger a tRPC error (e.g., call a protected route without auth). Verify Sentry captures the backend error with `source: hono_backend` tag.
- [ ] **PHI Scrubbing — Client** — Trigger an error that includes a patient name or email in context. Verify the Sentry event shows `[REDACTED]` instead of the actual value.
- [ ] **PHI Scrubbing — Backend** — Trigger a backend error in a clinic route. Verify breadcrumbs and extra data in Sentry contain no patient names, health values, or tokens.
- [ ] **Breadcrumb Scrubbing** — Verify HTTP breadcrumbs in Sentry have authorization headers stripped and URLs with PHI query params redacted.
- [ ] **User Context** — Verify Sentry events include only `user.id` (UUID), not email or username.

---

## 7. Build & Run

### iOS
- [ ] **EAS Build (Development)** — Run `eas build --profile development --platform ios`. Verify the build completes without errors.
- [ ] **EAS Build (Production)** — Run `eas build --profile production --platform ios`. Verify the build completes.
- [ ] **iOS Simulator** — Install the development build on iOS Simulator. Verify the app launches, onboarding works, and all tabs are functional.
- [ ] **Physical Device** — Install via TestFlight or development build on a real iPhone. Verify biometric auth, haptics, and secure storage work.

### Android
- [ ] **EAS Build (Development)** — Run `eas build --profile development --platform android`. Verify the build completes without errors.
- [ ] **EAS Build (Production)** — Run `eas build --profile production --platform android`. Verify the build completes.
- [ ] **Android Emulator** — Install the development build on Android Emulator. Verify the app launches and all tabs are functional.
- [ ] **Physical Device** — Install the APK on a real Android device. Verify biometric auth and secure storage work.

### Web
- [ ] **Web Preview** — Run the app in web mode. Verify the app loads, auth works, and no web-incompatible APIs crash.
- [ ] **Platform Guards** — Verify `Platform.OS !== 'web'` guards are in place for native-only APIs (biometric auth, etc.).

---

## 8. Privacy & Compliance

- [ ] **Privacy Policy Screen** — Navigate to Profile > Settings > Privacy Policy. Verify the full policy renders with all sections.
- [ ] **HIPAA Consent Banner** — On first login, verify the HIPAA consent banner appears and blocks app usage until accepted.
- [ ] **Data Deletion** — Tap Profile > Privacy & Security > Delete All My Data. Confirm both prompts. Verify all data is removed from Supabase tables.
- [ ] **Audit Logs** — Tap Profile > Privacy & Security > Audit Logs. Verify recent activity entries appear with tamper verification.
- [ ] **Breach Detection** — Verify the breach alert banner appears if `unacknowledgedBreaches` is non-empty.

---

## 9. Backend Deployment

- [ ] **Health Check** — `curl https://YOUR_API_URL/health` returns `{"status":"healthy",...}` with 200 status.
- [ ] **tRPC Endpoint** — `curl https://YOUR_API_URL/api/trpc` returns a valid tRPC response (or auth error, not 404).
- [ ] **CORS** — Verify the deployed backend accepts requests from the Expo app's origin.
- [ ] **HTTPS** — Verify the deployed URL uses HTTPS with a valid certificate.
- [ ] **Security Headers** — Verify response includes `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`.

---

## Sign-Off

| Role | Name | Date | Status |
|---|---|---|---|
| Developer | | | |
| QA Lead | | | |
| Security Review | | | |
| Product Owner | | | |
