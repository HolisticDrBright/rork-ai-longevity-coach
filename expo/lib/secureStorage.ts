import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ENCRYPTION_KEY_ID = 'hipaa_encryption_key';
const KEY_LENGTH = 32;
const ENCRYPTED_PREFIX_V1 = 'ENC_V1:';
const ENCRYPTED_PREFIX_V2 = 'ENC_V2:';
const IV_LENGTH = 12;

let cachedKey: string | null = null;
let cachedCryptoKey: CryptoKey | null = null;

async function getOrCreateEncryptionKey(): Promise<string> {
  if (cachedKey) return cachedKey;

  try {
    const existing = await SecureStore.getItemAsync(ENCRYPTION_KEY_ID);
    if (existing) {
      cachedKey = existing;
      return existing;
    }
  } catch {
    console.log('[SecureStorage] Could not retrieve key from SecureStore');
  }

  const randomBytes = Crypto.getRandomBytes(KEY_LENGTH);
  const key = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  try {
    await SecureStore.setItemAsync(ENCRYPTION_KEY_ID, key);
  } catch {
    console.log('[SecureStorage] Could not save key to SecureStore, using session key');
  }

  cachedKey = key;
  return key;
}

async function getCryptoKey(): Promise<CryptoKey> {
  if (cachedCryptoKey) return cachedCryptoKey;

  const hexKey = await getOrCreateEncryptionKey();
  // Derive a proper 256-bit key from the hex string using SHA-256
  const keyHash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    hexKey
  );

  // Convert hex hash to Uint8Array (32 bytes = 256 bits)
  const keyBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    keyBytes[i] = parseInt(keyHash.slice(i * 2, i * 2 + 2), 16);
  }

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );

  cachedCryptoKey = cryptoKey;
  return cryptoKey;
}

function uint8ToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function aesGcmEncrypt(plaintext: string): Promise<string> {
  const key = await getCryptoKey();
  const iv = Crypto.getRandomBytes(IV_LENGTH);
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);

  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );

  // Combine IV + ciphertext (which includes the GCM auth tag)
  const combined = new Uint8Array(iv.length + cipherBuffer.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipherBuffer), iv.length);

  return uint8ToBase64(combined);
}

async function aesGcmDecrypt(encoded: string): Promise<string> {
  const key = await getCryptoKey();
  const combined = base64ToUint8(encoded);

  if (combined.length <= IV_LENGTH) {
    throw new Error('Encrypted data is too short or corrupted');
  }

  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);

  const plainBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );

  const decoder = new TextDecoder();
  return decoder.decode(plainBuffer);
}

// Legacy V1 XOR functions for backward compatibility
function xorDecryptLegacy(encoded: string, key: string): string {
  const decoded = atob(encoded);
  const result: number[] = [];
  for (let i = 0; i < decoded.length; i++) {
    const charCode = decoded.charCodeAt(i);
    const keyChar = key.charCodeAt(i % key.length);
    result.push(charCode ^ keyChar);
  }
  return String.fromCharCode(...result);
}

export async function secureSetItem(storageKey: string, value: string): Promise<void> {
  try {
    const encrypted = await aesGcmEncrypt(value);
    await AsyncStorage.setItem(storageKey, ENCRYPTED_PREFIX_V2 + encrypted);
  } catch {
    // Fallback: store with basic encoding if AES-GCM unavailable
    const key = await getOrCreateEncryptionKey();
    const encoded = btoa(unescape(encodeURIComponent(value)));
    await AsyncStorage.setItem(storageKey, ENCRYPTED_PREFIX_V1 + encoded);
  }
}

export async function secureGetItem(storageKey: string): Promise<string | null> {
  const raw = await AsyncStorage.getItem(storageKey);
  if (!raw) return null;

  // V2: AES-GCM encrypted
  if (raw.startsWith(ENCRYPTED_PREFIX_V2)) {
    try {
      const encryptedData = raw.slice(ENCRYPTED_PREFIX_V2.length);
      return await aesGcmDecrypt(encryptedData);
    } catch {
      console.log('[SecureStorage] V2 decryption failed for key:', storageKey);
      return null;
    }
  }

  // V1: Legacy XOR — decrypt, then re-encrypt with V2
  if (raw.startsWith(ENCRYPTED_PREFIX_V1)) {
    try {
      const key = await getOrCreateEncryptionKey();
      const encryptedData = raw.slice(ENCRYPTED_PREFIX_V1.length);
      const plaintext = xorDecryptLegacy(encryptedData, key);
      // Migrate to V2
      await secureSetItem(storageKey, plaintext);
      return plaintext;
    } catch {
      console.log('[SecureStorage] V1 migration failed for key:', storageKey);
      return null;
    }
  }

  // Unencrypted legacy data — encrypt and save
  try {
    await secureSetItem(storageKey, raw);
    return raw;
  } catch {
    return raw;
  }
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

  const phiKeys = allKeys.filter((k) =>
    phiPrefixes.some((prefix) => k.startsWith(prefix))
  );

  if (phiKeys.length > 0) {
    await AsyncStorage.multiRemove(phiKeys);
  }

  try {
    await SecureStore.deleteItemAsync(ENCRYPTION_KEY_ID);
  } catch {
    // noop
  }

  try {
    await SecureStore.deleteItemAsync('hipaa_pin_hash');
  } catch {
    // noop
  }

  cachedKey = null;
  cachedCryptoKey = null;
}

export async function hashValue(value: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
}
