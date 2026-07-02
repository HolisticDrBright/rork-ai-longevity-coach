import createContextHook from '@nkzw/create-context-hook';
import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { writeAuditLog } from '@/lib/auditLog';
import { recordFailedAuth, resetFailedAuthCount } from '@/lib/breachDetection';

const PIN_HASH_KEY = 'hipaa_pin_hash';
const SESSION_KEY = 'hipaa_session_active';
const BIOMETRIC_ENABLED_KEY = 'hipaa_biometric_enabled';
const LOCKOUT_STATE_KEY = 'hipaa_pin_lockout_state';
const SESSION_TIMEOUT_MS = 5 * 60 * 1000;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS_BEFORE_LOCKOUT = 5;

// Persistence helpers: SecureStore on native, AsyncStorage fallback (web).
async function persistedGetItem(key: string): Promise<string | null> {
  try {
    const value = await SecureStore.getItemAsync(key);
    if (value !== null) return value;
  } catch {
    // SecureStore unavailable (web) — fall through
  }
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

async function persistedSetItem(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value);
    return;
  } catch {
    // SecureStore unavailable (web) — fall through
  }
  try {
    await AsyncStorage.setItem(key, value);
  } catch {
    // noop
  }
}

async function persistedRemoveItem(key: string): Promise<void> {
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
}

interface LockoutState {
  failedAttempts: number;
  lockedUntil: number | null;
}

async function persistLockoutState(state: LockoutState): Promise<void> {
  if (state.failedAttempts === 0 && !state.lockedUntil) {
    await persistedRemoveItem(LOCKOUT_STATE_KEY);
    return;
  }
  await persistedSetItem(LOCKOUT_STATE_KEY, JSON.stringify(state));
}

async function loadLockoutState(): Promise<LockoutState> {
  const raw = await persistedGetItem(LOCKOUT_STATE_KEY);
  if (!raw) return { failedAttempts: 0, lockedUntil: null };
  try {
    const parsed = JSON.parse(raw) as Partial<LockoutState>;
    return {
      failedAttempts: typeof parsed.failedAttempts === 'number' ? parsed.failedAttempts : 0,
      lockedUntil: typeof parsed.lockedUntil === 'number' ? parsed.lockedUntil : null,
    };
  } catch {
    return { failedAttempts: 0, lockedUntil: null };
  }
}

// ── PIN hashing ──────────────────────────────────────────────────────────
// Current format: "v2:<salt>:<sha256(pin + salt)>" with a per-device random
// salt. Legacy format (constant salt, plain hex hash) is still verified for
// backward compatibility and upgraded on successful auth.
const SALTED_HASH_PREFIX = 'v2:';
const LEGACY_PIN_SALT = 'hipaa_salt_v1';

function generateSalt(): string {
  return Array.from(Crypto.getRandomBytes(16))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hashPinWithSalt(pin: string, salt: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, pin + salt);
}

async function makeStoredPinHash(pin: string): Promise<string> {
  const salt = generateSalt();
  const hash = await hashPinWithSalt(pin, salt);
  return `${SALTED_HASH_PREFIX}${salt}:${hash}`;
}

async function verifyPinAgainstStored(
  pin: string,
  stored: string
): Promise<{ valid: boolean; isLegacyFormat: boolean }> {
  if (stored.startsWith(SALTED_HASH_PREFIX)) {
    const [, salt, hash] = stored.split(':');
    if (!salt || !hash) return { valid: false, isLegacyFormat: false };
    const inputHash = await hashPinWithSalt(pin, salt);
    return { valid: inputHash === hash, isLegacyFormat: false };
  }
  // Legacy unsalted-constant format
  const legacyHash = await hashPinWithSalt(pin, LEGACY_PIN_SALT);
  return { valid: legacyHash === stored, isLegacyFormat: true };
}

