import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Platform,
  Vibration,
} from 'react-native';
import { Shield, Fingerprint, Lock, Delete, Eye, EyeOff } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useAuth } from '@/providers/AuthProvider';

const PIN_LENGTH = 6;

export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const {
    isPinSet,
    biometricAvailable,
    biometricEnabled,
    isLockedOut,
    remainingLockoutSeconds,
    failedAttempts,
    setupPin,
    verifyPin,
    authenticateWithBiometrics,
  } = useAuth();

  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState('');
  const [lockoutTimer, setLockoutTimer] = useState(0);

  const shakeAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const dotScales = useRef(
    Array.from({ length: PIN_LENGTH }, () => new Animated.Value(0))
  ).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, []);

  useEffect(() => {
    if (isLockedOut && remainingLockoutSeconds > 0) {
      setLockoutTimer(remainingLockoutSeconds);
      const interval = setInterval(() => {
        setLockoutTimer((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [isLockedOut, remainingLockoutSeconds]);

  useEffect(() => {
    if (isPinSet && biometricAvailable && biometricEnabled) {
      attemptBiometric();
    }
  }, [isPinSet, biometricAvailable, biometricEnabled]);

  const attemptBiometric = async () => {
    const success = await authenticateWithBiometrics();
    if (!success) {
      // fall through to PIN
    }
  };

  const animateDot = useCallback(
    (index: number) => {
      Animated.spring(dotScales[index], {
        toValue: 1,
        friction: 3,
        tension: 200,
        useNativeDriver: true,
      }).start();
    },
    [dotScales]
  );

  const resetDots = useCallback(() => {
    dotScales.forEach((dot) => dot.setValue(0));
  }, [dotScales]);

  const shakeError = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 15, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -15, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  }, [shakeAnim]);

  const handlePinInput = useCallback(
    async (digit: string) => {
      if (isLockedOut) return;

      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }

      const currentPin = isConfirming ? confirmPin : pin;
      if (currentPin.length >= PIN_LENGTH) return;

      const newPin = currentPin + digit;
      animateDot(currentPin.length);

      if (isConfirming) {
        setConfirmPin(newPin);
      } else {
        setPin(newPin);
      }

      if (newPin.length === PIN_LENGTH) {
        setTimeout(async () => {
          if (!isPinSet) {
            if (!isConfirming) {
              setIsConfirming(true);
              setConfirmPin('');
              resetDots();
              setError('');
            } else {
              if (newPin === pin) {
                await setupPin(newPin);
              } else {
                setError('PINs do not match. Try again.');
                shakeError();
                setPin('');
                setConfirmPin('');
                setIsConfirming(false);
                resetDots();
              }
            }
          } else {
            const success = await verifyPin(newPin);
            if (!success) {
              setError(
                failedAttempts >= 3
                  ? `Incorrect PIN. ${5 - failedAttempts - 1} attempts remaining.`
                  : 'Incorrect PIN'
              );
              shakeError();
              setPin('');
              resetDots();
            }
          }
        }, 200);
      }
    },
    [
      pin,
      confirmPin,
      isConfirming,
      isPinSet,
      isLockedOut,
      failedAttempts,
      animateDot,
      resetDots,
      shakeError,
      setupPin,
      verifyPin,
    ]
  );

  const handleDelete = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    if (isConfirming) {
      if (confirmPin.length > 0) {
        dotScales[confirmPin.length - 1].setValue(0);
        setConfirmPin(confirmPin.slice(0, -1));
      }
    } else {
      if (pin.length > 0) {
        dotScales[pin.length - 1].setValue(0);
        setPin(pin.slice(0, -1));
      }
    }
    setError('');
  }, [pin, confirmPin, isConfirming, dotScales]);

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const currentPinLength = isConfirming ? confirmPin.length : pin.length;

  const getTitle = () => {
    if (isLockedOut) return 'Account Locked';
    if (!isPinSet) {
      return isConfirming ? 'Confirm Your PIN' : 'Create a Secure PIN';
    }
    return 'Enter PIN';
  };

  const getSubtitle = () => {
    if (isLockedOut)
      return `Too many failed attempts.\nTry again in ${formatTime(lockoutTimer)}`;
    if (!isPinSet) {
      return isConfirming
        ? 'Re-enter your 6-digit PIN'
        : 'Set a 6-digit PIN to protect your health data';
    }
    return 'Enter your 6-digit PIN to continue';
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 20 }]}>
      <Animated.View style={[styles.header, { opacity: fadeAnim }]}>
        <View style={styles.shieldIcon}>
          <Shield size={36} color="#fff" />
        </View>
        <Text style={styles.title}>{getTitle()}</Text>
        <Text style={styles.subtitle}>{getSubtitle()}</Text>
      </Animated.View>

      <Animated.View
        style={[
          styles.dotsContainer,
          { transform: [{ translateX: shakeAnim }] },
        ]}
      >
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <Animated.View
            key={i}
            style={[
              styles.dot,
              i < currentPinLength && styles.dotFilled,
              {
                transform: [
                  {
                    scale: dotScales[i].interpolate({
                      inputRange: [0, 1],
                      outputRange: [1, 1.3],
                    }),
                  },
                ],
              },
            ]}
          />
        ))}
      </Animated.View>

      {error ? (
        <Animated.Text style={styles.errorText}>{error}</Animated.Text>
      ) : (
        <View style={styles.errorPlaceholder} />
      )}

      <View style={styles.keypad}>
        {[
          ['1', '2', '3'],
          ['4', '5', '6'],
          ['7', '8', '9'],
          [
            biometricAvailable && biometricEnabled && isPinSet ? 'bio' : '',
            '0',
            'del',
          ],
        ].map((row, rowIdx) => (
          <View key={rowIdx} style={styles.keypadRow}>
            {row.map((key, keyIdx) => {
              if (key === '') {
                return <View key={keyIdx} style={styles.keyEmpty} />;
              }
              if (key === 'del') {
                return (
                  <TouchableOpacity
                    key={keyIdx}
                    style={styles.keySpecial}
                    onPress={handleDelete}
                    testID="pin-delete"
                    disabled={isLockedOut}
                  >
                    <Delete size={24} color={isLockedOut ? Colors.textTertiary : Colors.text} />
                  </TouchableOpacity>
                );
              }
              if (key === 'bio') {
                return (
                  <TouchableOpacity
                    key={keyIdx}
                    style={styles.keySpecial}
                    onPress={attemptBiometric}
                    testID="biometric-auth"
                  >
                    <Fingerprint size={24} color={Colors.primary} />
                  </TouchableOpacity>
                );
              }
              return (
                <TouchableOpacity
                  key={keyIdx}
                  style={[styles.key, isLockedOut && styles.keyDisabled]}
                  onPress={() => handlePinInput(key)}
                  testID={`pin-key-${key}`}
                  disabled={isLockedOut}
                >
                  <Text style={[styles.keyText, isLockedOut && styles.keyTextDisabled]}>
                    {key}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>

      <View style={styles.footer}>
        <Lock size={12} color={Colors.textTertiary} />
        <Text style={styles.footerText}>HIPAA-compliant encrypted storage</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  header: {
    alignItems: 'center',
    gap: 12,
  },
  shieldIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  title: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: Colors.text,
    textAlign: 'center' as const,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 20,
    paddingHorizontal: 40,
  },
  dotsContainer: {
    flexDirection: 'row',
    gap: 16,
    marginVertical: 24,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: Colors.border,
    backgroundColor: 'transparent',
  },
  dotFilled: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  errorText: {
    fontSize: 13,
    color: Colors.danger,
    textAlign: 'center' as const,
    minHeight: 20,
    fontWeight: '500' as const,
  },
  errorPlaceholder: {
    minHeight: 20,
  },
  keypad: {
    gap: 12,
    paddingHorizontal: 40,
  },
  keypadRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
  },
  key: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  keyDisabled: {
    opacity: 0.4,
  },
  keyText: {
    fontSize: 28,
    fontWeight: '500' as const,
    color: Colors.text,
  },
  keyTextDisabled: {
    color: Colors.textTertiary,
  },
  keySpecial: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyEmpty: {
    width: 72,
    height: 72,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  footerText: {
    fontSize: 11,
    color: Colors.textTertiary,
    fontWeight: '500' as const,
  },
});
