import AsyncStorage from '@react-native-async-storage/async-storage';
import { writeAuditLog } from './auditLog';

const BREACH_STORAGE_KEY = 'hipaa_breach_events';
const ACCESS_PATTERN_KEY = 'hipaa_access_patterns';

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

async function getAccessPatterns(): Promise<AccessPattern[]> {
  try {
    const raw = await AsyncStorage.getItem(ACCESS_PATTERN_KEY);
    return raw ? JSON.parse(raw) : [];
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
  const patterns = await getAccessPatterns();
  patterns.push({
    timestamp: new Date().toISOString(),
    resource,
    action,
  });
  await saveAccessPatterns(patterns);
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
  const key = 'hipaa_failed_auth_count';
  const raw = await AsyncStorage.getItem(key);
  const data = raw ? JSON.parse(raw) : { count: 0, firstAttempt: new Date().toISOString() };

  const timeSinceFirst = Date.now() - new Date(data.firstAttempt).getTime();
  if (timeSinceFirst > 900000) {
    data.count = 1;
    data.firstAttempt = new Date().toISOString();
  } else {
    data.count++;
  }

  await AsyncStorage.setItem(key, JSON.stringify(data));

  if (data.count >= MAX_FAILED_AUTH_ATTEMPTS) {
    await reportBreach({
      type: 'failed_auth',
      severity: 'critical',
      description: `${data.count} failed authentication attempts in ${Math.round(timeSinceFirst / 60000)} minutes for user ${userId}.`,
    });
    await writeAuditLog('BREACH_DETECTED', 'authentication', userId, `${data.count} failed attempts`);
  }
}

export async function resetFailedAuthCount(): Promise<void> {
  await AsyncStorage.removeItem('hipaa_failed_auth_count');
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
    const raw = await AsyncStorage.getItem(BREACH_STORAGE_KEY);
    const events: BreachEvent[] = raw ? JSON.parse(raw) : [];

    const recentSimilar = events.find(
      (e) =>
        e.type === event.type &&
        Date.now() - new Date(e.timestamp).getTime() < 300000
    );
    if (recentSimilar) return;

    events.push(event);
    await AsyncStorage.setItem(BREACH_STORAGE_KEY, JSON.stringify(events));
  } catch {
    // noop
  }
}

export async function getBreachEvents(): Promise<BreachEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(BREACH_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function acknowledgeBreachEvent(eventId: string): Promise<void> {
  const events = await getBreachEvents();
  const updated = events.map((e) =>
    e.id === eventId ? { ...e, acknowledged: true } : e
  );
  await AsyncStorage.setItem(BREACH_STORAGE_KEY, JSON.stringify(updated));
}

export async function getUnacknowledgedBreaches(): Promise<BreachEvent[]> {
  const events = await getBreachEvents();
  return events.filter((e) => !e.acknowledged);
}
