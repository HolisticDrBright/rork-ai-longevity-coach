import { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Sun,
  Moon,
  Pill,
  Syringe,
  Clock,
  Dumbbell,
  Check,
  ChevronRight,
  TrendingUp,
  AlertTriangle,
} from 'lucide-react-native';

import Colors from '@/constants/colors';
import { useUser } from '@/providers/UserProvider';
import { useProtocol } from '@/providers/ProtocolProvider';
import { useLabs } from '@/providers/LabsProvider';
import { TodayAction } from '@/types';
import { CategoryScore } from '@/types';

const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
};

const getTimeIcon = () => {
  const hour = new Date().getHours();
  return hour >= 6 && hour < 18 ? Sun : Moon;
};

const getActionIcon = (type: TodayAction['type']) => {
  switch (type) {
    case 'supplement':
      return Pill;
    case 'peptide':
      return Syringe;
    case 'fasting':
      return Clock;
    case 'task':
      return Dumbbell;
    default:
      return Pill;
  }
};

export default function TodayScreen() {
  const { userProfile, questionnaireResponses, categoryScores, isLoading: userLoading } = useUser();
  const { todayActions, adherencePercentage, weeklyAdherenceStats, toggleActionComplete, isLoading: protocolLoading } = useProtocol();
  const { flaggedBiomarkers } = useLabs();

  const progressAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!userLoading && !userProfile.onboardingCompleted) {
      router.replace('/onboarding');
    }
  }, [userProfile.onboardingCompleted, userLoading]);

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: adherencePercentage,
      duration: 800,
      useNativeDriver: false,
    }).start();
  }, [adherencePercentage]);

  const handleToggleAction = async (action: TodayAction) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    toggleActionComplete(action);
  };

  if (userLoading || protocolLoading) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  const TimeIcon = getTimeIcon();
  const completedCount = todayActions.filter(a => a.completed).length;

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[Colors.primary, Colors.primaryLight]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={['top']}>
          <View style={styles.header}>
            <View style={styles.greetingRow}>
              <TimeIcon color={Colors.accent} size={24} />
              <Text style={styles.greeting}>{getGreeting()}</Text>
            </View>
            <Text style={styles.userName}>
              {userProfile.firstName || 'Welcome'}
            </Text>

            <View style={styles.progressCard}>
              <View style={styles.progressHeader}>
                <Text style={styles.progressLabel}>Today's Progress</Text>
                <Text style={styles.progressPercentage}>{adherencePercentage}%</Text>
              </View>
              <View style={styles.progressBarContainer}>
                <Animated.View
                  style={[styles.progressBarFill, { width: progressWidth }]}
                />
              </View>
              <Text style={styles.progressSubtext}>
                {completedCount} of {todayActions.length} actions completed
              </Text>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {questionnaireResponses.length > 0 && (
          <TouchableOpacity
            style={styles.insightsCard}
            onPress={() => router.push('/(tabs)/insights')}
          >
            <LinearGradient
              colors={['#1E3A5F', '#2D5A87']}
              style={styles.insightsGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              <View style={styles.insightsIconContainer}>
                <AlertTriangle color="#F59E0B" size={22} />
              </View>
              <View style={styles.insightsContent}>
                <Text style={styles.insightsTitle}>View Your Health Insights</Text>
                <Text style={styles.insightsSubtitle}>
                  See analysis for parasites, mold, heavy metals & more
                </Text>
              </View>
              <ChevronRight color={Colors.textInverse} size={22} />
            </LinearGradient>
          </TouchableOpacity>
        )}

        {flaggedBiomarkers.length > 0 && (
          <TouchableOpacity
            style={styles.alertCard}
            onPress={() => router.push('/(tabs)/labs')}
          >
            <View style={styles.alertIconContainer}>
              <AlertTriangle color={Colors.warning} size={20} />
            </View>
            <View style={styles.alertContent}>
              <Text style={styles.alertTitle}>
                {flaggedBiomarkers.length} markers need attention
              </Text>
              <Text style={styles.alertSubtitle}>
                Review your latest lab results
              </Text>
            </View>
            <ChevronRight color={Colors.textTertiary} size={20} />
          </TouchableOpacity>
        )}

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Today's Actions</Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/protocol')}>
              <Text style={styles.seeAllText}>See Protocol</Text>
            </TouchableOpacity>
          </View>

          {todayActions.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No active protocol</Text>
              <Text style={styles.emptySubtext}>
                Your practitioner will assign your protocol
              </Text>
            </View>
          ) : (
            todayActions.map(action => {
              const ActionIcon = getActionIcon(action.type);
              return (
                <TouchableOpacity
                  key={action.id}
                  style={[
                    styles.actionCard,
                    action.completed && styles.actionCardCompleted,
                  ]}
                  onPress={() => handleToggleAction(action)}
                  activeOpacity={0.7}
                >
                  <View
                    style={[
                      styles.actionIconContainer,
                      action.completed && styles.actionIconContainerCompleted,
                    ]}
                  >
                    {action.completed ? (
                      <Check color={Colors.textInverse} size={18} />
                    ) : (
                      <ActionIcon color={Colors.primary} size={18} />
                    )}
                  </View>
                  <View style={styles.actionContent}>
                    <Text
                      style={[
                        styles.actionName,
                        action.completed && styles.actionNameCompleted,
                      ]}
                    >
                      {action.name}
                    </Text>
                    <Text style={styles.actionDetails}>{action.details}</Text>
                  </View>
                  <View style={styles.actionTiming}>
                    <Text style={styles.actionTimingText}>{action.timing}</Text>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Weekly Trend</Text>
            <TrendingUp color={Colors.primary} size={20} />
          </View>

          <View style={styles.weekChart}>
            {weeklyAdherenceStats.map((day, index) => {
              const dayName = new Date(day.date).toLocaleDateString('en-US', {
                weekday: 'short',
              });
              const isToday =
                day.date === new Date().toISOString().split('T')[0];

              return (
                <View key={day.date} style={styles.dayColumn}>
                  <View style={styles.barContainer}>
                    <View
                      style={[
                        styles.bar,
                        { height: `${Math.max(day.percentage, 5)}%` },
                        isToday && styles.barToday,
                      ]}
                    />
                  </View>
                  <Text
                    style={[styles.dayLabel, isToday && styles.dayLabelToday]}
                  >
                    {dayName}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        <TouchableOpacity
          style={styles.checkInCard}
          onPress={() => router.push('/(tabs)/tracking')}
        >
          <LinearGradient
            colors={[Colors.accent, Colors.accentLight]}
            style={styles.checkInGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            <View style={styles.checkInContent}>
              <Text style={styles.checkInTitle}>Log Daily Check-in</Text>
              <Text style={styles.checkInSubtitle}>
                Track symptoms, energy, and notes
              </Text>
            </View>
            <ChevronRight color={Colors.text} size={24} />
          </LinearGradient>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  loadingText: {
    fontSize: 16,
    color: Colors.textSecondary,
  },
  headerGradient: {
    paddingBottom: 24,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  greeting: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
  },
  userName: {
    fontSize: 28,
    fontWeight: '700' as const,
    color: Colors.textInverse,
    marginBottom: 20,
  },
  progressCard: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 16,
    padding: 16,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  progressLabel: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
  },
  progressPercentage: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: Colors.textInverse,
  },
  progressBarContainer: {
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: Colors.accent,
    borderRadius: 4,
  },
  progressSubtext: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 40,
  },
  alertCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 24,
    borderLeftWidth: 4,
    borderLeftColor: Colors.warning,
  },
  alertIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: `${Colors.warning}20`,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  alertContent: {
    flex: 1,
  },
  alertTitle: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 2,
  },
  alertSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  section: {
    marginBottom: 28,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  seeAllText: {
    fontSize: 14,
    color: Colors.primary,
    fontWeight: '500' as const,
  },
  emptyState: {
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 14,
    padding: 24,
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
  },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  actionCardCompleted: {
    backgroundColor: Colors.surfaceSecondary,
    borderColor: Colors.borderLight,
  },
  actionIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: `${Colors.primary}15`,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  actionIconContainerCompleted: {
    backgroundColor: Colors.success,
  },
  actionContent: {
    flex: 1,
  },
  actionName: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 2,
  },
  actionNameCompleted: {
    textDecorationLine: 'line-through',
    color: Colors.textTertiary,
  },
  actionDetails: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  actionTiming: {
    backgroundColor: Colors.surfaceSecondary,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  actionTimingText: {
    fontSize: 11,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
    textTransform: 'capitalize',
  },
  weekChart: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    height: 160,
  },
  dayColumn: {
    flex: 1,
    alignItems: 'center',
  },
  barContainer: {
    flex: 1,
    width: 24,
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 6,
    justifyContent: 'flex-end',
    marginBottom: 8,
    overflow: 'hidden',
  },
  bar: {
    width: '100%',
    backgroundColor: Colors.primary,
    borderRadius: 6,
    opacity: 0.6,
  },
  barToday: {
    opacity: 1,
    backgroundColor: Colors.accent,
  },
  dayLabel: {
    fontSize: 11,
    color: Colors.textTertiary,
    fontWeight: '500' as const,
  },
  dayLabelToday: {
    color: Colors.primary,
    fontWeight: '600' as const,
  },
  checkInCard: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  checkInGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
  },
  checkInContent: {
    flex: 1,
  },
  checkInTitle: {
    fontSize: 17,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 4,
  },
  checkInSubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  insightsCard: {
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
  },
  insightsGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  insightsIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  insightsContent: {
    flex: 1,
  },
  insightsTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.textInverse,
    marginBottom: 2,
  },
  insightsSubtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.8)',
  },
});
