import * as Sentry from '@sentry/react-native';
import { Platform } from 'react-native';

const PHI_KEYS = new Set([
  'firstName', 'first_name', 'lastName', 'last_name', 'fullName', 'full_name',
  'name', 'patientName', 'patient_name', 'emergencyContactName', 'emergency_contact_name',
  'email', 'phone', 'dateOfBirth', 'date_of_birth', 'birth_date', 'birthDate',
  'addressLine1', 'address_line1', 'addressLine2', 'address_line2',
  'city', 'state', 'zipCode', 'zip_code', 'country',
  'emergencyContactPhone', 'emergency_contact_phone',
  'emergencyContactRelationship', 'emergency_contact_relationship',
  'ssn', 'social_security', 'insurance_id', 'insuranceId',
  'authorization', 'Authorization', 'sessionToken', 'session_token',
  'access_token', 'accessToken', 'refresh_token', 'refreshToken',
  'access_token_encrypted', 'refresh_token_encrypted',
  'password', 'secret', 'token', 'bearer',
]);

const PHI_VALUE_KEYS = new Set([
  'value', 'marker_value', 'markerValue',
  'glucose_avg', 'glucoseAvg', 'systolic_bp', 'diastolic_bp',
  'weight', 'weight_kg', 'body_fat_percent', 'height',
  'hrv', 'resting_hr', 'avg_hr', 'respiratory_rate', 'spo2',
  'sleep_duration_minutes', 'deep_sleep_minutes', 'rem_sleep_minutes',
  'calories', 'protein_g', 'carbs_g', 'fat_g',
  'dose', 'allergen', 'reaction', 'chief_complaint_json',
  'conditions', 'past_conditions', 'current_medications', 'allergies',
  'symptoms_json', 'associated_symptoms_json',
  'biomarkers_json', 'supplement_name',
]);

function isPHIKey(key: string): boolean {
  if (PHI_KEYS.has(key)) return true;
  if (PHI_VALUE_KEYS.has(key)) return true;
  const lower = key.toLowerCase();
  return (
    lower.includes('patient_name') ||
    lower.includes('patientname') ||
    lower.includes('ssn') ||
    lower.includes('password') ||
    lower.includes('secret') ||
    lower.includes('bearer')
  );
}

function scrubObject(obj: Record<string, unknown>): Record<string, unknown> {
  const scrubbed: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (isPHIKey(key)) {
      scrubbed[key] = '[REDACTED]';
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      scrubbed[key] = scrubObject(val as Record<string, unknown>);
    } else if (Array.isArray(val)) {
      scrubbed[key] = val.map((item) =>
        item && typeof item === 'object' ? scrubObject(item as Record<string, unknown>) : item
      );
    } else {
      scrubbed[key] = val;
    }
  }
  return scrubbed;
}

function scrubString(str: string): string {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const phoneRegex = /(\+?1?[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
  const ssnRegex = /\d{3}-?\d{2}-?\d{4}/g;

  return str
    .replace(emailRegex, '[EMAIL_REDACTED]')
    .replace(phoneRegex, '[PHONE_REDACTED]')
    .replace(ssnRegex, '[SSN_REDACTED]');
}

export function initSentry(): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

  if (!dsn) {
    console.log('[Sentry] No DSN configured, skipping initialization');
    return;
  }

  Sentry.init({
    dsn,
    environment: __DEV__ ? 'development' : 'production',
    enabled: !__DEV__,
    tracesSampleRate: 0.2,
    sampleRate: 1.0,

    beforeSend(event) {
      if (event.user) {
        delete event.user.email;
        delete event.user.username;
        delete event.user.ip_address;
      }

      if (event.request?.headers) {
        const headers = { ...event.request.headers };
        delete headers['authorization'];
        delete headers['Authorization'];
        delete headers['cookie'];
        delete headers['Cookie'];
        delete headers['X-Webhook-Secret'];
        event.request.headers = headers;
      }

      if (event.request?.data && typeof event.request.data === 'string') {
        event.request.data = scrubString(event.request.data);
      }

      if (event.extra) {
        event.extra = scrubObject(event.extra as Record<string, unknown>);
      }

      if (event.contexts) {
        for (const [ctxKey, ctxVal] of Object.entries(event.contexts)) {
          if (ctxVal && typeof ctxVal === 'object') {
            event.contexts[ctxKey] = scrubObject(ctxVal as Record<string, unknown>);
          }
        }
      }

      if (event.exception?.values) {
        for (const exception of event.exception.values) {
          if (exception.value) {
            exception.value = scrubString(exception.value);
          }
        }
      }

      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((breadcrumb) => {
          if (breadcrumb.data) {
            breadcrumb.data = scrubObject(breadcrumb.data as Record<string, unknown>);
          }
          if (breadcrumb.message) {
            breadcrumb.message = scrubString(breadcrumb.message);
          }
          return breadcrumb;
        });
      }

      if (event.tags) {
        const tags = { ...event.tags };
        for (const key of Object.keys(tags)) {
          if (isPHIKey(key)) {
            tags[key] = '[REDACTED]';
          } else if (typeof tags[key] === 'string') {
            tags[key] = scrubString(tags[key] as string);
          }
        }
        event.tags = tags;
      }

      return event;
    },

    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.data) {
        breadcrumb.data = scrubObject(breadcrumb.data as Record<string, unknown>);
      }
      if (breadcrumb.message) {
        breadcrumb.message = scrubString(breadcrumb.message);
      }

      if (breadcrumb.category === 'fetch' || breadcrumb.category === 'xhr') {
        if (breadcrumb.data?.url && typeof breadcrumb.data.url === 'string') {
          try {
            const url = new URL(breadcrumb.data.url);
            url.searchParams.forEach((_val, key) => {
              if (isPHIKey(key)) {
                url.searchParams.set(key, '[REDACTED]');
              }
            });
            breadcrumb.data.url = url.toString();
          } catch {
            // not a valid URL, leave as is
          }
        }
      }

      return breadcrumb;
    },

    integrations: (integrations) => {
      return integrations;
    },
  });

  if (Platform.OS !== 'web') {
    const originalHandler = ErrorUtils.getGlobalHandler();
    ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
      Sentry.captureException(error, {
        tags: { fatal: String(isFatal ?? false), source: 'globalHandler' },
      });
      if (originalHandler) {
        originalHandler(error, isFatal);
      }
    });
  }

  if (typeof globalThis !== 'undefined') {
    const origOnUnhandledRejection = (globalThis as Record<string, unknown>).onunhandledrejection as
      | ((event: PromiseRejectionEvent) => void)
      | undefined;

    (globalThis as Record<string, unknown>).onunhandledrejection = (event: PromiseRejectionEvent) => {
      Sentry.captureException(event.reason ?? new Error('Unhandled promise rejection'), {
        tags: { source: 'unhandledRejection' },
      });
      if (origOnUnhandledRejection) {
        origOnUnhandledRejection(event);
      }
    };
  }

  console.log('[Sentry] Initialized for', Platform.OS);
}

export function captureError(error: unknown, context?: Record<string, unknown>): void {
  const safeContext = context ? scrubObject(context) : undefined;
  Sentry.captureException(error, safeContext ? { extra: safeContext } : undefined);
}

export function captureMessage(message: string, level: Sentry.SeverityLevel = 'info'): void {
  Sentry.captureMessage(scrubString(message), level);
}

export function setUserContext(userId: string): void {
  Sentry.setUser({ id: userId });
}

export function clearUserContext(): void {
  Sentry.setUser(null);
}

export { Sentry };
