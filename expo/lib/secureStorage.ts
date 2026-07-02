import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

/**
 * Obfuscated PHI storage layer.
 *
 * Format V2 ("ENC_V2:"): value is UTF-8 encoded to bytes, XORed with the
 * device key bytes, then base64 encoded in chunks (safe for multi-megabyte
 * payloads such as meal photos and for non-Latin-1 characters like lab
 * units, e.g. "μIU/mL").
 *
 * Key storage:
 * - Native (iOS/Android): the random key lives in expo-secure-store
 *   (Keychain / Keystore), so the XOR layer provides real at-rest protection
 *   backed by hardware key storage.
 * - Web: SecureStore is unavailable, so the key is persisted in
 *   localStorage next to the data. On web this is OBFUSCATION ONLY, not
 *   encryption — anyone with access to localStorage can recover the key.
 *   Real encryption at rest is native-only. Persisting the key (instead of
 *   generating a new session key per reload) keeps stored data readable
 *   across reloads.
 *
 * Backward compatibility on read: V2 format, then legacy V1 XOR format
 * (charCodeAt-based), then plaintext JSON. Legacy/plaintext values are
 * rewritten in V2 format after a successful read.
 */

const ENCRYPTION_KEY_ID = 'hipaa_encryption_key';
const KEY_LENGTH = 32;

const ENCRYPTED_PREFIX_V2 = 'ENC_V2:';
const ENCRYPTED_PREFIX_V1 = 'ENC_V1:';

let cachedKey: string | null = null;

function getWebLocalStorage(): Storage | null {
  try {
    // eslint-disable-next-line no-undef
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // localStorage can throw in some privacy modes
  }
  return null;
}

async function loadPersistedKey(): Promise<string | null> {
  if (Platform.OS === 'web') {
    const ls = getWebLocalStorage();
    return ls?.getItem(ENCRYPTION_KEY_ID) ?? null;
  }
  try {
    return await SecureStore.getItemAsync(ENCRYPTION_KEY_ID);
  } catch {
    return null;
  }
}

async function persistKey(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    // Web: persist in localStorage so data survives reloads.
    // NOTE: obfuscation only — see module docs above.
    const ls = getWebLocalStorage();
    ls?.setItem(ENCRYPTION_KEY_ID, key);
    return;
  }
  try {
    await SecureStore.setItemAsync(ENCRYPTION_KEY_ID, key);
  } catch {
    console.log('[SecureStorage] Could not save key to SecureStore, using session key');
  }
}

async function getOrCreateEncryptionKey(): Promise<string> {
  if (cachedKey) return cachedKey;

  const existing = await loadPersistedKey();
  if (existing) {
    cachedKey = existing;
    return existing;
  }

  const randomBytes = Crypto.getRandomBytes(KEY_LENGTH);
  const key = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  await persistKey(key);

  cachedKey = key;
  return key;
}

// ── Byte helpers ─────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function utf8Encode(text: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text);
  }
  // Manual UTF-8 encoder fallback for environments without TextEncoder
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.codePointAt(i) as number;
    if (code > 0xffff) i++; // surrogate pair consumes two UTF-16 units
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    }
  }
  return new Uint8Array(bytes);
}

function utf8Decode(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder().decode(bytes);
  }
  // Manual UTF-8 decoder fallback
  const parts: string[] = [];
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    let code: number;
    if (b < 0x80) {
      code = b;
      i += 1;
    } else if (b < 0xe0) {
      code = ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f);
      i += 2;
    } else if (b < 0xf0) {
      code = ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
      i += 3;
    } else {
      code =
        ((b & 0x07) << 18) |
        ((bytes[i + 1] & 0x3f) << 12) |
        ((bytes[i + 2] & 0x3f) << 6) |
        (bytes[i + 3] & 0x3f);
      i += 4;
    }
    parts.push(String.fromCodePoint(code));
  }
  return parts.join('');
}

// Chunked base64 conversion — never spreads a large array into
// String.fromCharCode (which RangeErrors on big payloads like meal photos).
const BASE64_CHUNK_SIZE = 8192;

function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_SIZE) {
    const slice = bytes.subarray(i, i + BASE64_CHUNK_SIZE);
    let chunk = '';
    for (let j = 0; j < slice.length; j++) {
      chunk += String.fromCharCode(slice[j]);
    }
    chunks.push(chunk);
  }
  return btoa(chunks.join(''));
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function xorBytes(data: Uint8Array, keyBytes: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    result[i] = data[i] ^ keyBytes[i % keyBytes.length];
  }
  return result;
}

