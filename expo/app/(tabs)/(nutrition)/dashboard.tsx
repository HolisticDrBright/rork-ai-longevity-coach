import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Plus, Settings, TrendingUp, Flame, Beef, Wheat, Droplets, ChevronRight, AlertTriangle, CheckCircle } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Colors from '@/constants/colors';
import { useNutrition } from '@/providers/NutritionProvider';
import { FoodLog, TherapeuticDiet } from '@/types';
import { dietDescriptions } from '@/mocks/foodRules';

const MEAL_TYPE_LABELS: Record<string, string> = {
  breakfast: '🌅 Breakfast',
  lunch: '☀️ Lunch',
  dinner: '🌙 Dinner',
  snack: '🍎 Snack',
};

export default function NutritionDashboard() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    todaySummary,
    dietProfile,
    getRecentLogs,
    isLoading: _isLoading,
  } = useNutrition();

  const recentLogs = getRecentLogs(5);
  const activeDiets = dietProfile.activeDiets || [];

  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  }, []);

  const getComplianceColor = (score: number) => {
    if (score >= 80) return Colors.success;
    if (score >= 50) return Colors.warning;
    return Colors.danger;
  };

  const renderMacroCard = (
    icon: React.ReactNode,
    label: string,
    value: number,
    unit: string,
    color: string
  ) => (
    <View style={[styles.macroCard, { borderLeftColor: color }]}>
      <View style={[styles.macroIconContainer, { backgroundColor: color + '15' }]}>
        {icon}
      </View>
      <Text style={styles.macroValue}>{value}</Text>
      <Text style={styles.macroLabel}>{label}</Text>
      <Text style={styles.macroUnit}>{unit}</Text>
    </View>
  );

  const renderComplianceBadge = (diet: TherapeuticDiet) => {
    const compliance = todaySummary.overallCompliance[diet];
    const score = compliance?.score ?? 100;
    const color = getComplianceColor(score);
    const dietInfo = dietDescriptions[diet];

    return (
      <TouchableOpacity
        key={diet}
        style={styles.complianceBadge}
        onPress={() => router.push('/(tabs)/(nutrition)/settings' as any)}
        activeOpacity={0.7}
      >
        <View style={styles.complianceHeader}>
          <Text style={styles.complianceName}>{dietInfo?.name || diet}</Text>
          <View style={[styles.scoreCircle, { backgroundColor: color + '20', borderColor: color }]}>
            <Text style={[styles.scoreText, { color }]}>{score}</Text>
          </View>
        </View>
        {compliance?.violations && compliance.violations.length > 0 && (
          <View style={styles.violationsRow}>
            <AlertTriangle size={12} color={Colors.danger} />
            <Text style={styles.violationsText} numberOfLines={1}>
              {compliance.violations.slice(0, 2).join(', ')}
              {compliance.violations.length > 2 ? ` +${compliance.violations.length - 2}` : ''}
            </Text>
          </View>
        )}
        {(!compliance?.violations || compliance.violations.length === 0) && (
          <View style={styles.violationsRow}>
            <CheckCircle size={12} color={Colors.success} />
            <Text style={[styles.violationsText, { color: Colors.success }]}>On track!</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const renderRecentLog = (log: FoodLog) => {
    const time = new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const itemCount = log.items?.length || 0;

    return (
      <TouchableOpacity
        key={log.id}
        style={styles.logCard}
        onPress={() => router.push(`/(tabs)/(nutrition)/${log.id}` as any)}
        activeOpacity={0.7}
      >
        <View style={styles.logLeft}>
          <Text style={styles.logMealType}>{MEAL_TYPE_LABELS[log.mealType] || log.mealType}</Text>
          <Text style={styles.logTime}>{time} • {itemCount} item{itemCount !== 1 ? 's' : ''}</Text>
        </View>
        <View style={styles.logRight}>
          <Text style={styles.logCalories}>{log.totals?.calories || 0}</Text>
          <Text style={styles.logCaloriesLabel}>cal</Text>
        </View>
        <ChevronRight size={20} color={Colors.textTertiary} />
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Today's Nutrition</Text>
            <Text style={styles.date}>
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.settingsButton}
            onPress={() => router.push('/(tabs)/(nutrition)/settings' as any)}
          >
            <Settings size={22} color={Colors.primary} />
          </TouchableOpacity>
        </View>

        <View style={styles.calorieCard}>
          <View style={styles.calorieMain}>
            <Flame size={32} color={Colors.accent} />
            <View style={styles.calorieInfo}>
              <Text style={styles.calorieValue}>{todaySummary.totalCalories}</Text>
              <Text style={styles.calorieLabel}>calories consumed</Text>
            </View>
          </View>
          <Text style={styles.mealsLogged}>
            {todaySummary.mealsLogged} meal{todaySummary.mealsLogged !== 1 ? 's' : ''} logged today
          </Text>
        </View>

        <View style={styles.macrosRow}>
          {renderMacroCard(
            <Beef size={18} color={Colors.coral} />,
            'Protein',
            todaySummary.totalProtein,
            'g',
            Colors.coral
          )}
          {renderMacroCard(
            <Wheat size={18} color={Colors.chartOrange} />,
            'Carbs',
            todaySummary.totalCarbs,
            'g',
            Colors.chartOrange
          )}
          {renderMacroCard(
            <Droplets size={18} color={Colors.chartBlue} />,
            'Fat',
            todaySummary.totalFat,
            'g',
            Colors.chartBlue
          )}
        </View>

        {activeDiets.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Diet Compliance</Text>
              <TrendingUp size={18} color={Colors.textTertiary} />
            </View>
            <View style={styles.complianceGrid}>
              {activeDiets.map(renderComplianceBadge)}
            </View>
          </View>
        )}

        {activeDiets.length === 0 && (
          <TouchableOpacity
            style={styles.setupDietCard}
            onPress={() => router.push('/(tabs)/(nutrition)/settings' as any)}
            activeOpacity={0.8}
          >
            <Settings size={24} color={Colors.primary} />
            <View style={styles.setupDietText}>
              <Text style={styles.setupDietTitle}>Set Up Your Diet Plan</Text>
              <Text style={styles.setupDietSubtitle}>
                Enable AIP, Low FODMAP, Keto, or Low Histamine tracking
              </Text>
            </View>
            <ChevronRight size={20} color={Colors.primary} />
          </TouchableOpacity>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Meals</Text>
          {recentLogs.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No meals logged yet</Text>
              <Text style={styles.emptySubtext}>Tap the button below to log your first meal</Text>
            </View>
          ) : (
            <View style={styles.logsContainer}>
              {recentLogs.map(renderRecentLog)}
            </View>
          )}
        </View>
      </ScrollView>

      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 90 }]}
        onPress={() => router.push('/(tabs)/(nutrition)/new' as any)}
        activeOpacity={0.9}
      >
        <Plus size={28} color={Colors.textInverse} />
        <Text style={styles.fabText}>Log Meal</Text>
      </TouchableOpacity>
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 24,
  },
  greeting: {
    fontSize: 28,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 4,
  },
  date: {
    fontSize: 15,
    color: Colors.textSecondary,
  },
  settingsButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  calorieCard: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  calorieMain: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  calorieInfo: {
    marginLeft: 16,
  },
  calorieValue: {
    fontSize: 42,
    fontWeight: '700' as const,
    color: Colors.text,
    lineHeight: 48,
  },
  calorieLabel: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  mealsLogged: {
    fontSize: 13,
    color: Colors.textTertiary,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  macrosRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  macroCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 14,
    borderLeftWidth: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  macroIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  macroValue: {
    fontSize: 22,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  macroLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  macroUnit: {
    fontSize: 11,
    color: Colors.textTertiary,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  complianceGrid: {
    gap: 12,
  },
  complianceBadge: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
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
    marginBottom: 8,
  },
  complianceName: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
    flex: 1,
  },
  scoreCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
  },
  scoreText: {
    fontSize: 14,
    fontWeight: '700' as const,
  },
  violationsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  violationsText: {
    fontSize: 12,
    color: Colors.textSecondary,
    flex: 1,
  },
  setupDietCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primaryLight + '10',
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: Colors.primary + '30',
    borderStyle: 'dashed',
  },
  setupDietText: {
    flex: 1,
    marginLeft: 14,
  },
  setupDietTitle: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.primary,
    marginBottom: 2,
  },
  setupDietSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  logsContainer: {
    gap: 10,
  },
  logCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  logLeft: {
    flex: 1,
  },
  logMealType: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 2,
  },
  logTime: {
    fontSize: 13,
    color: Colors.textTertiary,
  },
  logRight: {
    alignItems: 'flex-end',
    marginRight: 12,
  },
  logCalories: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  logCaloriesLabel: {
    fontSize: 11,
    color: Colors.textTertiary,
  },
  emptyState: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  emptySubtext: {
    fontSize: 14,
    color: Colors.textTertiary,
    textAlign: 'center',
  },
  fab: {
    position: 'absolute',
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 28,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  fabText: {
    color: Colors.textInverse,
    fontSize: 16,
    fontWeight: '600' as const,
    marginLeft: 8,
  },
});