export const [AuthProvider, useAuth] = createContextHook(() => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isPinSet, setIsPinSet] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    checkInitialState();
    checkBiometrics();
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) {
      resetInactivityTimer();
    }
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [isAuthenticated]);

  const resetInactivityTimer = useCallback(() => {
    lastActivityRef.current = Date.now();
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      if (isAuthenticated) {
        lockSession();
      }
    }, SESSION_TIMEOUT_MS);
  }, [isAuthenticated]);

  const handleAppStateChange = useCallback(
    (nextState: AppStateStatus) => {
      if (nextState === 'background' || nextState === 'inactive') {
        if (isAuthenticated) {
          const elapsed = Date.now() - lastActivityRef.current;
          if (elapsed > SESSION_TIMEOUT_MS) {
            lockSession();
          }
        }
      }
      if (nextState === 'active' && isAuthenticated) {
        const elapsed = Date.now() - lastActivityRef.current;
        if (elapsed > SESSION_TIMEOUT_MS) {
          lockSession();
        } else {
          resetInactivityTimer();
        }
      }
    },
    [isAuthenticated, resetInactivityTimer]
  );

  const checkInitialState = async () => {
    try {
      const pinHash = await SecureStore.getItemAsync(PIN_HASH_KEY);
      setIsPinSet(!!pinHash);

      // Restore persisted lockout state so force-quitting the app cannot
      // bypass a lockout. If the lockout has already expired, reset the
      // failed-attempt counter.
      const lockout = await loadLockoutState();
      if (lockout.lockedUntil && Date.now() < lockout.lockedUntil) {
        setFailedAttempts(lockout.failedAttempts);
        setLockedUntil(lockout.lockedUntil);
      } else if (lockout.lockedUntil || lockout.failedAttempts > 0) {
        if (lockout.lockedUntil) {
          // Expired lockout — clear counter entirely
          await persistLockoutState({ failedAttempts: 0, lockedUntil: null });
        } else {
          setFailedAttempts(lockout.failedAttempts);
        }
      }

      const bioEnabled = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
      setBiometricEnabled(bioEnabled === 'true');

      // If the user has a PIN set and biometrics enabled, try auto-authenticating
      // so they don't have to re-enter the PIN every app launch.
      if (pinHash && bioEnabled === 'true') {
        try {
          const result = await LocalAuthentication.authenticateAsync({
            promptMessage: 'Unlock AI Longevity Pro',
            cancelLabel: 'Use PIN',
            disableDeviceFallback: true,
          });
          if (result.success) {
            setIsAuthenticated(true);
            await writeAuditLog('AUTH_LOGIN', 'biometric_auto', 'user', 'Auto biometric auth on launch');
          }
        } catch {
          // Biometric failed — user will see PIN screen
        }
      }
    } catch {
      // noop
    } finally {
      setIsLoading(false);
    }
  };

  const checkBiometrics = async () => {
    if (Platform.OS === 'web') {
      setBiometricAvailable(false);
      return;
    }
    try {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      setBiometricAvailable(compatible && enrolled);
    } catch {
      setBiometricAvailable(false);
    }
  };

  const setupPin = useCallback(async (pin: string): Promise<boolean> => {
    try {
      const hash = await makeStoredPinHash(pin);
      await SecureStore.setItemAsync(PIN_HASH_KEY, hash);
      setIsPinSet(true);
      setIsAuthenticated(true);
      await writeAuditLog('AUTH_LOGIN', 'pin_setup', 'system', 'PIN created');
      resetInactivityTimer();
      return true;
    } catch {
      return false;
    }
  }, [resetInactivityTimer]);

  const verifyPin = useCallback(async (pin: string): Promise<boolean> => {
    let currentAttempts = failedAttempts;

    if (lockedUntil) {
      if (Date.now() < lockedUntil) {
        return false;
      }
      // Lockout expired — reset the counter so a single wrong PIN doesn't
      // immediately re-lock.
      currentAttempts = 0;
      setFailedAttempts(0);
      setLockedUntil(null);
      await persistLockoutState({ failedAttempts: 0, lockedUntil: null });
    }

    try {
      const storedHash = await SecureStore.getItemAsync(PIN_HASH_KEY);
      if (!storedHash) return false;

      const { valid, isLegacyFormat } = await verifyPinAgainstStored(pin, storedHash);
      if (valid) {
        if (isLegacyFormat) {
          // Upgrade legacy constant-salt hash to per-device salted format.
          try {
            await SecureStore.setItemAsync(PIN_HASH_KEY, await makeStoredPinHash(pin));
          } catch {
            // Non-fatal: legacy hash still verifies
          }
        }
        setIsAuthenticated(true);
        setFailedAttempts(0);
        setLockedUntil(null);
        await persistLockoutState({ failedAttempts: 0, lockedUntil: null });
        await resetFailedAuthCount();
        await writeAuditLog('AUTH_LOGIN', 'pin_verify', 'user', 'PIN verified');
        resetInactivityTimer();
        return true;
      }

      const newAttempts = currentAttempts + 1;
      const lockUntil =
        newAttempts >= MAX_ATTEMPTS_BEFORE_LOCKOUT ? Date.now() + LOCKOUT_DURATION_MS : null;
      setFailedAttempts(newAttempts);
      if (lockUntil) {
        setLockedUntil(lockUntil);
      }
      // Persist so force-quitting the app cannot reset the lockout.
      await persistLockoutState({ failedAttempts: newAttempts, lockedUntil: lockUntil });
      await recordFailedAuth('user');
      await writeAuditLog('AUTH_FAILED', 'pin_verify', 'user', `Attempt ${newAttempts}`);

      return false;
    } catch {
      return false;
    }
  }, [failedAttempts, lockedUntil, resetInactivityTimer]);

  const authenticateWithBiometrics = useCallback(async (): Promise<boolean> => {
    if (Platform.OS === 'web' || !biometricAvailable || !biometricEnabled) return false;

    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Authenticate to access health data',
        cancelLabel: 'Use PIN',
        disableDeviceFallback: true,
      });

      if (result.success) {
        setIsAuthenticated(true);
        setFailedAttempts(0);
        setLockedUntil(null);
        await persistLockoutState({ failedAttempts: 0, lockedUntil: null });
        await writeAuditLog('AUTH_LOGIN', 'biometric', 'user', 'Biometric auth success');
        resetInactivityTimer();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [biometricAvailable, biometricEnabled, resetInactivityTimer]);

  const toggleBiometric = useCallback(async (enabled: boolean): Promise<void> => {
    try {
      await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, String(enabled));
      setBiometricEnabled(enabled);
    } catch {
      // noop
    }
  }, []);

  const lockSession = useCallback(async () => {
    setIsAuthenticated(false);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    await writeAuditLog('AUTH_TIMEOUT', 'session', 'user', 'Session timed out');
  }, []);

  const logout = useCallback(async () => {
    setIsAuthenticated(false);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    await writeAuditLog('AUTH_LOGOUT', 'session', 'user', 'User logged out');
  }, []);

  const recordActivity = useCallback(() => {
    if (isAuthenticated) {
      resetInactivityTimer();
    }
  }, [isAuthenticated, resetInactivityTimer]);

  const changePin = useCallback(async (currentPin: string, newPin: string): Promise<boolean> => {
    const isValid = await verifyPin(currentPin);
    if (!isValid) return false;

    const hash = await makeStoredPinHash(newPin);
    await SecureStore.setItemAsync(PIN_HASH_KEY, hash);
    await writeAuditLog('PHI_UPDATE', 'pin_change', 'user', 'PIN changed');
    return true;
  }, [verifyPin]);

  const remainingLockoutSeconds = lockedUntil
    ? Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000))
    : 0;

  return {
    isAuthenticated,
    isPinSet,
    isLoading,
    biometricAvailable,
    biometricEnabled,
    failedAttempts,
    isLockedOut: !!lockedUntil && Date.now() < lockedUntil,
    remainingLockoutSeconds,
    setupPin,
    verifyPin,
    authenticateWithBiometrics,
    toggleBiometric,
    lockSession,
    logout,
    recordActivity,
    changePin,
  };
});
