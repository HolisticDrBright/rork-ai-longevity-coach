import createContextHook from '@nkzw/create-context-hook';
import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Crypto from 'expo-crypto';
import { writeAuditLog } from '@/lib/auditLog';
import { recordFailedAuth, resetFailedAuthCount } from '@/lib/breachDetection';

const PIN_HASH_KEY = 'hipaa_pin_hash';
const SESSION_KEY = 'hipaa_session_active';
const BIOMETRIC_ENABLED_KEY = 'hipaa_biometric_enabled';
const SESSION_TIMEOUT_MS = 5 * 60 * 1000;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS_BEFORE_LOCKOUT = 5;

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

  const hashPin = async (pin: string): Promise<string> => {
    return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, pin + 'hipaa_salt_v1');
  };

  const setupPin = useCallback(async (pin: string): Promise<boolean> => {
    try {
      const hash = await hashPin(pin);
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
    if (lockedUntil && Date.now() < lockedUntil) {
      return false;
    }

    try {
      const storedHash = await SecureStore.getItemAsync(PIN_HASH_KEY);
      if (!storedHash) return false;

      const inputHash = await hashPin(pin);
      if (inputHash === storedHash) {
        setIsAuthenticated(true);
        setFailedAttempts(0);
        setLockedUntil(null);
        await resetFailedAuthCount();
        await writeAuditLog('AUTH_LOGIN', 'pin_verify', 'user', 'PIN verified');
        resetInactivityTimer();
        return true;
      }

      const newAttempts = failedAttempts + 1;
      setFailedAttempts(newAttempts);
      await recordFailedAuth('user');
      await writeAuditLog('AUTH_FAILED', 'pin_verify', 'user', `Attempt ${newAttempts}`);

      if (newAttempts >= MAX_ATTEMPTS_BEFORE_LOCKOUT) {
        const lockUntil = Date.now() + LOCKOUT_DURATION_MS;
        setLockedUntil(lockUntil);
      }

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

    const hash = await hashPin(newPin);
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
