/**
 * Server-side audit logging middleware for tRPC.
 * Logs PHI access events to the clinic_audit_logs table.
 * Redacts sensitive fields before logging.
 */
import type { Context, Next } from 'hono';
import { createAnonSupabaseClient } from './supabase-server';

const PHI_ROUTES = new Set([
  'clinic.patients.list',
  'clinic.patients.getById',
  'clinic.patients.create',
  'clinic.patients.update',
  'clinic.patients.delete',
  'clinic.patients.getHealthHistory',
  'clinic.patients.updateHealthHistory',
  'clinic.patients.getTimeline',
  'clinic.patients.exportRecord',
  'clinic.labs.listDocuments',
  'clinic.labs.uploadDocument',
  'clinic.labs.listResults',
  'clinic.labs.addResult',
  'clinic.labs.updateResult',
  'clinic.labs.deleteResult',
  'clinic.biometrics.listReadings',
  'clinic.biometrics.addReading',
  'clinic.biometrics.deleteReading',
  'clinic.biometrics.getSummary',
  'clinic.biometrics.getGlucoseStats',
  'clinic.alerts.listEvents',
  'clinic.alerts.getEvent',
  'clinic.alerts.triggerAlert',
  'clinic.dashboard.getPatientOverview',
  'clinic.dashboard.getPatientList',
]);

const WRITE_ACTIONS = new Set(['create', 'update', 'delete', 'add', 'upload', 'trigger', 'acknowledge', 'resolve', 'dismiss', 'snooze', 'toggle', 'bulk']);

function classifyAction(procedurePath: string): string {
  const parts = procedurePath.split('.');
  const method = parts[parts.length - 1];
  for (const action of WRITE_ACTIONS) {
    if (method.toLowerCase().startsWith(action)) return 'PHI_UPDATE';
  }
  if (method.toLowerCase().startsWith('export')) return 'DATA_EXPORT';
  return 'PHI_ACCESS';
}

function extractPatientId(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const obj = input as Record<string, unknown>;
  return (obj.patientId ?? obj.id ?? obj.patient_id) as string | undefined;
}

/**
 * Hono middleware that writes an audit log entry after each tRPC call
 * that touches PHI data.
 */
export function auditMiddleware() {
  return async (c: Context, next: Next) => {
    const startTime = Date.now();
    await next();

    // Only audit tRPC routes
    if (!c.req.path.startsWith('/trpc/') && !c.req.path.startsWith('/api/trpc/')) return;

    try {
      // Extract procedure name from the URL path
      const pathParts = c.req.path.split('/trpc/');
      const procedurePath = pathParts[1]?.split('?')[0] ?? '';
      const dotPath = procedurePath.replace(/\//g, '.');

      // Only log PHI-touching routes
      if (!PHI_ROUTES.has(dotPath)) return;

      const authHeader = c.req.header('authorization');
      const token = authHeader?.replace('Bearer ', '');
      if (!token) return;

      // Parse the user from the token for audit record
      const supabase = createAnonSupabaseClient();
      const { data: userData } = await supabase.auth.getUser(token);
      if (!userData?.user) return;

      const action = classifyAction(dotPath);
      const duration = Date.now() - startTime;

      // Write to audit log table (non-blocking — fire and forget)
      const sbForWrite = createAnonSupabaseClient();
      sbForWrite
        .from('clinic_audit_logs')
        .insert({
          user_id: userData.user.id,
          action,
          resource: dotPath,
          http_method: c.req.method,
          http_status: c.res.status,
          duration_ms: duration,
          ip_address: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip') ?? 'unknown',
          user_agent: c.req.header('user-agent')?.slice(0, 500) ?? 'unknown',
        })
        .then(({ error }) => {
          if (error) {
            console.log('[Audit] Failed to write audit log:', error.message);
          }
        });
    } catch {
      // Audit logging should never break the request
    }
  };
}
