import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const ENCRYPTION_KEY_ID = 'hipaa_encryption_key';
const KEY_LENGTH = 32;

let cachedKey: string | null = null;

async function getOrCreateEncryptionKey(): Promise<string> {
  if (cachedKey) return cachedKey;

  try {
    const existing = await SecureStore.getItemAsync(ENCRYPTION_KEY_ID);
    if (existing) {
      cachedKey = existing;
      return existing;
    }
  } catch (e) {
    console.log('[SecureStorage] Could not retrieve key from SecureStore');
  }

  const randomBytes = Crypto.getRandomBytes(KEY_LENGTH);
  const key = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  try {
    await SecureStore.setItemAsync(ENCRYPTION_KEY_ID, key);
  } catch (e) {
    console.log('[SecureStorage] Could not save key to SecureStore, using session key');
  }

  cachedKey = key;
  return key;
}

function xorEncrypt(data: string, key: string): string {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const charCode = data.charCodeAt(i);
    const keyChar = key.charCodeAt(i % key.length);
    result.push(charCode ^ keyChar);
  }
  return btoa(String.fromCharCode(...result));
}

function xorDecrypt(encoded: string, key: string): string {
  const decoded = atob(encoded);
  const result: number[] = [];
  for (let i = 0; i < decoded.length; i++) {
    const charCode = decoded.charCodeAt(i);
    const keyChar = key.charCodeAt(i % key.length);
    result.push(charCode ^ keyChar);
  }
  return String.fromCharCode(...result);
}

const ENCRYPTED_PREFIX = 'ENC_V1:';

export async function secureSetItem(storageKey: string, value: string): Promise<void> {
  const key = await getOrCreateEncryptionKey();
  const encrypted = ENCRYPTED_PREFIX + xorEncrypt(value, key);
  await AsyncStorage.setItem(storageKey, encrypted);
}

export async function secureGetItem(storageKey: string): Promise<string | null> {
  const raw = await AsyncStorage.getItem(storageKey);
  if (!raw) return null;

  if (!raw.startsWith(ENCRYPTED_PREFIX)) {
    const key = await getOrCreateEncryptionKey();
    const encrypted = ENCRYPTED_PREFIX + xorEncrypt(raw, key);
    await AsyncStorage.setItem(storageKey, encrypted);
    return raw;
  }

  const key = await getOrCreateEncryptionKey();
  const encryptedData = raw.slice(ENCRYPTED_PREFIX.length);
  return xorDecrypt(encryptedData, key);
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
}

export async function hashValue(value: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
}
