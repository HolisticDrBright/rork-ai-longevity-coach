import AsyncStorage from '@react-native-async-storage/async-storage';
import { writeAuditLog } from './auditLog';

const BREACH_STORAGE_KEY = 'hipaa_breach_events';
const ACCESS_PATTERN_KEY = 'hipaa_access_patterns';
const FAILED_AUTH_KEY = 'hipaa_failed_auth_count';

export interface BreachEvent {
  id: string;
  timestamp: string;
  type: 'rapid_access' | 'bulk_export' | 'failed_auth' | 'unusual_hours' | 'role_escalation';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  acknowledged: boolean;
}

interface AccessPattern {
  timestamp: string;
  resource: string;
  action: string;
}

const MAX_FAILED_AUTH_ATTEMPTS = 5;
const RAPID_ACCESS_THRESHOLD = 20;
const RAPID_ACCESS_WINDOW_MS = 60000;

// Serializes all read-modify-write cycles on this module's storage keys so
// concurrent calls cannot drop each other's writes.
// IMPORTANT: tasks must not enqueue other tasks from inside a queued task
// (that would deadlock) — compose at the call sites instead.
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

function safeParseJSON<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function getAccessPatterns(): Promise<AccessPattern[]> {
  try {
    const raw = await AsyncStorage.getItem(ACCESS_PATTERN_KEY);
    const parsed = safeParseJSON<AccessPattern[]>(raw, []);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveAccessPatterns(patterns: AccessPattern[]): Promise<void> {
  const recent = patterns.filter(
    (p) => Date.now() - new Date(p.timestamp).getTime() < 3600000
  );
  await AsyncStorage.setItem(ACCESS_PATTERN_KEY, JSON.stringify(recent));
}

export async function recordAccessPattern(resource: string, action: string): Promise<void> {
  const patterns = await enqueue(async () => {
    const current = await getAccessPatterns();
    current.push({
      timestamp: new Date().toISOString(),
      resource,
      action,
    });
    await saveAccessPatterns(current);
    return current;
  });
  // Runs after the queued write has completed (not inside it), so the
  // breach report can safely enqueue its own write.
  await checkForAnomalies(patterns);
}

async function checkForAnomalies(patterns: AccessPattern[]): Promise<void> {
  const now = Date.now();
  const recentPatterns = patterns.filter(
    (p) => now - new Date(p.timestamp).getTime() < RAPID_ACCESS_WINDOW_MS
  );

  if (recentPatterns.length >= RAPID_ACCESS_THRESHOLD) {
    await reportBreach({
      type: 'rapid_access',
      severity: 'high',
      description: `${recentPatterns.length} PHI access events in the last 60 seconds. Possible automated data extraction.`,
    });
  }

  const hour = new Date().getHours();
  if (hour >= 1 && hour <= 5) {
    const nightPatterns = recentPatterns.filter((p) => {
      const h = new Date(p.timestamp).getHours();
      return h >= 1 && h <= 5;
    });
    if (nightPatterns.length > 5) {
      await reportBreach({
        type: 'unusual_hours',
        severity: 'medium',
        description: `Multiple PHI access events during unusual hours (1AM-5AM).`,
      });
    }
  }
}

export async function recordFailedAuth(userId: string): Promise<void> {
  const result = await enqueue(async () => {
    const raw = await AsyncStorage.getItem(FAILED_AUTH_KEY);
    const data = safeParseJSON<{ count: number; firstAttempt: string }>(raw, {
      count: 0,
      firstAttempt: new Date().toISOString(),
    });
    if (typeof data.count !== 'number' || !data.firstAttempt) {
      data.count = 0;
      data.firstAttempt = new Date().toISOString();
    }

    const timeSinceFirst = Date.now() - new Date(data.firstAttempt).getTime();
    if (timeSinceFirst > 900000) {
      data.count = 1;
      data.firstAttempt = new Date().toISOString();
    } else {
      data.count++;
    }

    await AsyncStorage.setItem(FAILED_AUTH_KEY, JSON.stringify(data));
    return { count: data.count, timeSinceFirst };
  });

  if (result.count >= MAX_FAILED_AUTH_ATTEMPTS) {
    await reportBreach({
      type: 'failed_auth',
      severity: 'critical',
      description: `${result.count} failed authentication attempts in ${Math.round(result.timeSinceFirst / 60000)} minutes for user ${userId}.`,
    });
    await writeAuditLog('BREACH_DETECTED', 'authentication', userId, `${result.count} failed attempts`);
  }
}

export async function resetFailedAuthCount(): Promise<void> {
  await enqueue(async () => {
    await AsyncStorage.removeItem(FAILED_AUTH_KEY);
  });
}

async function reportBreach(
  breach: Omit<BreachEvent, 'id' | 'timestamp' | 'acknowledged'>
): Promise<void> {
  const event: BreachEvent = {
    id: `breach_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
    acknowledged: false,
    ...breach,
  };

  try {
    await enqueue(async () => {
      const raw = await AsyncStorage.getItem(BREACH_STORAGE_KEY);
      const parsed = safeParseJSON<BreachEvent[]>(raw, []);
      const events: BreachEvent[] = Array.isArray(parsed) ? parsed : [];

      const recentSimilar = events.find(
        (e) =>
          e.type === event.type &&
          Date.now() - new Date(e.timestamp).getTime() < 300000
      );
      if (recentSimilar) return;

      events.push(event);
      await AsyncStorage.setItem(BREACH_STORAGE_KEY, JSON.stringify(events));
    });
  } catch {
    // noop
  }
}

export async function getBreachEvents(): Promise<BreachEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(BREACH_STORAGE_KEY);
    const parsed = safeParseJSON<BreachEvent[]>(raw, []);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function acknowledgeBreachEvent(eventId: string): Promise<void> {
  await enqueue(async () => {
    const events = await getBreachEvents();
    const updated = events.map((e) =>
      e.id === eventId ? { ...e, acknowledged: true } : e
    );
    await AsyncStorage.setItem(BREACH_STORAGE_KEY, JSON.stringify(updated));
  });
}

export async function getUnacknowledgedBreaches(): Promise<BreachEvent[]> {
  const events = await getBreachEvents();
  return events.filter((e) => !e.acknowledged);
}
