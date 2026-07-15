// import * as Sentry from '@sentry/react-native';
import * as Sentry from "@sentry/node";
import type { Context, Next } from 'hono';
import { scrubObject } from './log-scrub';

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
