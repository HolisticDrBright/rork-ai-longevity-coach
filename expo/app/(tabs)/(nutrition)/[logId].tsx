import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Linking,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Trash2, AlertTriangle, CheckCircle, Lightbulb, ExternalLink, Flame, Beef, Wheat, Droplets } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Colors from '@/constants/colors';
import { useNutrition } from '@/providers/NutritionProvider';
import { FoodLogItem, TherapeuticDiet } from '@/types';
import { dietDescriptions, swapSuggestions } from '@/mocks/foodRules';

const FULLSCRIPT_URL = 'https://us.fullscript.com/welcome/drbright/signup';

const MEAL_TYPE_LABELS: Record<string, string> = {
  breakfast: '🌅 Breakfast',
  lunch: '☀️ Lunch',
  dinner: '🌙 Dinner',
  snack: '🍎 Snack',
};

export default function MealDetail() {
  const { logId } = useLocalSearchParams<{ logId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { getLogById, deleteFoodLog, dietProfile } = useNutrition();

  const log = getLogById(logId);

  const handleDelete = () => {
    Alert.alert(
      'Delete Meal',
      'Are you sure you want to delete this meal log?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteFoodLog(logId);
            router.back();
          },
        },
      ]
    );
  };

  const getComplianceColor = (score: number) => {
    if (score >= 80) return Colors.success;
    if (score >= 50) return Colors.warning;
    return Colors.danger;
  };

  const formatViolation = (violation: string): string => {
    return violation
      .replace(/_/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase());
  };

  if (!log) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Meal Details' }} />
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>Meal not found</Text>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const activeDiets = dietProfile.activeDiets || [];
  const date = new Date(log.createdAt);
  const formattedDate = date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const formattedTime = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Meal Details',
          headerRight: () => (
            <TouchableOpacity onPress={handleDelete} style={styles.headerButton}>
              <Trash2 size={22} color={Colors.danger} />
            </TouchableOpacity>
          ),
        }}
      />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.mealType}>{MEAL_TYPE_LABELS[log.mealType] || log.mealType}</Text>
          <Text style={styles.dateTime}>{formattedDate} at {formattedTime}</Text>
        </View>

        <View style={styles.totalsCard}>
          <View style={styles.calorieRow}>
            <Flame size={28} color={Colors.accent} />
            <View style={styles.calorieInfo}>
              <Text style={styles.calorieValue}>{log.totals?.calories || 0}</Text>
              <Text style={styles.calorieLabel}>calories</Text>
            </View>
          </View>

          <View style={styles.macrosGrid}>
            <View style={styles.macroItem}>
              <Beef size={18} color={Colors.coral} />
              <Text style={styles.macroValue}>{log.totals?.protein_g || 0}g</Text>
              <Text style={styles.macroLabel}>Protein</Text>
            </View>
            <View style={styles.macroItem}>
              <Wheat size={18} color={Colors.chartOrange} />
              <Text style={styles.macroValue}>{log.totals?.carbs_g || 0}g</Text>
              <Text style={styles.macroLabel}>Carbs</Text>
            </View>
            <View style={styles.macroItem}>
              <Droplets size={18} color={Colors.chartBlue} />
              <Text style={styles.macroValue}>{log.totals?.fat_g || 0}g</Text>
              <Text style={styles.macroLabel}>Fat</Text>
            </View>
          </View>

          <View style={styles.microRow}>
            <Text style={styles.microText}>Fiber: {log.totals?.fiber_g || 0}g</Text>
            <Text style={styles.microDivider}>•</Text>
            <Text style={styles.microText}>Sugar: {log.totals?.sugar_g || 0}g</Text>
            <Text style={styles.microDivider}>•</Text>
            <Text style={styles.microText}>Sodium: {log.totals?.sodium_mg || 0}mg</Text>
          </View>
        </View>

        {activeDiets.length > 0 && log.compliance && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Diet Compliance</Text>
            <View style={styles.complianceList}>
              {activeDiets.map((diet) => {
                const compliance = log.compliance[diet];
                if (!compliance) return null;

                const color = getComplianceColor(compliance.score);
                const dietInfo = dietDescriptions[diet];

                return (
                  <View key={diet} style={styles.complianceCard}>
                    <View style={styles.complianceHeader}>
                      <View style={styles.complianceLeft}>
                        {compliance.score >= 80 ? (
                          <CheckCircle size={20} color={color} />
                        ) : (
                          <AlertTriangle size={20} color={color} />
                        )}
                        <Text style={styles.complianceName}>{dietInfo?.name || diet}</Text>
                      </View>
                      <View style={[styles.scoreCircle, { backgroundColor: color + '20', borderColor: color }]}>
                        <Text style={[styles.scoreText, { color }]}>{compliance.score}</Text>
                      </View>
                    </View>

                    {compliance.violations.length > 0 && (
                      <View style={styles.violationsContainer}>
                        <Text style={styles.violationsLabel}>Violations:</Text>
                        <View style={styles.tagsList}>
                          {compliance.violations.map((v, i) => (
                            <View key={i} style={[styles.tag, styles.violationTag]}>
                              <Text style={styles.violationTagText}>{formatViolation(v)}</Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    )}

                    {compliance.cautions.length > 0 && (
                      <View style={styles.cautionsContainer}>
                        <Text style={styles.cautionsLabel}>Cautions:</Text>
                        <View style={styles.tagsList}>
                          {compliance.cautions.map((c, i) => (
                            <View key={i} style={[styles.tag, styles.cautionTag]}>
                              <Text style={styles.cautionTagText}>{formatViolation(c)}</Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {log.suggestions && log.suggestions.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Lightbulb size={20} color={Colors.chartOrange} />
              <Text style={styles.sectionTitle}>Swap Suggestions</Text>
            </View>
            <View style={styles.suggestionsList}>
              {log.suggestions.map((suggestion, index) => (
                <View key={index} style={styles.suggestionCard}>
                  <Text style={styles.suggestionText}>{suggestion}</Text>
                </View>
              ))}
            </View>
            <TouchableOpacity
              style={styles.fullscriptButton}
              onPress={() => Linking.openURL(FULLSCRIPT_URL)}
              activeOpacity={0.7}
            >
              <Text style={styles.fullscriptButtonText}>Browse Supplements on Fullscript</Text>
              <ExternalLink size={16} color={Colors.primary} />
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Food Items</Text>
          <View style={styles.itemsList}>
            {log.items?.map((item: FoodLogItem, index: number) => (
              <View key={item.id || index} style={styles.foodItemCard}>
                <View style={styles.foodItemHeader}>
                  <Text style={styles.foodItemName}>{item.name}</Text>
                  <Text style={styles.foodItemCalories}>{item.calories} cal</Text>
                </View>
                <Text style={styles.foodItemPortion}>
                  {item.portionQty} {item.portionUnit}
                </Text>
                <View style={styles.foodItemMacros}>
                  <Text style={styles.foodItemMacro}>P: {item.protein_g}g</Text>
                  <Text style={styles.foodItemMacro}>C: {item.carbs_g}g</Text>
                  <Text style={styles.foodItemMacro}>F: {item.fat_g}g</Text>
                </View>
                {item.tags && item.tags.length > 0 && (
                  <View style={styles.foodItemTags}>
                    {item.tags.slice(0, 4).map((tag, i) => (
                      <View key={i} style={styles.foodTag}>
                        <Text style={styles.foodTagText}>{formatViolation(tag)}</Text>
                      </View>
                    ))}
                    {item.tags.length > 4 && (
                      <Text style={styles.moreTags}>+{item.tags.length - 4}</Text>
                    )}
                  </View>
                )}
              </View>
            ))}
          </View>
        </View>
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
  headerButton: {
    padding: 8,
  },
  header: {
    marginBottom: 20,
  },
  mealType: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 4,
  },
  dateTime: {
    fontSize: 15,
    color: Colors.textSecondary,
  },
  totalsCard: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 20,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  calorieRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  calorieInfo: {
    marginLeft: 14,
  },
  calorieValue: {
    fontSize: 36,
    fontWeight: '700' as const,
    color: Colors.text,
    lineHeight: 40,
  },
  calorieLabel: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  macrosGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 16,
  },
  macroItem: {
    alignItems: 'center',
  },
  macroValue: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
    marginTop: 6,
  },
  macroLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  microRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  microText: {
    fontSize: 12,
    color: Colors.textTertiary,
  },
  microDivider: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginHorizontal: 8,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 12,
  },
  complianceList: {
    gap: 12,
  },
  complianceCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  complianceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  complianceLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  complianceName: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  scoreCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
  },
  scoreText: {
    fontSize: 14,
    fontWeight: '700' as const,
  },
  violationsContainer: {
    marginBottom: 8,
  },
  violationsLabel: {
    fontSize: 12,
    fontWeight: '500' as const,
    color: Colors.danger,
    marginBottom: 6,
  },
  tagsList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  violationTag: {
    backgroundColor: Colors.danger + '15',
  },
  violationTagText: {
    fontSize: 12,
    color: Colors.danger,
    fontWeight: '500' as const,
  },
  cautionsContainer: {
    marginTop: 4,
  },
  cautionsLabel: {
    fontSize: 12,
    fontWeight: '500' as const,
    color: Colors.warning,
    marginBottom: 6,
  },
  cautionTag: {
    backgroundColor: Colors.warning + '15',
  },
  cautionTagText: {
    fontSize: 12,
    color: Colors.warning,
    fontWeight: '500' as const,
  },
  suggestionsList: {
    gap: 10,
    marginBottom: 12,
  },
  suggestionCard: {
    backgroundColor: Colors.chartOrange + '10',
    borderRadius: 12,
    padding: 14,
    borderLeftWidth: 3,
    borderLeftColor: Colors.chartOrange,
  },
  suggestionText: {
    fontSize: 14,
    color: Colors.text,
    lineHeight: 20,
  },
  fullscriptButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary + '10',
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  fullscriptButtonText: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.primary,
  },
  itemsList: {
    gap: 10,
  },
  foodItemCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  foodItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  foodItemName: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
    flex: 1,
    marginRight: 8,
  },
  foodItemCalories: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.accent,
  },
  foodItemPortion: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 8,
  },
  foodItemMacros: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 8,
  },
  foodItemMacro: {
    fontSize: 12,
    color: Colors.textTertiary,
    fontWeight: '500' as const,
  },
  foodItemTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
  },
  foodTag: {
    backgroundColor: Colors.surfaceSecondary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  foodTagText: {
    fontSize: 10,
    color: Colors.textSecondary,
  },
  moreTags: {
    fontSize: 11,
    color: Colors.textTertiary,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    fontSize: 16,
    color: Colors.textSecondary,
    marginBottom: 24,
  },
  backButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: Colors.primary,
    borderRadius: 12,
  },
  backButtonText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.textInverse,
  },
});
