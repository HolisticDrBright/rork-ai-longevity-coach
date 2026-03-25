import * as Sentry from '@sentry/react-native';
import type { Context, Next } from 'hono';

const PHI_KEYS = new Set([
  'firstName', 'first_name', 'lastName', 'last_name', 'fullName', 'full_name',
  'name', 'patientName', 'patient_name', 'emergencyContactName', 'emergency_contact_name',
  'email', 'phone', 'dateOfBirth', 'date_of_birth', 'birth_date',
  'addressLine1', 'address_line1', 'addressLine2', 'address_line2',
  'city', 'state', 'zipCode', 'zip_code',
  'emergencyContactPhone', 'emergency_contact_phone',
  'emergencyContactRelationship', 'emergency_contact_relationship',
  'authorization', 'Authorization', 'sessionToken', 'session_token',
  'access_token', 'accessToken', 'refresh_token', 'refreshToken',
  'access_token_encrypted', 'refresh_token_encrypted',
  'password', 'secret', 'token', 'bearer',
]);

const PHI_VALUE_KEYS = new Set([
  'value', 'marker_value', 'markerValue',
  'glucose_avg', 'systolic_bp', 'diastolic_bp',
  'weight', 'weight_kg', 'body_fat_percent', 'height',
  'hrv', 'resting_hr', 'avg_hr', 'respiratory_rate', 'spo2',
  'dose', 'allergen', 'reaction', 'chief_complaint_json',
  'conditions', 'past_conditions', 'current_medications', 'allergies',
  'symptoms_json', 'biomarkers_json', 'supplement_name',
]);

function isPHIKey(key: string): boolean {
  return PHI_KEYS.has(key) || PHI_VALUE_KEYS.has(key);
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

export function sentryMiddleware() {
  return async (c: Context, next: Next) => {
    const startTime = Date.now();
    const method = c.req.method;
    const path = c.req.path;
    const operationId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    Sentry.addBreadcrumb({
      category: 'http',
      message: `${method} ${path}`,
      data: {
        operationId,
        method,
        path,
      },
      level: 'info',
    });

    try {
      await next();

      const duration = Date.now() - startTime;
      const status = c.res.status;

      if (status >= 500) {
        Sentry.captureMessage(`Server error: ${method} ${path}`, {
          level: 'error',
          tags: {
            operationId,
            httpMethod: method,
            httpPath: path,
            httpStatus: String(status),
          },
          extra: {
            durationMs: duration,
          },
        });
      }
    } catch (err) {
      const duration = Date.now() - startTime;

      const safeExtra: Record<string, unknown> = {
        operationId,
        httpMethod: method,
        httpPath: path,
        durationMs: duration,
        timestamp: new Date().toISOString(),
      };

      if (err && typeof err === 'object' && 'code' in err) {
        safeExtra.trpcCode = (err as { code: string }).code;
      }

      Sentry.captureException(err, {
        tags: {
          source: 'hono_backend',
          operationId,
          httpMethod: method,
          httpPath: path,
        },
        extra: scrubObject(safeExtra),
      });

      throw err;
    }
  };
}

export function captureTRPCError(error: unknown, procedurePath?: string): void {
  const operationId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  Sentry.captureException(error, {
    tags: {
      source: 'trpc_procedure',
      operationId,
      procedurePath: procedurePath ?? 'unknown',
    },
    extra: {
      operationId,
      timestamp: new Date().toISOString(),
    },
  });
}