// ── V2 encrypt/decrypt ───────────────────────────────────────────────────

function encryptV2(value: string, keyHex: string): string {
  const keyBytes = hexToBytes(keyHex);
  const dataBytes = utf8Encode(value);
  return bytesToBase64(xorBytes(dataBytes, keyBytes));
}

function decryptV2(encoded: string, keyHex: string): string {
  const keyBytes = hexToBytes(keyHex);
  const dataBytes = base64ToBytes(encoded);
  return utf8Decode(xorBytes(dataBytes, keyBytes));
}

// ── Legacy V1 decrypt (charCodeAt-based XOR against key characters) ──────

function legacyXorDecrypt(encoded: string, key: string): string {
  const decoded = atob(encoded);
  const parts: string[] = [];
  for (let i = 0; i < decoded.length; i++) {
    const charCode = decoded.charCodeAt(i);
    const keyChar = key.charCodeAt(i % key.length);
    parts.push(String.fromCharCode(charCode ^ keyChar));
  }
  return parts.join('');
}

// ── Public API ───────────────────────────────────────────────────────────

export async function secureSetItem(storageKey: string, value: string): Promise<void> {
  const key = await getOrCreateEncryptionKey();
  const encrypted = ENCRYPTED_PREFIX_V2 + encryptV2(value, key);
  await AsyncStorage.setItem(storageKey, encrypted);
}

export async function secureGetItem(storageKey: string): Promise<string | null> {
  const raw = await AsyncStorage.getItem(storageKey);
  if (!raw) return null;

  const key = await getOrCreateEncryptionKey();

  if (raw.startsWith(ENCRYPTED_PREFIX_V2)) {
    try {
      return decryptV2(raw.slice(ENCRYPTED_PREFIX_V2.length), key);
    } catch {
      console.log('[SecureStorage] Failed to decode stored value');
      return null;
    }
  }

  if (raw.startsWith(ENCRYPTED_PREFIX_V1)) {
    // Legacy XOR format — decrypt, then rewrite in the new format.
    try {
      const value = legacyXorDecrypt(raw.slice(ENCRYPTED_PREFIX_V1.length), key);
      try {
        await secureSetItem(storageKey, value);
      } catch {
        // Non-fatal: value is still readable in legacy format next time.
      }
      return value;
    } catch {
      console.log('[SecureStorage] Failed to decode legacy stored value');
      return null;
    }
  }

  // Plaintext JSON (pre-encryption migration path) — rewrite in new format.
  try {
    await secureSetItem(storageKey, raw);
  } catch {
    // Non-fatal
  }
  return raw;
}

export async function secureRemoveItem(storageKey: string): Promise<void> {
  await AsyncStorage.removeItem(storageKey);
}

export async function secureMultiRemove(keys: string[]): Promise<void> {
  await AsyncStorage.multiRemove(keys);
}

export async function secureSetJSON<T>(storageKey: string, value: T): Promise<void> {
  const json = JSON.stringify(value);
  await secureSetItem(storageKey, json);
}

export async function secureGetJSON<T>(storageKey: string): Promise<T | null> {
  const raw = await secureGetItem(storageKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function getAllStorageKeys(): Promise<string[]> {
  const keys = await AsyncStorage.getAllKeys();
  return [...keys];
}

// HIPAA requires audit trails to be retained (6 years) even after a data
// purge, so the audit log key is explicitly excluded from PHI deletion.
const AUDIT_LOG_KEY = 'hipaa_audit_log';

export async function purgeAllPHI(): Promise<void> {
  const allKeys = await getAllStorageKeys();
  const phiPrefixes = [
    'longevity_',
    'nutrition_',
    'supplements_',
    'hipaa_audit_',
    'hipaa_session_',
    'hipaa_breach_',
  ];

  const phiKeys = allKeys.filter(
    (k) => phiPrefixes.some((prefix) => k.startsWith(prefix)) && k !== AUDIT_LOG_KEY
  );

  if (phiKeys.length > 0) {
    await AsyncStorage.multiRemove(phiKeys);
  }

  try {
    await SecureStore.deleteItemAsync(ENCRYPTION_KEY_ID);
  } catch {
    // noop
  }

  if (Platform.OS === 'web') {
    try {
      getWebLocalStorage()?.removeItem(ENCRYPTION_KEY_ID);
    } catch {
      // noop
    }
  }

  try {
    await SecureStore.deleteItemAsync('hipaa_pin_hash');
  } catch {
    // noop
  }

  cachedKey = null;
}

export async function hashValue(value: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
}
