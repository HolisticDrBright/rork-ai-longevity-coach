import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { UserPlus, ChevronRight } from 'lucide-react-native';

import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { showAlert } from '@/lib/ui/appAlert';

type Sex = 'male' | 'female' | 'other';

const SEX_OPTIONS: { value: Sex; label: string }[] = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'other', label: 'Other' },
];

function isValidIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1900 || year > new Date().getFullYear()) return false;
  if (month < 1 || month > 12) return false;
  const daysInMonth = new Date(year, month, 0).getDate();
  return day >= 1 && day <= daysInMonth;
}

export default function NewPatientScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const utils = trpc.useUtils();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [sex, setSex] = useState<Sex>('female');
  const [email, setEmail] = useState('');

  const createMutation = trpc.clinic.patients.create.useMutation({
    onSuccess: async (patient) => {
      await utils.clinic.patients.list.invalidate().catch(() => undefined);
      showAlert('Patient added', `${patient.firstName} ${patient.lastName} was added to your roster.`);
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/(tabs)/(clinic)/patients' as any);
      }
    },
    onError: (error) => {
      console.log('[NewPatient] create failed', error);
      showAlert('Could not add patient', 'Please check the details and try again.');
    },
  });

  const isValid = useMemo(
    () =>
      firstName.trim().length > 0 &&
      lastName.trim().length > 0 &&
      isValidIsoDate(dateOfBirth.trim()),
    [firstName, lastName, dateOfBirth]
  );

  const handleSubmit = () => {
    if (!isValid) {
      showAlert(
        'Missing information',
        'First name, last name, and a valid date of birth (YYYY-MM-DD) are required.'
      );
      return;
    }
    const trimmedEmail = email.trim();
    if (trimmedEmail && !/^\S+@\S+\.\S+$/.test(trimmedEmail)) {
      showAlert('Invalid email', 'Please enter a valid email address or leave it blank.');
      return;
    }
    createMutation.mutate({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      dateOfBirth: dateOfBirth.trim(),
      sex,
      email: trimmedEmail || undefined,
      tags: [],
      country: 'US',
    });
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={80}
    >
      <Stack.Screen options={{ title: 'New Patient' }} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerCard}>
          <View style={styles.headerIcon}>
            <UserPlus size={22} color={Colors.primary} />
          </View>
          <Text style={styles.headerTitle}>Add a patient</Text>
          <Text style={styles.headerSubtitle}>
            Enter the basics now — health history, labs, and protocols can be added from the
            patient record.
          </Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>First Name</Text>
          <TextInput
            style={styles.input}
            value={firstName}
            onChangeText={setFirstName}
            placeholder="Jane"
            placeholderTextColor={Colors.textTertiary}
            autoCapitalize="words"
            testID="input-first-name"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Last Name</Text>
          <TextInput
            style={styles.input}
            value={lastName}
            onChangeText={setLastName}
            placeholder="Smith"
            placeholderTextColor={Colors.textTertiary}
            autoCapitalize="words"
            testID="input-last-name"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Date of Birth (YYYY-MM-DD)</Text>
          <TextInput
            style={styles.input}
            value={dateOfBirth}
            onChangeText={setDateOfBirth}
            placeholder="1980-05-21"
            placeholderTextColor={Colors.textTertiary}
            keyboardType="numbers-and-punctuation"
            autoCapitalize="none"
            testID="input-dob"
          />
          {dateOfBirth.length > 0 && !isValidIsoDate(dateOfBirth.trim()) && (
            <Text style={styles.fieldError}>Enter a valid date as YYYY-MM-DD.</Text>
          )}
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Sex</Text>
          <View style={styles.sexRow}>
            {SEX_OPTIONS.map((option) => {
              const active = sex === option.value;
              return (
                <TouchableOpacity
                  key={option.value}
                  style={[styles.sexChip, active && styles.sexChipActive]}
                  onPress={() => setSex(option.value)}
                  accessibilityRole="button"
                  accessibilityLabel={option.label}
                  testID={`sex-${option.value}`}
                >
                  <Text style={[styles.sexChipText, active && styles.sexChipTextActive]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Email (optional)</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="jane@example.com"
            placeholderTextColor={Colors.textTertiary}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            testID="input-email"
          />
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}>
        <TouchableOpacity
          style={[styles.submitButton, (!isValid || createMutation.isPending) && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={!isValid || createMutation.isPending}
          activeOpacity={0.85}
          testID="submit-new-patient"
        >
          {createMutation.isPending ? (
            <ActivityIndicator color={Colors.textInverse} />
          ) : (
            <>
              <Text style={styles.submitText}>Add Patient</Text>
              <ChevronRight size={18} color={Colors.textInverse} />
            </>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
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
  },
  headerSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 19,
  },
  field: {
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
  input: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 15,
    color: Colors.text,
  },
  fieldError: {
    fontSize: 12,
    color: Colors.danger,
    marginTop: 6,
  },
  sexRow: {
    flexDirection: 'row',
    gap: 8,
  },
  sexChip: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  sexChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  sexChipText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  sexChipTextActive: {
    color: Colors.textInverse,
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
