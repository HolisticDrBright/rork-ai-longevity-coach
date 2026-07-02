import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[Supabase] Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY');
}

/**
 * Auth token storage adapter.
 *
 * Native: tokens are kept in expo-secure-store (iOS Keychain / Android
 * Keystore) instead of plain AsyncStorage. Existing sessions stored in
 * AsyncStorage are migrated to SecureStore on first read.
 *
 * Web: SecureStore is unavailable, so AsyncStorage (localStorage) is used
 * as the only fallback.
 */
const secureStoreAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      const value = await SecureStore.getItemAsync(key);
      if (value !== null) return value;
    } catch {
      // fall through to migration path
    }
    // One-time migration: older builds persisted the session in AsyncStorage.
    try {
      const legacy = await AsyncStorage.getItem(key);
      if (legacy !== null) {
        try {
          await SecureStore.setItemAsync(key, legacy);
          await AsyncStorage.removeItem(key);
        } catch {
          // keep legacy copy readable if migration fails
        }
        return legacy;
      }
    } catch {
      // noop
    }
    return null;
  },
  setItem: async (key: string, value: string): Promise<void> => {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch (e) {
      console.log('[Supabase] Failed to persist auth token securely:', e instanceof Error ? e.message : 'unknown error');
    }
  },
  removeItem: async (key: string): Promise<void> => {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      // noop
    }
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      // noop
    }
  },
};

const authStorage = Platform.OS === 'web' ? AsyncStorage : secureStoreAdapter;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: authStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
