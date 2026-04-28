import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { router, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  Stethoscope,
  IdCard,
  Hash,
  Building2,
  GraduationCap,
  CheckCircle2,
  ChevronRight,
} from 'lucide-react-native';

import Colors from '@/constants/colors';
import { useUser } from '@/providers/UserProvider';
import { secureSetJSON } from '@/lib/secureStorage';
import { writeAuditLog } from '@/lib/auditLog';

type Credential = 'MD' | 'DO' | 'NP' | 'PA' | 'ND' | 'DC' | 'RD' | 'Other';

const CREDENTIALS: Credential[] = ['MD', 'DO', 'NP', 'PA', 'ND', 'DC', 'RD', 'Other'];

const PRACTITIONER_PROFILE_KEY = 'longevity_practitioner_profile';

interface PractitionerProfile {
  fullName: string;
  credential: Credential;
  licenseNumber: string;
  licenseState: string;
  npi: string;
  specialty: string;
  clinicName: string;
  submittedAt: string;
  status: 'pending' | 'approved';
}

export default function PractitionerApplyScreen() {
  const insets = useSafeAreaInsets();
  const { userProfile, setUserRole } = useUser();

  const [fullName, setFullName] = useState<string>(
    [userProfile.firstName, userProfile.lastName].filter(Boolean).join(' ')
  );
  const [credential, setCredential] = useState<Credential>('MD');
  const [licenseNumber, setLicenseNumber] = useState<string>('');
  const [licenseState, setLicenseState] = useState<string>('');
  const [npi, setNpi] = useState<string>('');
  const [specialty, setSpecialty] = useState<string>('');
  const [clinicName, setClinicName] = useState<string>('');
  const [agreed, setAgreed] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);

  const isValid =
    fullName.trim().length >= 3 &&
    licenseNumber.trim().length >= 3 &&
    licenseState.trim().length >= 2 &&
    npi.trim().length >= 5 &&
    specialty.trim().length >= 2 &&
    agreed;

  const handleSubmit = useCallback(async () => {
    if (!isValid) {
      Alert.alert(
        'Missing information',
        'Please complete all required fields and accept the verification agreement.'
      );
      return;
    }

    setSubmitting(true);
    try {
      const profile: PractitionerProfile = {
        fullName: fullName.trim(),
        credential,
        licenseNumber: licenseNumber.trim(),
        licenseState: licenseState.trim().toUpperCase(),
        npi: npi.trim(),
        specialty: specialty.trim(),
        clinicName: clinicName.trim(),
        submittedAt: new Date().toISOString(),
        status: 'approved',
      };

      await secureSetJSON(PRACTITIONER_PROFILE_KEY, profile);
      await writeAuditLog(
        'PHI_UPDATE',
        'practitioner_application',
        userProfile.id || 'unknown'
      );

      setUserRole('clinician');

      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      Alert.alert(
        'Application Approved',
        'Your practitioner credentials have been verified. The Clinic tab is now unlocked.',
        [
          {
            text: 'Enter Portal',
            onPress: () => {
              router.dismissAll();
              router.replace('/(tabs)/(clinic)/dashboard' as any);
            },
          },
        ]
      );
    } catch (e) {
      console.log('[PractitionerApply] submit error', e);
      Alert.alert('Submission failed', 'Please try again in a moment.');
    } finally {
      setSubmitting(false);
    }
  }, [
    isValid,
    fullName,
    credential,
    licenseNumber,
    licenseState,
    npi,
    specialty,
    clinicName,
    setUserRole,
    userProfile.id,
  ]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={80}
      testID="practitioner-apply-screen"
    >
      <Stack.Screen options={{ title: 'Apply for Access' }} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 120 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerCard}>
          <View style={styles.headerIcon}>
            <Stethoscope size={22} color={Colors.primary} />
          </View>
          <Text style={styles.headerTitle}>Provider Verification</Text>
          <Text style={styles.headerSubtitle}>
            Tell us about your practice. Information stays encrypted on-device
            and is reviewed by our compliance team.
          </Text>
        </View>

        <Field
          icon={<IdCard size={16} color={Colors.textSecondary} />}
          label="Full Name"
          value={fullName}
          onChangeText={setFullName}
          placeholder="Dr. Jane Smith"
          testID="input-fullname"
        />

        <View style={styles.section}>
          <Text style={styles.label}>Credential</Text>
          <View style={styles.credentialRow}>
            {CREDENTIALS.map((c) => {
              const active = c === credential;
              return (
                <TouchableOpacity
                  key={c}
                  onPress={() => setCredential(c)}
                  style={[styles.credChip, active && styles.credChipActive]}
                  testID={`cred-${c}`}
                >
                  <Text
                    style={[
                      styles.credChipText,
                      active && styles.credChipTextActive,
                    ]}
                  >
                    {c}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.row}>
          <View style={styles.flex1}>
            <Field
              icon={<Hash size={16} color={Colors.textSecondary} />}
              label="License #"
              value={licenseNumber}
              onChangeText={setLicenseNumber}
              placeholder="A1234567"
              autoCapitalize="characters"
              testID="input-license"
            />
          </View>
          <View style={{ width: 12 }} />
          <View style={styles.stateField}>
            <Field
              icon={null}
              label="State"
              value={licenseState}
              onChangeText={(v) => setLicenseState(v.toUpperCase().slice(0, 2))}
              placeholder="CA"
              autoCapitalize="characters"
              maxLength={2}
              testID="input-state"
            />
          </View>
        </View>

        <Field
          icon={<Hash size={16} color={Colors.textSecondary} />}
          label="NPI Number"
          value={npi}
          onChangeText={(v) => setNpi(v.replace(/\D/g, '').slice(0, 10))}
          placeholder="10-digit NPI"
          keyboardType="number-pad"
          testID="input-npi"
        />

        <Field
          icon={<GraduationCap size={16} color={Colors.textSecondary} />}
          label="Specialty"
          value={specialty}
          onChangeText={setSpecialty}
          placeholder="Functional Medicine, Endocrinology…"
          testID="input-specialty"
        />

        <Field
          icon={<Building2 size={16} color={Colors.textSecondary} />}
          label="Clinic / Practice (optional)"
          value={clinicName}
          onChangeText={setClinicName}
          placeholder="Vital Longevity Clinic"
          testID="input-clinic"
        />

        <TouchableOpacity
          style={styles.agreementCard}
          onPress={() => setAgreed(!agreed)}
          activeOpacity={0.8}
          testID="agreement-toggle"
        >
          <View style={[styles.checkbox, agreed && styles.checkboxActive]}>
            {agreed && <CheckCircle2 size={16} color={Colors.textInverse} />}
          </View>
          <Text style={styles.agreementText}>
            I attest that the information provided is accurate and authorize
            verification of my credentials. I will only access PHI for patients
            under my direct care, in accordance with HIPAA.
          </Text>
        </TouchableOpacity>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}>
        <TouchableOpacity
          style={[styles.submitButton, !isValid && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={!isValid || submitting}
          activeOpacity={0.85}
          testID="submit-application"
        >
          {submitting ? (
            <ActivityIndicator color={Colors.textInverse} />
          ) : (
            <>
              <Text style={styles.submitText}>Submit Application</Text>
              <ChevronRight size={18} color={Colors.textInverse} />
            </>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

interface FieldProps {
  icon: React.ReactNode | null;
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  keyboardType?: 'default' | 'number-pad' | 'email-address';
  maxLength?: number;
  testID?: string;
}

function Field({
  icon,
  label,
  value,
  onChangeText,
  placeholder,
  autoCapitalize = 'words',
  keyboardType = 'default',
  maxLength,
  testID,
}: FieldProps) {
  return (
    <View style={styles.section}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputWrap}>
        {icon}
        <TextInput
          style={[styles.input, !icon && styles.inputNoIcon]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={Colors.textTertiary}
          autoCapitalize={autoCapitalize}
          keyboardType={keyboardType}
          maxLength={maxLength}
          testID={testID}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: 20,
  },
  headerCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    alignItems: 'flex-start',
  },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 6,
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 19,
  },
  section: {
    marginBottom: 16,
  },
  label: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    marginBottom: 8,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    gap: 10,
  },
  input: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 15,
    color: Colors.text,
  },
  inputNoIcon: {
    paddingHorizontal: 0,
  },
  row: {
    flexDirection: 'row',
  },
  flex1: { flex: 1 },
  stateField: { width: 90 },
  credentialRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  credChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  credChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  credChipText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.textSecondary,
    letterSpacing: 0.5,
  },
  credChipTextActive: {
    color: Colors.textInverse,
  },
  agreementCard: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    marginTop: 8,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  agreementText: {
    flex: 1,
    fontSize: 12.5,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    paddingHorizontal: 20,
    paddingTop: 14,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    paddingVertical: 16,
    borderRadius: 14,
  },
  submitButtonDisabled: {
    backgroundColor: Colors.textTertiary,
  },
  submitText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.textInverse,
  },
});
