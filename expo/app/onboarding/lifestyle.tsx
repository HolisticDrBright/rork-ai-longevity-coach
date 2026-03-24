import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronRight, ChevronLeft, Dumbbell, Moon, Utensils } from 'lucide-react-native';
import Slider from '@react-native-community/slider';

import Colors from '@/constants/colors';
import { useUser } from '@/providers/UserProvider';
import { exerciseTypes } from '@/mocks/questionnaire';

const dietTypes = [
  { id: 'omnivore', label: 'Omnivore' },
  { id: 'vegetarian', label: 'Vegetarian' },
  { id: 'vegan', label: 'Vegan' },
  { id: 'keto', label: 'Keto' },
  { id: 'paleo', label: 'Paleo' },
  { id: 'mediterranean', label: 'Mediterranean' },
];

const cookingSkills = [
  { id: 'none', label: 'None' },
  { id: 'basic', label: 'Basic' },
  { id: 'intermediate', label: 'Intermediate' },
  { id: 'advanced', label: 'Advanced' },
];

export default function OnboardingLifestyleScreen() {
  const { lifestyleProfile, updateLifestyleProfile } = useUser();
  const [sleepHours, setSleepHours] = useState(lifestyleProfile.sleepHours);
  const [sleepQuality, setSleepQuality] = useState(lifestyleProfile.sleepQuality);
  const [stressLevel, setStressLevel] = useState(lifestyleProfile.stressLevel);
  const [dietType, setDietType] = useState(lifestyleProfile.dietType);
  const [cookingSkill, setCookingSkill] = useState(lifestyleProfile.cookingSkill);
  const [exerciseFrequency, setExerciseFrequency] = useState(lifestyleProfile.exerciseFrequency);
  const [selectedExercises, setSelectedExercises] = useState<string[]>(lifestyleProfile.exerciseTypes);

  const toggleExercise = (exercise: string) => {
    setSelectedExercises(prev =>
      prev.includes(exercise) ? prev.filter(e => e !== exercise) : [...prev, exercise]
    );
  };

  const handleContinue = () => {
    updateLifestyleProfile({
      sleepHours,
      sleepQuality,
      stressLevel,
      dietType: dietType as any,
      cookingSkill: cookingSkill as any,
      exerciseFrequency,
      exerciseTypes: selectedExercises,
    });
    router.push('/onboarding/questionnaire');
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[Colors.secondary, Colors.primaryLight]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => router.back()}
            >
              <ChevronLeft color={Colors.textInverse} size={24} />
            </TouchableOpacity>
            <View style={styles.iconContainer}>
              <Dumbbell color={Colors.textInverse} size={28} />
            </View>
            <Text style={styles.headerTitle}>Lifestyle</Text>
            <Text style={styles.headerSubtitle}>
              Tell us about your daily habits
            </Text>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Moon color={Colors.primary} size={20} />
            <Text style={styles.sectionTitle}>Sleep</Text>
          </View>

          <View style={styles.sliderContainer}>
            <View style={styles.sliderHeader}>
              <Text style={styles.sliderLabel}>Average sleep hours</Text>
              <Text style={styles.sliderValue}>{sleepHours}h</Text>
            </View>
            <Slider
              style={styles.slider}
              minimumValue={4}
              maximumValue={10}
              step={0.5}
              value={sleepHours}
              onValueChange={setSleepHours}
              minimumTrackTintColor={Colors.primary}
              maximumTrackTintColor={Colors.border}
              thumbTintColor={Colors.primary}
            />
          </View>

          <View style={styles.sliderContainer}>
            <View style={styles.sliderHeader}>
              <Text style={styles.sliderLabel}>Sleep quality</Text>
              <Text style={styles.sliderValue}>{sleepQuality}/10</Text>
            </View>
            <Slider
              style={styles.slider}
              minimumValue={1}
              maximumValue={10}
              step={1}
              value={sleepQuality}
              onValueChange={setSleepQuality}
              minimumTrackTintColor={Colors.primary}
              maximumTrackTintColor={Colors.border}
              thumbTintColor={Colors.primary}
            />
          </View>

          <View style={styles.sliderContainer}>
            <View style={styles.sliderHeader}>
              <Text style={styles.sliderLabel}>Stress level</Text>
              <Text style={styles.sliderValue}>{stressLevel}/10</Text>
            </View>
            <Slider
              style={styles.slider}
              minimumValue={1}
              maximumValue={10}
              step={1}
              value={stressLevel}
              onValueChange={setStressLevel}
              minimumTrackTintColor={Colors.coral}
              maximumTrackTintColor={Colors.border}
              thumbTintColor={Colors.coral}
            />
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Utensils color={Colors.primary} size={20} />
            <Text style={styles.sectionTitle}>Nutrition</Text>
          </View>

          <Text style={styles.label}>Diet Type</Text>
          <View style={styles.optionsGrid}>
            {dietTypes.map(diet => (
              <TouchableOpacity
                key={diet.id}
                style={[
                  styles.optionChip,
                  dietType === diet.id && styles.optionChipActive,
                ]}
                onPress={() => setDietType(diet.id as any)}
              >
                <Text
                  style={[
                    styles.optionText,
                    dietType === diet.id && styles.optionTextActive,
                  ]}
                >
                  {diet.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Cooking Skill</Text>
          <View style={styles.optionsRow}>
            {cookingSkills.map(skill => (
              <TouchableOpacity
                key={skill.id}
                style={[
                  styles.skillChip,
                  cookingSkill === skill.id && styles.optionChipActive,
                ]}
                onPress={() => setCookingSkill(skill.id as any)}
              >
                <Text
                  style={[
                    styles.optionText,
                    cookingSkill === skill.id && styles.optionTextActive,
                  ]}
                >
                  {skill.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Dumbbell color={Colors.primary} size={20} />
            <Text style={styles.sectionTitle}>Exercise</Text>
          </View>

          <View style={styles.sliderContainer}>
            <View style={styles.sliderHeader}>
              <Text style={styles.sliderLabel}>Workouts per week</Text>
              <Text style={styles.sliderValue}>{exerciseFrequency}x</Text>
            </View>
            <Slider
              style={styles.slider}
              minimumValue={0}
              maximumValue={7}
              step={1}
              value={exerciseFrequency}
              onValueChange={setExerciseFrequency}
              minimumTrackTintColor={Colors.success}
              maximumTrackTintColor={Colors.border}
              thumbTintColor={Colors.success}
            />
          </View>

          <Text style={styles.label}>Exercise Types</Text>
          <View style={styles.optionsGrid}>
            {exerciseTypes.map(exercise => (
              <TouchableOpacity
                key={exercise}
                style={[
                  styles.optionChip,
                  selectedExercises.includes(exercise) && styles.optionChipActive,
                ]}
                onPress={() => toggleExercise(exercise)}
              >
                <Text
                  style={[
                    styles.optionText,
                    selectedExercises.includes(exercise) && styles.optionTextActive,
                  ]}
                >
                  {exercise}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <TouchableOpacity style={styles.continueButton} onPress={handleContinue}>
          <Text style={styles.continueText}>Continue to Questionnaire</Text>
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
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 120,
  },
  section: {
    marginBottom: 28,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  sliderContainer: {
    marginBottom: 20,
  },
  sliderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sliderLabel: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  sliderValue: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  slider: {
    width: '100%',
    height: 40,
  },
  label: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
    marginBottom: 12,
  },
  optionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20,
  },
  optionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  optionChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  skillChip: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  optionChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  optionText: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  optionTextActive: {
    color: Colors.textInverse,
    fontWeight: '500' as const,
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
  continueText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.textInverse,
  },
});
