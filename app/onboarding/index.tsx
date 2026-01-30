import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronRight, User, Target, Heart } from 'lucide-react-native';

import Colors from '@/constants/colors';
import { useUser } from '@/providers/UserProvider';
import { healthGoals } from '@/mocks/questionnaire';

export default function OnboardingProfileScreen() {
  const { userProfile, updateUserProfile } = useUser();
  const [firstName, setFirstName] = useState(userProfile.firstName);
  const [lastName, setLastName] = useState(userProfile.lastName);
  const [email, setEmail] = useState(userProfile.email);
  const [dateOfBirth, setDateOfBirth] = useState(userProfile.dateOfBirth);
  const [sex, setSex] = useState<'male' | 'female' | 'other'>(userProfile.sex);
  const [height, setHeight] = useState(userProfile.height ? String(userProfile.height) : '');
  const [weight, setWeight] = useState(userProfile.weight ? String(userProfile.weight) : '');
  const [selectedGoals, setSelectedGoals] = useState<string[]>(userProfile.goals);

  const toggleGoal = (goal: string) => {
    setSelectedGoals(prev =>
      prev.includes(goal) ? prev.filter(g => g !== goal) : [...prev, goal]
    );
  };

  const handleContinue = () => {
    updateUserProfile({
      firstName,
      lastName,
      email,
      dateOfBirth,
      sex,
      height: parseFloat(height) || 0,
      weight: parseFloat(weight) || 0,
      goals: selectedGoals,
    });
    router.push('/onboarding/lifestyle');
  };

  const isValid = firstName && lastName && email && selectedGoals.length > 0;

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[Colors.primary, Colors.primaryLight]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={['top']}>
          <View style={styles.header}>
            <View style={styles.iconContainer}>
              <User color={Colors.textInverse} size={28} />
            </View>
            <Text style={styles.headerTitle}>Your Profile</Text>
            <Text style={styles.headerSubtitle}>
              Let's personalize your health journey
            </Text>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Basic Information</Text>
            <View style={styles.row}>
              <View style={styles.inputHalf}>
                <Text style={styles.label}>First Name</Text>
                <TextInput
                  style={styles.input}
                  value={firstName}
                  onChangeText={setFirstName}
                  placeholder="John"
                  placeholderTextColor={Colors.textTertiary}
                />
              </View>
              <View style={styles.inputHalf}>
                <Text style={styles.label}>Last Name</Text>
                <TextInput
                  style={styles.input}
                  value={lastName}
                  onChangeText={setLastName}
                  placeholder="Doe"
                  placeholderTextColor={Colors.textTertiary}
                />
              </View>
            </View>

            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="john@example.com"
              placeholderTextColor={Colors.textTertiary}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <Text style={styles.label}>Date of Birth</Text>
            <TextInput
              style={styles.input}
              value={dateOfBirth}
              onChangeText={setDateOfBirth}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={Colors.textTertiary}
            />

            <Text style={styles.label}>Sex</Text>
            <View style={styles.sexRow}>
              {(['male', 'female', 'other'] as const).map(option => (
                <TouchableOpacity
                  key={option}
                  style={[styles.sexOption, sex === option && styles.sexOptionActive]}
                  onPress={() => setSex(option)}
                >
                  <Text
                    style={[styles.sexText, sex === option && styles.sexTextActive]}
                  >
                    {option.charAt(0).toUpperCase() + option.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.row}>
              <View style={styles.inputHalf}>
                <Text style={styles.label}>Height (in)</Text>
                <TextInput
                  style={styles.input}
                  value={height}
                  onChangeText={setHeight}
                  placeholder="70"
                  placeholderTextColor={Colors.textTertiary}
                  keyboardType="numeric"
                />
              </View>
              <View style={styles.inputHalf}>
                <Text style={styles.label}>Weight (lbs)</Text>
                <TextInput
                  style={styles.input}
                  value={weight}
                  onChangeText={setWeight}
                  placeholder="175"
                  placeholderTextColor={Colors.textTertiary}
                  keyboardType="numeric"
                />
              </View>
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Target color={Colors.primary} size={20} />
              <Text style={styles.sectionTitle}>Health Goals</Text>
            </View>
            <Text style={styles.sectionSubtitle}>
              Select all that apply to you
            </Text>
            <View style={styles.goalsGrid}>
              {healthGoals.map(goal => (
                <TouchableOpacity
                  key={goal}
                  style={[
                    styles.goalChip,
                    selectedGoals.includes(goal) && styles.goalChipActive,
                  ]}
                  onPress={() => toggleGoal(goal)}
                >
                  <Text
                    style={[
                      styles.goalText,
                      selectedGoals.includes(goal) && styles.goalTextActive,
                    ]}
                  >
                    {goal}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.disclaimer}>
            <Heart color={Colors.coral} size={16} />
            <Text style={styles.disclaimerText}>
              This app provides educational information only and is not a substitute
              for professional medical advice.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <TouchableOpacity
          style={[styles.continueButton, !isValid && styles.continueButtonDisabled]}
          onPress={handleContinue}
          disabled={!isValid}
        >
          <Text style={styles.continueText}>Continue</Text>
          <ChevronRight color={Colors.textInverse} size={20} />
        </TouchableOpacity>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  headerGradient: {
    paddingBottom: 24,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  iconContainer: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700' as const,
    color: Colors.textInverse,
    marginBottom: 8,
  },
  headerSubtitle: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.8)',
  },
  keyboardView: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 100,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 16,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  inputHalf: {
    flex: 1,
  },
  label: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
    marginBottom: 8,
  },
  input: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: Colors.text,
    marginBottom: 16,
  },
  sexRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  sexOption: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  sexOptionActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  sexText: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
  },
  sexTextActive: {
    color: Colors.textInverse,
  },
  goalsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  goalChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  goalChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  goalText: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  goalTextActive: {
    color: Colors.textInverse,
    fontWeight: '500' as const,
  },
  disclaimer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: Colors.surfaceSecondary,
    padding: 16,
    borderRadius: 12,
  },
  disclaimerText: {
    flex: 1,
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.background,
    paddingHorizontal: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  continueButton: {
    backgroundColor: Colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 14,
    gap: 8,
  },
  continueButtonDisabled: {
    opacity: 0.5,
  },
  continueText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.textInverse,
  },
});
