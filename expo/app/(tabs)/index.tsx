import { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useQuery } from '@tanstack/react-query';
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
  Sparkles,
  XCircle,
} from 'lucide-react-native';

import Colors from '@/constants/colors';
import { useUser } from '@/providers/UserProvider';
import { useProtocol } from '@/providers/ProtocolProvider';
import { useLabs } from '@/providers/LabsProvider';
import { TodayAction } from '@/types';
import { CategoryScore } from '@/types';
import { fetchOrGenerateDailyCoach } from '@/lib/dailyCoachClient';

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

const recoveryBadgeStyle = (status: string) => {
  switch (status.toLowerCase()) {
    case 'good':
      return { backgroundColor: 'rgba(16, 185, 129, 0.25)' };
    case 'poor':
      return { backgroundColor: 'rgba(239, 68, 68, 0.25)' };
    default:
      return { backgroundColor: 'rgba(245, 158, 11, 0.25)' };
  }
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
  const { userProfile, questionnaireResponses, categoryScores, isLoading: userLoading, isClinician } = useUser();
  const { todayActions, adherencePercentage, weeklyAdherenceStats, toggleActionComplete, isLoading: protocolLoading } = useProtocol();
  const { flaggedBiomarkers } = useLabs();

  const coachQuery = useQuery({
    queryKey: ['dailyCoach', new Date().toISOString().slice(0, 10)],
    queryFn: async () => {
      const result = await fetchOrGenerateDailyCoach();
      if (result.error) throw new Error(result.error);
      return result.data;
    },
    enabled: !userLoading && userProfile.onboardingCompleted && !isClinician,
    staleTime: 1000 * 60 * 30,
  });

  const progressAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (userLoading) return;
    if (isClinician) {
      router.replace('/(tabs)/(clinic)/dashboard' as any);
      return;
    }
    if (!userProfile.onboardingCompleted) {
      router.replace('/onboarding' as any);
    }
  }, [userProfile.onboardingCompleted, userLoading, isClinician]);

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
        <TouchableOpacity
          style={styles.coachCard}
          onPress={() => router.push('/(tabs)/insights' as any)}
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={['#0F172A', '#1E293B']}
            style={styles.coachGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <View style={styles.coachHeader}>
              <View style={styles.coachIconContainer}>
                <Sparkles color={Colors.accent} size={20} />
              </View>
              <Text style={styles.coachTitle}>Today's AI Coach</Text>
              {coachQuery.data?.recovery_status ? (
                <View style={[styles.coachStatus, recoveryBadgeStyle(coachQuery.data.recovery_status)]}>
                  <Text style={styles.coachStatusText}>
                    {coachQuery.data.recovery_status.toUpperCase()}
                  </Text>
                </View>
              ) : null}
            </View>

            {coachQuery.isLoading ? (
              <View style={styles.coachLoadingRow}>
                <ActivityIndicator color={Colors.accent} />
                <Text style={styles.coachLoadingText}>Analyzing your labs, symptoms, and today's data…</Text>
              </View>
            ) : coachQuery.isError ? (
              <Text style={styles.coachErrorText}>
                Couldn't generate today's recommendation. {coachQuery.error instanceof Error ? coachQuery.error.message : ''}
              </Text>
            ) : coachQuery.data ? (
              <>
                <Text style={styles.coachShortText}>
                  {coachQuery.data.explanation_short || 'Tap to view your full plan for today.'}
                </Text>
                {coachQuery.data.top_actions.length > 0 && (
                  <View style={styles.coachActions}>
                    {coachQuery.data.top_actions.slice(0, 3).map((a, i) => (
                      <View key={i} style={styles.coachActionRow}>
                        <View style={styles.coachActionBullet}><Text style={styles.coachActionBulletText}>{i + 1}</Text></View>
                        <Text style={styles.coachActionText} numberOfLines={2}>{a}</Text>
                      </View>
                    ))}
                  </View>
                )}
                {coachQuery.data.supplements_to_skip_today.length > 0 && (
                  <View style={styles.coachSkipBox}>
                    <View style={styles.coachSkipHeader}>
                      <XCircle color={Colors.coral} size={14} />
                      <Text style={styles.coachSkipTitle}>Skip today</Text>
                    </View>
                    {coachQuery.data.supplements_to_skip_today.slice(0, 3).map((s, i) => (
                      <Text key={i} style={styles.coachSkipItem} numberOfLines={2}>
                        • {s.name} — {s.reason}
                      </Text>
                    ))}
                  </View>
                )}
              </>
            ) : (
              <Text style={styles.coachShortText}>
                Complete your intake and lab uploads to unlock daily recommendations.
              </Text>
            )}
          </LinearGradient>
        </TouchableOpacity>

        {questionnaireResponses.length > 0 && (
          <TouchableOpacity
            style={styles.insightsCard}
            onPress={() => router.push('/(tabs)/insights' as any)}
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
            onPress={() => router.push('/(tabs)/labs' as any)}
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
            <TouchableOpacity onPress={() => router.push('/(tabs)/protocol' as any)}>
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
          onPress={() => router.push('/(tabs)/tracking' as any)}
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
    paddingBottom: 120,
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
  coachCard: {
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
  },
  coachGradient: {
    padding: 18,
  },
  coachHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  coachIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coachTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.textInverse,
  },
  coachStatus: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  coachStatusText: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: Colors.textInverse,
    letterSpacing: 0.5,
  },
  coachLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
  },
  coachLoadingText: {
    flex: 1,
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
  },
  coachErrorText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
  },
  coachShortText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.92)',
    lineHeight: 20,
    marginBottom: 12,
  },
  coachActions: {
    gap: 8,
    marginBottom: 4,
  },
  coachActionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  coachActionBullet: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  coachActionBulletText: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: Colors.textInverse,
  },
  coachActionText: {
    flex: 1,
    fontSize: 13,
    color: 'rgba(255,255,255,0.88)',
    lineHeight: 18,
  },
  coachSkipBox: {
    marginTop: 12,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderRadius: 10,
    padding: 10,
    borderLeftWidth: 3,
    borderLeftColor: Colors.coral,
  },
  coachSkipHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  coachSkipTitle: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.coral,
    letterSpacing: 0.4,
  },
  coachSkipItem: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.88)',
    lineHeight: 16,
    marginBottom: 2,
  },
});
