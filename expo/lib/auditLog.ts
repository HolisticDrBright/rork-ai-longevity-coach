import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

export type AuditAction =
  | 'PHI_ACCESS'
  | 'PHI_CREATE'
  | 'PHI_UPDATE'
  | 'PHI_DELETE'
  | 'AUTH_LOGIN'
  | 'AUTH_LOGOUT'
  | 'AUTH_FAILED'
  | 'AUTH_TIMEOUT'
  | 'DATA_EXPORT'
  | 'DATA_PURGE'
  | 'SESSION_START'
  | 'SESSION_END'
  | 'BREACH_DETECTED';

export interface AuditEntry {
  id: string;
  timestamp: string;
  action: AuditAction;
  resource: string;
  userId: string;
  details?: string;
  ipAddress?: string;
  checksum: string;
}

const AUDIT_STORAGE_KEY = 'hipaa_audit_log';
const MAX_AUDIT_ENTRIES = 5000;
const RETENTION_DAYS = 2190;

async function computeChecksum(entry: Omit<AuditEntry, 'checksum'>): Promise<string> {
  const payload = `${entry.id}|${entry.timestamp}|${entry.action}|${entry.resource}|${entry.userId}|${entry.details || ''}`;
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, payload);
}

export async function writeAuditLog(
  action: AuditAction,
  resource: string,
  userId: string,
  details?: string
): Promise<void> {
  try {
    const id = Crypto.randomUUID();
    const timestamp = new Date().toISOString();

    const partialEntry: Omit<AuditEntry, 'checksum'> = {
      id,
      timestamp,
      action,
      resource,
      userId,
      details: details ? sanitizeForLog(details) : undefined,
    };

    const checksum = await computeChecksum(partialEntry);
    const entry: AuditEntry = { ...partialEntry, checksum };

    const raw = await AsyncStorage.getItem(AUDIT_STORAGE_KEY);
    let entries: AuditEntry[] = raw ? JSON.parse(raw) : [];

    entries.push(entry);

    if (entries.length > MAX_AUDIT_ENTRIES) {
      entries = entries.slice(-MAX_AUDIT_ENTRIES);
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
    entries = entries.filter((e) => new Date(e.timestamp) >= cutoff);

    await AsyncStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(entries));
  } catch (error) {
    console.log('[AuditLog] Failed to write audit entry');
  }
}

export async function getAuditLogs(
  filters?: {
    action?: AuditAction;
    resource?: string;
    userId?: string;
    startDate?: string;
    endDate?: string;
  }
): Promise<AuditEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(AUDIT_STORAGE_KEY);
    if (!raw) return [];

    let entries: AuditEntry[] = JSON.parse(raw);

    if (filters?.action) {
      entries = entries.filter((e) => e.action === filters.action);
    }
    if (filters?.resource) {
      entries = entries.filter((e) => e.resource === filters.resource);
    }
    if (filters?.userId) {
      entries = entries.filter((e) => e.userId === filters.userId);
    }
    if (filters?.startDate) {
      entries = entries.filter((e) => e.timestamp >= filters.startDate!);
    }
    if (filters?.endDate) {
      entries = entries.filter((e) => e.timestamp <= filters.endDate!);
    }

    return entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  } catch {
    return [];
  }
}

export async function verifyAuditIntegrity(): Promise<{
  total: number;
  valid: number;
  tampered: number;
}> {
  const entries = await getAuditLogs();
  let valid = 0;
  let tampered = 0;

  for (const entry of entries) {
    const { checksum, ...rest } = entry;
    const expected = await computeChecksum(rest);
    if (expected === checksum) {
      valid++;
    } else {
      tampered++;
    }
  }

  return { total: entries.length, valid, tampered };
}

export async function clearAuditLogs(): Promise<void> {
  await AsyncStorage.removeItem(AUDIT_STORAGE_KEY);
}

function sanitizeForLog(text: string): string {
  return text
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN_REDACTED]')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL_REDACTED]')
    .replace(/\b\d{10,}\b/g, '[PHONE_REDACTED]')
    .substring(0, 500);
}
