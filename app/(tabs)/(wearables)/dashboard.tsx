import { useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Animated,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Heart,
  Moon,
  Activity,
  TrendingUp,
  TrendingDown,
  Minus,
  Zap,
  Droplets,
  Brain,
  ChevronRight,
  Wifi,
  AlertTriangle,
  Target,
  Flame,
  Shield,
  Dumbbell,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useWearables } from '@/providers/WearablesProvider';
import { RecoveryStatus, ScoreResult } from '@/types/wearables';

const statusColors: Record<RecoveryStatus, { bg: string; text: string; gradient: [string, string] }> = {
  green: { bg: '#ECFDF5', text: '#059669', gradient: ['#059669', '#10B981'] },
  yellow: { bg: '#FFFBEB', text: '#D97706', gradient: ['#D97706', '#F59E0B'] },
  red: { bg: '#FEF2F2', text: '#DC2626', gradient: ['#DC2626', '#EF4444'] },
};

export default function WearablesTodayScreen() {
  const router = useRouter();
  const {
    todayRecord,
    recommendation,
    scores,
    baseline,
    connections,
    isLoading,
    isRefreshing,
    refreshData,
  } = useWearables();

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    if (!isLoading) {
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
      ]).start();
    }
  }, [isLoading, fadeAnim, slideAnim]);

  const handleRefresh = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    refreshData();
  }, [refreshData]);

  const navigateTo = useCallback((path: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(path as any);
  }, [router]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Loading health intelligence...</Text>
      </View>
    );
  }

  const rec = recommendation;
  const status = rec?.recoveryStatus ?? 'yellow';
  const statusConfig = statusColors[status];
  const connectedCount = connections.filter(c => c.connected).length;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={Colors.primary} />
      }
    >
      <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
        <View style={styles.connectionBar}>
          <View style={styles.connectionLeft}>
            <Wifi size={14} color={connectedCount > 0 ? Colors.success : Colors.textTertiary} />
            <Text style={styles.connectionText}>
              {connectedCount} device{connectedCount !== 1 ? 's' : ''} connected
            </Text>
          </View>
          <TouchableOpacity onPress={() => navigateTo('/(tabs)/(wearables)/connections')} testID="connections-btn">
            <Text style={styles.connectionLink}>Manage</Text>
          </TouchableOpacity>
        </View>

        <LinearGradient
          colors={statusConfig.gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.heroCard}
        >
          <View style={styles.heroTop}>
            <View>
              <Text style={styles.heroLabel}>TODAY'S RECOVERY</Text>
              <Text style={styles.heroScore}>{rec?.recoveryScore ?? '--'}</Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: 'rgba(255,255,255,0.25)' }]}>
              <Text style={styles.statusBadgeText}>{rec?.scores.recovery.label ?? 'Loading'}</Text>
            </View>
          </View>
          <Text style={styles.heroSummary}>{rec?.oneSentenceSummary ?? 'Analyzing your data...'}</Text>
          <View style={styles.heroMetrics}>
            <MetricChip icon={<Heart size={14} color="#fff" />} label="HRV" value={`${todayRecord?.hrv ?? '--'} ms`} baselineVal={baseline?.hrv14Day} currentVal={todayRecord?.hrv} inverted={false} />
            <MetricChip icon={<Activity size={14} color="#fff" />} label="RHR" value={`${todayRecord?.restingHr ?? '--'} bpm`} baselineVal={baseline?.restingHr14Day} currentVal={todayRecord?.restingHr} inverted={true} />
            <MetricChip icon={<Moon size={14} color="#fff" />} label="Sleep" value={todayRecord?.sleepDurationMinutes ? `${(todayRecord.sleepDurationMinutes / 60).toFixed(1)}h` : '--'} baselineVal={null} currentVal={null} inverted={false} />
          </View>
        </LinearGradient>

        {rec && rec.escalationFlags.length > 0 && (
          <View style={styles.escalationCard}>
            <View style={styles.escalationHeader}>
              <AlertTriangle size={18} color="#DC2626" />
              <Text style={styles.escalationTitle}>Practitioner Review Suggested</Text>
            </View>
            {rec.escalationFlags.map((flag) => (
              <Text key={flag.id} style={styles.escalationText}>{flag.message}</Text>
            ))}
          </View>
        )}

        <Text style={styles.sectionTitle}>Top Actions Today</Text>
        {rec?.topActions.map((action, idx) => (
          <TouchableOpacity key={action.id} style={styles.actionCard} activeOpacity={0.7}>
            <View style={[styles.actionIconWrap, { backgroundColor: actionCategoryColor(action.category) + '18' }]}>
              <ActionIcon category={action.category} />
            </View>
            <View style={styles.actionContent}>
              <Text style={styles.actionTitle}>{action.action}</Text>
              <Text style={styles.actionReason} numberOfLines={2}>{action.reason}</Text>
            </View>
            <View style={styles.actionPriority}>
              <Text style={styles.actionPriorityNum}>#{idx + 1}</Text>
            </View>
          </TouchableOpacity>
        ))}

        <Text style={styles.sectionTitle}>Health Scores</Text>
        <View style={styles.scoresGrid}>
          {scores && (
            <>
              <ScoreCard title="Recovery" score={scores.recovery} icon={<Heart size={18} color={statusColors[scores.recovery.status].text} />} />
              <ScoreCard title="Sleep" score={scores.sleep} icon={<Moon size={18} color={statusColors[scores.sleep.status].text} />} />
              <ScoreCard title="Stress Load" score={scores.stressLoad} icon={<Brain size={18} color={statusColors[scores.stressLoad.status].text} />} />
              <ScoreCard title="Metabolic" score={scores.metabolicResilience} icon={<Flame size={18} color={statusColors[scores.metabolicResilience.status].text} />} />
              <ScoreCard title="Adherence" score={scores.adherence} icon={<Target size={18} color={statusColors[scores.adherence.status].text} />} />
              <ScoreCard title="Nervous System" score={scores.nervousSystemBalance} icon={<Zap size={18} color={statusColors[scores.nervousSystemBalance.status].text} />} />
              <ScoreCard title="Inflammation" score={scores.inflammationStrain} icon={<Shield size={18} color={statusColors[scores.inflammationStrain.status].text} />} />
            </>
          )}
        </View>

        {rec && (
          <View style={styles.quickGlanceSection}>
            <Text style={styles.sectionTitle}>Training Guidance</Text>
            <View style={styles.trainingCard}>
              <View style={styles.trainingHeader}>
                <Dumbbell size={20} color={Colors.primary} />
                <Text style={styles.trainingLabel}>{rec.trainingGuidance.label}</Text>
              </View>
              <Text style={styles.trainingExplanation}>{rec.trainingGuidance.explanation}</Text>
              <View style={styles.intensityBar}>
                <View style={[styles.intensityFill, { width: `${rec.trainingGuidance.intensityLevel * 10}%` }]} />
              </View>
              <Text style={styles.intensityLabel}>Intensity: {rec.trainingGuidance.intensityLevel}/10</Text>
            </View>
          </View>
        )}

        <View style={styles.navCards}>
          <TouchableOpacity style={styles.navCard} onPress={() => navigateTo('/(tabs)/(wearables)/trends')} testID="trends-nav">
            <TrendingUp size={22} color={Colors.primary} />
            <Text style={styles.navCardTitle}>Trends</Text>
            <Text style={styles.navCardSub}>7/14/30-day views</Text>
            <ChevronRight size={16} color={Colors.textTertiary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.navCard} onPress={() => navigateTo('/(tabs)/(wearables)/plan')} testID="plan-nav">
            <Target size={22} color={Colors.accent} />
            <Text style={styles.navCardTitle}>Plan</Text>
            <Text style={styles.navCardSub}>Today's full guidance</Text>
            <ChevronRight size={16} color={Colors.textTertiary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.navCard} onPress={() => navigateTo('/(tabs)/(wearables)/insights-detail')} testID="insights-nav">
            <Brain size={22} color={Colors.chartPurple} />
            <Text style={styles.navCardTitle}>Insights</Text>
            <Text style={styles.navCardSub}>Patterns & correlations</Text>
            <ChevronRight size={16} color={Colors.textTertiary} />
          </TouchableOpacity>
        </View>

        <View style={styles.disclaimer}>
          <Text style={styles.disclaimerText}>
            Insights are for wellness optimization only and do not constitute medical advice. Consult your healthcare practitioner for clinical decisions.
          </Text>
        </View>
      </Animated.View>
    </ScrollView>
  );
}

