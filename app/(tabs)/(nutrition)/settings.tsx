import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Switch,
  Alert,
} from 'react-native';
import { Stack } from 'expo-router';
import { Check, Info, Leaf, Wheat, Flame, AlertCircle } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Colors from '@/constants/colors';
import { useNutrition } from '@/providers/NutritionProvider';
import { TherapeuticDiet } from '@/types';
import { dietDescriptions } from '@/mocks/foodRules';

const DIET_ICONS: Record<TherapeuticDiet, React.ReactNode> = {
  AIP: <Leaf size={22} color={Colors.success} />,
  LOW_FODMAP: <Wheat size={22} color={Colors.chartOrange} />,
  KETO: <Flame size={22} color={Colors.coral} />,
  LOW_HISTAMINE: <AlertCircle size={22} color={Colors.chartPurple} />,
};

const DIET_COLORS: Record<TherapeuticDiet, string> = {
  AIP: Colors.success,
  LOW_FODMAP: Colors.chartOrange,
  KETO: Colors.coral,
  LOW_HISTAMINE: Colors.chartPurple,
};

export default function DietSettings() {
  const insets = useSafeAreaInsets();
  const { dietProfile, updateDietProfile, toggleDiet } = useNutrition();
  
  const [allergies, setAllergies] = useState(dietProfile.allergies || '');
  const [notes, setNotes] = useState(dietProfile.notes || '');
  const [expandedDiet, setExpandedDiet] = useState<TherapeuticDiet | null>(null);

  const activeDiets = dietProfile.activeDiets || [];

  const handleSave = () => {
    updateDietProfile({
      allergies,
      notes,
    });
    Alert.alert('Saved', 'Your diet preferences have been updated.');
  };

  const handleToggleDiet = (diet: TherapeuticDiet) => {
    toggleDiet(diet);
  };

  const renderDietCard = (diet: TherapeuticDiet) => {
    const isActive = activeDiets.includes(diet);
    const info = dietDescriptions[diet];
    const isExpanded = expandedDiet === diet;
    const color = DIET_COLORS[diet];

    return (
      <View key={diet} style={styles.dietCardContainer}>
        <TouchableOpacity
          style={[
            styles.dietCard,
            isActive && { borderColor: color, borderWidth: 2 },
          ]}
          onPress={() => setExpandedDiet(isExpanded ? null : diet)}
          activeOpacity={0.8}
        >
          <View style={[styles.dietIconContainer, { backgroundColor: color + '15' }]}>
            {DIET_ICONS[diet]}
          </View>
          <View style={styles.dietInfo}>
            <Text style={styles.dietName}>{info?.name || diet}</Text>
            <Text style={styles.dietDescription} numberOfLines={isExpanded ? undefined : 1}>
              {info?.description || ''}
            </Text>
          </View>
          <Switch
            value={isActive}
            onValueChange={() => handleToggleDiet(diet)}
            trackColor={{ false: Colors.borderLight, true: color + '60' }}
            thumbColor={isActive ? color : Colors.textTertiary}
          />
        </TouchableOpacity>

        {isExpanded && (
          <View style={[styles.dietExpanded, { borderLeftColor: color }]}>
            <Text style={styles.benefitsTitle}>Benefits:</Text>
            {info?.benefits?.map((benefit, index) => (
              <View key={index} style={styles.benefitRow}>
                <Check size={14} color={color} />
                <Text style={styles.benefitText}>{benefit}</Text>
              </View>
            ))}
            <TouchableOpacity
              style={styles.infoButton}
              onPress={() => {
                Alert.alert(
                  info?.name || diet,
                  `${info?.description}\n\nThis diet will track your meals and flag any foods that don't comply with the ${info?.name} guidelines.`
                );
              }}
            >
              <Info size={14} color={Colors.primary} />
              <Text style={styles.infoButtonText}>Learn more</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Diet Settings' }} />
      
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Therapeutic Diets</Text>
          <Text style={styles.sectionSubtitle}>
            Enable the diets you're following. We'll track compliance for each meal.
          </Text>
          
          <View style={styles.dietsContainer}>
            {(['AIP', 'LOW_FODMAP', 'KETO', 'LOW_HISTAMINE'] as TherapeuticDiet[]).map(renderDietCard)}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Allergies & Sensitivities</Text>
          <Text style={styles.sectionSubtitle}>
            List any food allergies or sensitivities (comma-separated)
          </Text>
          <TextInput
            style={styles.textInput}
            value={allergies}
            onChangeText={setAllergies}
            placeholder="e.g., shellfish, tree nuts, soy"
            placeholderTextColor={Colors.textTertiary}
            multiline
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Additional Notes</Text>
          <Text style={styles.sectionSubtitle}>
            Any other dietary preferences or restrictions
          </Text>
          <TextInput
            style={[styles.textInput, styles.notesInput]}
            value={notes}
            onChangeText={setNotes}
            placeholder="e.g., avoiding nightshades for inflammation"
            placeholderTextColor={Colors.textTertiary}
            multiline
            textAlignVertical="top"
          />
        </View>

        <TouchableOpacity style={styles.saveButton} onPress={handleSave} activeOpacity={0.8}>
          <Check size={20} color={Colors.textInverse} />
          <Text style={styles.saveButtonText}>Save Preferences</Text>
        </TouchableOpacity>

        {activeDiets.length > 0 && (
          <View style={styles.activeSection}>
            <Text style={styles.activeSectionTitle}>Active Diet Summary</Text>
            <Text style={styles.activeSectionText}>
              You're tracking: {activeDiets.map(d => dietDescriptions[d]?.name || d).join(', ')}
            </Text>
            <Text style={styles.activeSectionNote}>
              Foods violating these diets will be flagged when you log meals.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 20,
  },
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 16,
  },
  dietsContainer: {
    gap: 12,
  },
  dietCardContainer: {
    gap: 0,
  },
  dietCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  dietIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  dietInfo: {
    flex: 1,
    marginRight: 12,
  },
  dietName: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 2,
  },
  dietDescription: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  dietExpanded: {
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 12,
    padding: 14,
    marginTop: 8,
    marginLeft: 20,
    borderLeftWidth: 3,
  },
  benefitsTitle: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 8,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  benefitText: {
    fontSize: 13,
    color: Colors.textSecondary,
    flex: 1,
  },
  infoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  infoButtonText: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '500' as const,
  },
  textInput: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    minHeight: 50,
  },
  notesInput: {
    minHeight: 100,
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 14,
    padding: 16,
    gap: 8,
    marginBottom: 24,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.textInverse,
  },
  activeSection: {
    backgroundColor: Colors.primary + '10',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.primary + '30',
  },
  activeSectionTitle: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.primary,
    marginBottom: 6,
  },
  activeSectionText: {
    fontSize: 14,
    color: Colors.text,
    marginBottom: 4,
  },
  activeSectionNote: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
});
