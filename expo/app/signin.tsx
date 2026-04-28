import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Sparkles, Mail, Lock, User, Stethoscope, ChevronRight, Eye, EyeOff } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useSupabaseAuth } from '@/providers/SupabaseAuthProvider';

type AuthMode = 'welcome' | 'signin' | 'signup';
type UserRole = 'patient' | 'clinician';

export default function SignInScreen() {
  const insets = useSafeAreaInsets();
  const { signUp, signIn, authError, clearError, isLoading } = useSupabaseAuth();

  const [mode, setMode] = useState<AuthMode>('welcome');
  const [role, setRole] = useState<UserRole>('patient');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const switchMode = useCallback((newMode: AuthMode) => {
    setMode(newMode);
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    clearError();
  }, [clearError]);

  const handleSignIn = useCallback(async () => {
    if (!email.trim() || !password) {
      Alert.alert('Missing fields', 'Please enter your email and password.');
      return;
    }
    setSubmitting(true);
    const success = await signIn(email.trim(), password);
    setSubmitting(false);
    if (!success && authError) {
      Alert.alert('Sign in failed', authError);
    }
  }, [email, password, signIn, authError]);

  const handleSignUp = useCallback(async () => {
    if (!email.trim() || !password) {
      Alert.alert('Missing fields', 'Please enter your email and password.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Weak password', 'Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Mismatch', 'Passwords do not match.');
      return;
    }
    setSubmitting(true);
    const success = await signUp(email.trim(), password);
    setSubmitting(false);
    if (success) {
      Alert.alert(
        'Account created',
        'Check your email to confirm your account, then sign in.',
        [{ text: 'OK', onPress: () => switchMode('signin') }]
      );
    } else if (authError) {
      Alert.alert('Sign up failed', authError);
    }
  }, [email, password, confirmPassword, role, signUp, authError, switchMode]);

  // ── Welcome screen with role selection ──────────────────────
  if (mode === 'welcome') {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.heroSection}>
          <View style={styles.logoContainer}>
            <Sparkles size={36} color="#fff" />
          </View>
          <Text style={styles.appName}>AI Longevity Pro</Text>
          <Text style={styles.tagline}>Clinical-grade health optimization</Text>
        </View>

        <View style={styles.roleSection}>
          <Text style={styles.roleLabel}>I am a...</Text>

          <TouchableOpacity
            style={[styles.roleCard, role === 'patient' && styles.roleCardActive]}
            onPress={() => setRole('patient')}
            activeOpacity={0.85}
          >
            <View style={[styles.roleIcon, role === 'patient' && styles.roleIconActive]}>
              <User size={24} color={role === 'patient' ? '#fff' : Colors.primary} />
            </View>
            <View style={styles.roleContent}>
              <Text style={[styles.roleTitle, role === 'patient' && styles.roleTitleActive]}>Patient</Text>
              <Text style={styles.roleDescription}>
                Track labs, protocols, wearables, and get personalized longevity insights
              </Text>
            </View>
            {role === 'patient' && (
              <View style={styles.roleCheck}>
                <View style={styles.roleCheckDot} />
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.roleCard, role === 'clinician' && styles.roleCardActive]}
            onPress={() => setRole('clinician')}
            activeOpacity={0.85}
          >
            <View style={[styles.roleIcon, role === 'clinician' && styles.roleIconActive]}>
              <Stethoscope size={24} color={role === 'clinician' ? '#fff' : Colors.primary} />
            </View>
            <View style={styles.roleContent}>
              <Text style={[styles.roleTitle, role === 'clinician' && styles.roleTitleActive]}>Practitioner</Text>
              <Text style={styles.roleDescription}>
                Manage patients, review protocols, and access the clinic portal
              </Text>
            </View>
            {role === 'clinician' && (
              <View style={styles.roleCheck}>
                <View style={styles.roleCheckDot} />
              </View>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.actionSection}>
          <TouchableOpacity style={styles.primaryButton} onPress={() => switchMode('signup')}>
            <Text style={styles.primaryButtonText}>Create account</Text>
            <ChevronRight size={18} color="#fff" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryButton} onPress={() => switchMode('signin')}>
            <Text style={styles.secondaryButtonText}>I already have an account</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Sign in / Sign up form ──────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.formScroll} keyboardShouldPersistTaps="handled">
        <View style={styles.formHeader}>
          <View style={styles.logoContainerSmall}>
            <Sparkles size={24} color="#fff" />
          </View>
          <Text style={styles.formTitle}>
            {mode === 'signin' ? 'Welcome back' : 'Create your account'}
          </Text>
          <Text style={styles.formSubtitle}>
            {mode === 'signin'
              ? 'Sign in to access your health data'
              : `Signing up as a ${role === 'patient' ? 'patient' : 'practitioner'}`}
          </Text>
        </View>

        <View style={styles.inputGroup}>
          <View style={styles.inputContainer}>
            <Mail size={18} color={Colors.textTertiary} />
            <TextInput
              style={styles.input}
              placeholder="Email address"
              placeholderTextColor={Colors.textTertiary}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
            />
          </View>

          <View style={styles.inputContainer}>
            <Lock size={18} color={Colors.textTertiary} />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={Colors.textTertiary}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              textContentType={mode === 'signup' ? 'newPassword' : 'password'}
            />
            <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
              {showPassword
                ? <EyeOff size={18} color={Colors.textTertiary} />
                : <Eye size={18} color={Colors.textTertiary} />}
            </TouchableOpacity>
          </View>

          {mode === 'signup' && (
            <View style={styles.inputContainer}>
              <Lock size={18} color={Colors.textTertiary} />
              <TextInput
                style={styles.input}
                placeholder="Confirm password"
                placeholderTextColor={Colors.textTertiary}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showPassword}
                textContentType="newPassword"
              />
            </View>
          )}
        </View>

        {authError ? (
          <Text style={styles.errorText}>{authError}</Text>
        ) : null}

        <TouchableOpacity
          style={[styles.primaryButton, submitting && styles.buttonDisabled]}
          onPress={mode === 'signin' ? handleSignIn : handleSignUp}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryButtonText}>
              {mode === 'signin' ? 'Sign in' : 'Create account'}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.switchMode}
          onPress={() => switchMode(mode === 'signin' ? 'signup' : 'signin')}
        >
          <Text style={styles.switchModeText}>
            {mode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.backButton} onPress={() => switchMode('welcome')}>
          <Text style={styles.backButtonText}>← Back to role selection</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  heroSection: { alignItems: 'center', gap: 10, marginBottom: 32 },
  logoContainer: {
    width: 72, height: 72, borderRadius: 22,
    backgroundColor: Colors.primary,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35, shadowRadius: 14, elevation: 8,
  },
  appName: { fontSize: 28, fontWeight: '800', color: Colors.text, letterSpacing: -0.5 },
  tagline: { fontSize: 15, color: Colors.textSecondary },
  roleSection: { paddingHorizontal: 24, gap: 12 },
  roleLabel: { fontSize: 16, fontWeight: '700', color: Colors.text, marginBottom: 4 },
  roleCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    padding: 16, borderRadius: 14,
    backgroundColor: Colors.surface,
    borderWidth: 2, borderColor: Colors.border,
  },
  roleCardActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '08' },
  roleIcon: {
    width: 48, height: 48, borderRadius: 14,
    backgroundColor: Colors.primary + '15',
    justifyContent: 'center', alignItems: 'center',
  },
  roleIconActive: { backgroundColor: Colors.primary },
  roleContent: { flex: 1, gap: 2 },
  roleTitle: { fontSize: 16, fontWeight: '700', color: Colors.text },
  roleTitleActive: { color: Colors.primary },
  roleDescription: { fontSize: 12, color: Colors.textSecondary, lineHeight: 16 },
  roleCheck: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: Colors.primary,
    justifyContent: 'center', alignItems: 'center',
  },
  roleCheckDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
  actionSection: { paddingHorizontal: 24, gap: 12, marginTop: 'auto' },
  primaryButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: 14,
    paddingVertical: 16,
  },
  primaryButtonText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  buttonDisabled: { opacity: 0.6 },
  secondaryButton: { alignItems: 'center', paddingVertical: 12 },
  secondaryButtonText: { fontSize: 14, fontWeight: '600', color: Colors.primary },
  formScroll: { padding: 24, gap: 20, flexGrow: 1 },
  formHeader: { alignItems: 'center', gap: 8, marginBottom: 12 },
  logoContainerSmall: {
    width: 52, height: 52, borderRadius: 16,
    backgroundColor: Colors.primary,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 8,
  },
  formTitle: { fontSize: 24, fontWeight: '800', color: Colors.text },
  formSubtitle: { fontSize: 14, color: Colors.textSecondary },
  inputGroup: { gap: 12 },
  inputContainer: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 14, paddingVertical: 14,
  },
  input: { flex: 1, fontSize: 15, color: Colors.text },
  errorText: { fontSize: 13, color: Colors.danger, textAlign: 'center' },
  switchMode: { alignItems: 'center', paddingVertical: 8 },
  switchModeText: { fontSize: 14, color: Colors.primary, fontWeight: '500' },
  backButton: { alignItems: 'center', paddingVertical: 8, marginTop: 'auto' },
  backButtonText: { fontSize: 13, color: Colors.textSecondary },
});