function MetricChip({ icon, label, value, baselineVal, currentVal, inverted }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  baselineVal: number | null | undefined;
  currentVal: number | null | undefined;
  inverted: boolean;
}) {
  let trendIcon = <Minus size={10} color="rgba(255,255,255,0.7)" />;
  if (baselineVal != null && currentVal != null) {
    const diff = currentVal - baselineVal;
    const isGood = inverted ? diff < 0 : diff > 0;
    trendIcon = isGood
      ? <TrendingUp size={10} color="rgba(255,255,255,0.9)" />
      : diff === 0
        ? <Minus size={10} color="rgba(255,255,255,0.7)" />
        : <TrendingDown size={10} color="rgba(255,255,255,0.9)" />;
  }

  return (
    <View style={styles.metricChip}>
      {icon}
      <Text style={styles.metricLabel}>{label}</Text>
      <View style={styles.metricValueRow}>
        <Text style={styles.metricValue}>{value}</Text>
        {trendIcon}
      </View>
    </View>
  );
}

function ScoreCard({ title, score, icon }: { title: string; score: ScoreResult; icon: React.ReactNode }) {
  const config = statusColors[score.status];
  return (
    <View style={[styles.scoreCard, { backgroundColor: config.bg }]}>
      <View style={styles.scoreCardHeader}>
        {icon}
        <Text style={[styles.scoreValue, { color: config.text }]}>{score.score}</Text>
      </View>
      <Text style={styles.scoreTitle}>{title}</Text>
      <Text style={[styles.scoreLabel, { color: config.text }]}>{score.label}</Text>
    </View>
  );
}

function ActionIcon({ category }: { category: string }) {
  const color = actionCategoryColor(category);
  const size = 18;
  switch (category) {
    case 'training': return <Dumbbell size={size} color={color} />;
    case 'sleep': return <Moon size={size} color={color} />;
    case 'stress': return <Brain size={size} color={color} />;
    case 'nutrition': return <Droplets size={size} color={color} />;
    case 'supplement': return <Shield size={size} color={color} />;
    case 'recovery': return <Heart size={size} color={color} />;
    default: return <Zap size={size} color={color} />;
  }
}

function actionCategoryColor(category: string): string {
  switch (category) {
    case 'training': return '#2563EB';
    case 'sleep': return '#7C3AED';
    case 'stress': return '#DC2626';
    case 'nutrition': return '#059669';
    case 'supplement': return '#D97706';
    case 'recovery': return '#EC4899';
    default: return Colors.primary;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 40 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  loadingText: { marginTop: 12, color: Colors.textSecondary, fontSize: 15 },
  connectionBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    marginBottom: 12,
  },
  connectionLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  connectionText: { fontSize: 13, color: Colors.textSecondary },
  connectionLink: { fontSize: 13, color: Colors.primary, fontWeight: '600' as const },
  heroCard: { borderRadius: 20, padding: 20, marginBottom: 20 },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  heroLabel: { fontSize: 11, fontWeight: '700' as const, color: 'rgba(255,255,255,0.7)', letterSpacing: 1.2, marginBottom: 4 },
  heroScore: { fontSize: 52, fontWeight: '800' as const, color: '#fff', lineHeight: 56 },
  statusBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  statusBadgeText: { fontSize: 13, fontWeight: '700' as const, color: '#fff' },
  heroSummary: { fontSize: 15, color: 'rgba(255,255,255,0.9)', lineHeight: 22, marginBottom: 16 },
  heroMetrics: { flexDirection: 'row', gap: 10 },
  metricChip: { flex: 1, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 12, padding: 10, alignItems: 'center', gap: 4 },
  metricLabel: { fontSize: 10, fontWeight: '600' as const, color: 'rgba(255,255,255,0.7)', letterSpacing: 0.5 },
  metricValueRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metricValue: { fontSize: 14, fontWeight: '700' as const, color: '#fff' },
  escalationCard: { backgroundColor: '#FEF2F2', borderRadius: 14, padding: 16, marginBottom: 20, borderLeftWidth: 4, borderLeftColor: '#DC2626' },
  escalationHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  escalationTitle: { fontSize: 14, fontWeight: '700' as const, color: '#DC2626' },
  escalationText: { fontSize: 13, color: '#7F1D1D', lineHeight: 19 },
  sectionTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text, marginBottom: 12, marginTop: 4 },
  actionCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 14, padding: 14, marginBottom: 10, gap: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  actionIconWrap: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  actionContent: { flex: 1 },
  actionTitle: { fontSize: 14, fontWeight: '600' as const, color: Colors.text, marginBottom: 2 },
  actionReason: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },
  actionPriority: { width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.surfaceSecondary, justifyContent: 'center', alignItems: 'center' },
  actionPriorityNum: { fontSize: 12, fontWeight: '700' as const, color: Colors.textTertiary },
  scoresGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  scoreCard: { borderRadius: 14, padding: 14, flexGrow: 1, minWidth: 150, flexBasis: '45%' as any },
  scoreCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  scoreValue: { fontSize: 28, fontWeight: '800' as const },
  scoreTitle: { fontSize: 13, fontWeight: '600' as const, color: Colors.text, marginBottom: 2 },
  scoreLabel: { fontSize: 11, fontWeight: '600' as const },
  quickGlanceSection: { marginBottom: 12 },
  trainingCard: { backgroundColor: Colors.surface, borderRadius: 14, padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1, marginBottom: 20 },
  trainingHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  trainingLabel: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  trainingExplanation: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19, marginBottom: 12 },
  intensityBar: { height: 6, backgroundColor: Colors.borderLight, borderRadius: 3, marginBottom: 6, overflow: 'hidden' },
  intensityFill: { height: '100%' as any, backgroundColor: Colors.primary, borderRadius: 3 },
  intensityLabel: { fontSize: 12, color: Colors.textTertiary, fontWeight: '500' as const },
  navCards: { gap: 10, marginBottom: 20 },
  navCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 14, padding: 16, gap: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  navCardTitle: { fontSize: 15, fontWeight: '600' as const, color: Colors.text, flex: 1 },
  navCardSub: { fontSize: 12, color: Colors.textTertiary },
  disclaimer: { padding: 14, backgroundColor: Colors.surfaceSecondary, borderRadius: 10, marginBottom: 20 },
  disclaimerText: { fontSize: 11, color: Colors.textTertiary, lineHeight: 16, textAlign: 'center' },
});
