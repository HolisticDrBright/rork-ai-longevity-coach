import { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  Heart,
  Moon,
  Activity,
  TrendingUp,
  TrendingDown,
  Minus,
  Brain,
  Target,
  Zap,
  Flame,
  BarChart3,
  Calendar,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useWearables } from '@/providers/WearablesProvider';
import { TrendDirection } from '@/types/wearables';
import { getMetric, MetricAvailability } from '@/constants/wearableCapabilities';

const SCREEN_WIDTH = Dimensions.get('window').width;

type TimeRange = 7 | 14 | 30;

/**
 * Chart configs are keyed by the trend-series keys understood by
 * getTrendSeries. `metricKey` links device metrics to the METRICS registry
 * so label/unit/lowerIsBetter and availability come from one source of
 * truth; entries without a metricKey are subjective check-in metrics that
 * do not depend on any wearable and are always selectable. `label`/`unit`/
 * `higherBetter` act as overrides where the chart deviates from the
 * registry (e.g. sleep duration is charted in hours, not minutes).
 */
interface TrendMetricConfig {
  key: string;
  metricKey?: string;
  label?: string;
  unit?: string;
  higherBetter?: boolean;
  icon: typeof Heart;
  color: string;
}

const metricConfigs: TrendMetricConfig[] = [
  { key: 'hrv', metricKey: 'hrv', icon: Heart, color: '#4A90D9' },
  { key: 'restingHr', metricKey: 'restingHr', label: 'Resting HR', icon: Activity, color: '#E76F51' },
  { key: 'sleepScore', metricKey: 'sleepDuration', label: 'Sleep Score', unit: '', icon: Moon, color: '#7C3AED', higherBetter: true },
  { key: 'sleepDuration', metricKey: 'sleepDuration', unit: 'h', icon: Moon, color: '#2563EB' },
  { key: 'steps', metricKey: 'steps', icon: Activity, color: '#16A34A' },
  { key: 'readinessScore', metricKey: 'readiness', label: 'Readiness', icon: Target, color: '#0D9488' },
  { key: 'adherenceScore', label: 'Adherence', unit: '%', icon: Target, color: '#F59E0B', higherBetter: true },
  { key: 'energyScore', label: 'Energy', unit: '/10', icon: Zap, color: '#F97316', higherBetter: true },
  { key: 'moodScore', label: 'Mood', unit: '/10', icon: Brain, color: '#8B5CF6', higherBetter: true },
  { key: 'sorenessScore', label: 'Soreness', unit: '/10', icon: Flame, color: '#DC2626', higherBetter: false },
];

interface ResolvedMetricConfig {
  key: string;
  label: string;
  unit: string;
  higherBetter: boolean;
  icon: typeof Heart;
  color: string;
  /** null = subjective metric with no wearable dependency (always shown). */
  availability: MetricAvailability | null;
}

const trendIcons: Record<TrendDirection, { icon: typeof TrendingUp; color: string; label: string }> = {
  improving: { icon: TrendingUp, color: '#059669', label: 'Improving' },
  stable: { icon: Minus, color: '#6B7280', label: 'Stable' },
  declining: { icon: TrendingDown, color: '#DC2626', label: 'Declining' },
  insufficient_data: { icon: BarChart3, color: '#9CA3AF', label: 'Insufficient data' },
};

export default function TrendsScreen() {
  const { getTrendSeries, getTrendAnalysis, getWeekdayWeekendEffect, getCycleLinkedTrends, records, metricAvailability } = useWearables();
  const [timeRange, setTimeRange] = useState<TimeRange>(14);
  const [selectedKey, setSelectedKey] = useState<string>('hrv');

  const resolvedConfigs = useMemo<ResolvedMetricConfig[]>(() => {
    return metricConfigs.map(mc => {
      const metric = mc.metricKey ? getMetric(mc.metricKey) : undefined;
      return {
        key: mc.key,
        label: mc.label ?? metric?.label ?? mc.key,
        unit: mc.unit ?? metric?.unit ?? '',
        higherBetter: mc.higherBetter ?? !(metric?.lowerIsBetter ?? false),
        icon: mc.icon,
        color: mc.color,
        availability: mc.metricKey ? (metricAvailability[mc.metricKey] ?? 'locked') : null,
      };
    });
  }, [metricAvailability]);

  // Availability rules: 'locked' metrics are hidden entirely, 'expected'
  // are shown disabled (syncing…), 'live' + subjective are selectable.
  const pickerConfigs = useMemo(
    () => resolvedConfigs.filter(c => c.availability !== 'locked'),
    [resolvedConfigs],
  );
  const selectableConfigs = useMemo(
    () => pickerConfigs.filter(c => c.availability !== 'expected'),
    [pickerConfigs],
  );

  // If the persisted selection became unavailable (e.g. device disconnected),
  // fall back to the first selectable metric.
  const selectedMetric = selectableConfigs.some(c => c.key === selectedKey)
    ? selectedKey
    : (selectableConfigs[0]?.key ?? 'hrv');

  const handleTimeRange = useCallback((range: TimeRange) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTimeRange(range);
  }, []);

  const handleMetric = useCallback((key: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedKey(key);
  }, []);

  const trendData = useMemo(() => getTrendSeries(selectedMetric, timeRange), [getTrendSeries, selectedMetric, timeRange]);
  const metricConfig = resolvedConfigs.find(m => m.key === selectedMetric)!;

  const trendAnalysis = useMemo(() => {
    return getTrendAnalysis(selectedMetric, timeRange, metricConfig.higherBetter);
  }, [getTrendAnalysis, selectedMetric, timeRange, metricConfig.higherBetter]);

  const weekdayWeekendEffect = useMemo(() => {
    const metricKey = selectedMetric === 'sleepDuration' ? 'sleepDurationMinutes' : selectedMetric;
    if (['hrv', 'restingHr', 'sleepScore', 'steps', 'readinessScore', 'adherenceScore', 'energyScore', 'moodScore', 'sorenessScore'].includes(metricKey)) {
      return getWeekdayWeekendEffect(metricKey as any);
    }
    return null;
  }, [getWeekdayWeekendEffect, selectedMetric]);

  const cycleLinked = useMemo(() => {
    const hasCycleData = records.some(r => r.cyclePhase && r.cyclePhase !== 'unknown');
    if (!hasCycleData) return null;
    const metricKey = selectedMetric === 'sleepDuration' ? 'sleepDurationMinutes' : selectedMetric;
    if (['hrv', 'restingHr', 'sleepScore', 'readinessScore', 'energyScore', 'moodScore', 'sorenessScore'].includes(metricKey)) {
      return getCycleLinkedTrends(metricKey as any);
    }
    return null;
  }, [getCycleLinkedTrends, selectedMetric, records]);

  const allTrends = useMemo(() => {
    return selectableConfigs.map(mc => {
      const series = getTrendSeries(mc.key, timeRange);
      return { ...mc, direction: series.direction, changePercent: series.changePercent };
    });
  }, [selectableConfigs, getTrendSeries, timeRange]);

  const chartData = useMemo(() => {
    const validPoints = trendData.data.filter(d => d.value !== null);
    if (validPoints.length === 0) return { points: [], min: 0, max: 100 };
    const values = validPoints.map(d => d.value!);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const chartWidth = SCREEN_WIDTH - 64;
    const chartHeight = 160;
    const points = validPoints.map((d, i) => ({
      x: (i / Math.max(validPoints.length - 1, 1)) * chartWidth,
      y: chartHeight - ((d.value! - min) / range) * chartHeight,
      value: d.value!,
      date: d.date,
    }));
    return { points, min, max };
  }, [trendData]);

  const correlationInsights = useMemo(() => {
    if (records.length < 7) return [];
    const insights: string[] = [];

    const alcoholDays = records.slice(0, timeRange).filter(r => (r.alcoholUnits ?? 0) > 0);
    const noAlcDays = records.slice(0, timeRange).filter(r => (r.alcoholUnits ?? 0) === 0);
    if (alcoholDays.length >= 2 && noAlcDays.length >= 2) {
      const alcSleep = alcoholDays.reduce((s, r) => s + (r.sleepEfficiency ?? 85), 0) / alcoholDays.length;
      const noAlcSleep = noAlcDays.reduce((s, r) => s + (r.sleepEfficiency ?? 85), 0) / noAlcDays.length;
      if (noAlcSleep - alcSleep > 3) {
        insights.push(`Sleep efficiency is ${(noAlcSleep - alcSleep).toFixed(0)}% higher on alcohol-free nights.`);
      }
    }

    const highCaffDays = records.slice(0, timeRange).filter(r => {
      if (!r.caffeineLastTime) return false;
      return parseInt(r.caffeineLastTime.split(':')[0]) >= 14;
    });
    const earlyCaffDays = records.slice(0, timeRange).filter(r => {
      if (!r.caffeineLastTime) return false;
      return parseInt(r.caffeineLastTime.split(':')[0]) < 14;
    });
    if (highCaffDays.length >= 2 && earlyCaffDays.length >= 2) {
      const lateSleep = highCaffDays.reduce((s, r) => s + (r.sleepScore ?? 75), 0) / highCaffDays.length;
      const earlySleep = earlyCaffDays.reduce((s, r) => s + (r.sleepScore ?? 75), 0) / earlyCaffDays.length;
      if (earlySleep - lateSleep > 3) {
        insights.push(`Sleep quality improves by ${(earlySleep - lateSleep).toFixed(0)} points when caffeine stops before 2 PM.`);
      }
    }

    const workoutDays = records.slice(0, timeRange).filter(r => (r.workoutMinutes ?? 0) > 30);
    const restDays = records.slice(0, timeRange).filter(r => (r.workoutMinutes ?? 0) === 0);
    if (workoutDays.length >= 2 && restDays.length >= 2) {
      const workEnergy = workoutDays.reduce((s, r) => s + (r.energyScore ?? 6), 0) / workoutDays.length;
      const restEnergy = restDays.reduce((s, r) => s + (r.energyScore ?? 6), 0) / restDays.length;
      if (workEnergy > restEnergy + 0.5) {
        insights.push(`Energy tends to be higher on active days (+${(workEnergy - restEnergy).toFixed(1)} points).`);
      }
    }

    return insights;
  }, [records, timeRange]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.timeRangeBar}>
        {([7, 14, 30] as TimeRange[]).map(range => (
          <TouchableOpacity
            key={range}
            style={[styles.timeRangeBtn, timeRange === range && styles.timeRangeBtnActive]}
            onPress={() => handleTimeRange(range)}
          >
            <Text style={[styles.timeRangeText, timeRange === range && styles.timeRangeTextActive]}>
              {range}D
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.chartCard}>
        <View style={styles.chartHeader}>
          <View>
            <Text style={styles.chartMetricLabel}>{metricConfig.label}</Text>
            <View style={styles.chartTrendRow}>
              {(() => {
                const tInfo = trendIcons[trendData.direction];
                const TIcon = tInfo.icon;
                return (
                  <>
                    <TIcon size={14} color={tInfo.color} />
                    <Text style={[styles.chartTrendText, { color: tInfo.color }]}>
                      {tInfo.label} ({trendData.changePercent > 0 ? '+' : ''}{trendData.changePercent}%)
                    </Text>
                  </>
                );
              })()}
            </View>
          </View>
          <View style={[styles.chartCurrentBadge, { backgroundColor: metricConfig.color + '18' }]}>
            <Text style={[styles.chartCurrentValue, { color: metricConfig.color }]}>
              {trendData.data.length > 0 ? (trendData.data[trendData.data.length - 1]?.value?.toFixed(metricConfig.key === 'sleepDuration' ? 1 : 0) ?? '--') : '--'}
              <Text style={styles.chartCurrentUnit}> {metricConfig.unit}</Text>
            </Text>
          </View>
        </View>

        <View style={styles.chartArea}>
          {chartData.points.length > 1 ? (
            <View style={styles.sparklineContainer}>
              {chartData.points.map((point, i) => (
                <View
                  key={i}
                  style={[
                    styles.sparklineBar,
                    {
                      left: point.x,
                      height: Math.max(160 - point.y, 4),
                      backgroundColor: metricConfig.color + '60',
                      bottom: 0,
                    },
                  ]}
                />
              ))}
              {chartData.points.map((point, i) => (
                <View
                  key={`dot-${i}`}
                  style={[
                    styles.sparklineDot,
                    {
                      left: point.x - 3,
                      top: point.y - 3,
                      backgroundColor: metricConfig.color,
                    },
                  ]}
                />
              ))}
            </View>
          ) : (
            <View style={styles.noDataContainer}>
              <Text style={styles.noDataText}>Not enough data for this range</Text>
            </View>
          )}
        </View>

        <View style={styles.chartAxisLabels}>
          <Text style={styles.axisLabel}>{chartData.min.toFixed(metricConfig.key === 'sleepDuration' ? 1 : 0)}</Text>
          <Text style={styles.axisLabel}>{chartData.max.toFixed(metricConfig.key === 'sleepDuration' ? 1 : 0)}</Text>
        </View>
      </View>

      {trendAnalysis && (trendAnalysis.mean !== null || trendAnalysis.slope !== null) && (
        <View style={styles.analysisCard}>
          <Text style={styles.analysisTitle}>Trend Analysis</Text>
          <View style={styles.analysisGrid}>
            {trendAnalysis.mean !== null && (
              <View style={styles.analysisStat}>
                <Text style={styles.analysisStatValue}>{trendAnalysis.mean.toFixed(metricConfig.key === 'sleepDuration' ? 1 : 0)}</Text>
                <Text style={styles.analysisStatLabel}>Mean</Text>
              </View>
            )}
            {trendAnalysis.median !== null && (
              <View style={styles.analysisStat}>
                <Text style={styles.analysisStatValue}>{trendAnalysis.median.toFixed(metricConfig.key === 'sleepDuration' ? 1 : 0)}</Text>
                <Text style={styles.analysisStatLabel}>Median</Text>
              </View>
            )}
            {trendAnalysis.volatility !== null && (
              <View style={styles.analysisStat}>
                <Text style={styles.analysisStatValue}>{trendAnalysis.volatility.toFixed(1)}</Text>
                <Text style={styles.analysisStatLabel}>Volatility</Text>
              </View>
            )}
            {trendAnalysis.slope !== null && (
              <View style={styles.analysisStat}>
                <View style={styles.slopeRow}>
                  {trendAnalysis.slope > 0.01
                    ? <ArrowUpRight size={14} color={metricConfig.higherBetter ? '#059669' : '#DC2626'} />
                    : trendAnalysis.slope < -0.01
                      ? <ArrowDownRight size={14} color={metricConfig.higherBetter ? '#DC2626' : '#059669'} />
                      : <Minus size={14} color="#6B7280" />
                  }
                  <Text style={styles.analysisStatValue}>{Math.abs(trendAnalysis.slope).toFixed(2)}</Text>
                </View>
                <Text style={styles.analysisStatLabel}>Slope/day</Text>
              </View>
            )}
          </View>
          {trendAnalysis.bestDay && trendAnalysis.worstDay && (
            <View style={styles.bestWorstRow}>
              <View style={styles.bestWorstItem}>
                <Text style={styles.bestWorstLabel}>Best</Text>
                <Text style={styles.bestWorstValue}>{trendAnalysis.bestDay.value.toFixed(metricConfig.key === 'sleepDuration' ? 1 : 0)}</Text>
                <Text style={styles.bestWorstDate}>{new Date(trendAnalysis.bestDay.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</Text>
              </View>
              <View style={styles.bestWorstItem}>
                <Text style={styles.bestWorstLabel}>Worst</Text>
                <Text style={styles.bestWorstValue}>{trendAnalysis.worstDay.value.toFixed(metricConfig.key === 'sleepDuration' ? 1 : 0)}</Text>
                <Text style={styles.bestWorstDate}>{new Date(trendAnalysis.worstDay.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</Text>
              </View>
            </View>
          )}
        </View>
      )}

      {weekdayWeekendEffect && weekdayWeekendEffect.significant && (
        <View style={styles.weekdayWeekendCard}>
          <View style={styles.wwHeader}>
            <Calendar size={16} color={Colors.primary} />
            <Text style={styles.wwTitle}>Weekday vs Weekend</Text>
          </View>
          <View style={styles.wwRow}>
            <View style={styles.wwItem}>
              <Text style={styles.wwLabel}>Weekday</Text>
              <Text style={styles.wwValue}>{weekdayWeekendEffect.weekdayAvg?.toFixed(1) ?? '--'}</Text>
            </View>
            <View style={styles.wwDivider} />
            <View style={styles.wwItem}>
              <Text style={styles.wwLabel}>Weekend</Text>
              <Text style={styles.wwValue}>{weekdayWeekendEffect.weekendAvg?.toFixed(1) ?? '--'}</Text>
            </View>
            <View style={styles.wwDivider} />
            <View style={styles.wwItem}>
              <Text style={styles.wwLabel}>Diff</Text>
              <Text style={[styles.wwDiff, {
                color: weekdayWeekendEffect.difference !== null && weekdayWeekendEffect.difference > 0
                  ? (metricConfig.higherBetter ? '#059669' : '#DC2626')
                  : (metricConfig.higherBetter ? '#DC2626' : '#059669')
              }]}>
                {weekdayWeekendEffect.difference !== null ? `${weekdayWeekendEffect.difference > 0 ? '+' : ''}${weekdayWeekendEffect.difference.toFixed(1)}` : '--'}
              </Text>
            </View>
          </View>
        </View>
      )}

      {cycleLinked && cycleLinked.some(c => c.metricAvg !== null) && (
        <View style={styles.cycleCard}>
          <View style={styles.cycleHeader}>
            <Text style={styles.cycleTitle}>Cycle-Linked Trends</Text>
          </View>
          <View style={styles.cycleGrid}>
            {cycleLinked.map(phase => (
              <View key={phase.phase} style={styles.cyclePhaseItem}>
                <View style={[styles.cyclePhaseDot, {
                  backgroundColor: phase.phase === 'menstrual' ? '#EF4444' : phase.phase === 'follicular' ? '#3B82F6' : phase.phase === 'ovulatory' ? '#10B981' : '#F59E0B'
                }]} />
                <Text style={styles.cyclePhaseName}>{phase.phase.charAt(0).toUpperCase() + phase.phase.slice(1)}</Text>
                <Text style={styles.cyclePhaseValue}>{phase.metricAvg?.toFixed(1) ?? '--'}</Text>
                <Text style={styles.cyclePhaseSamples}>n={phase.sampleCount}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      <Text style={styles.sectionTitle}>Select Metric</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.metricPicker}>
        {pickerConfigs.map(mc => {
          const IconComp = mc.icon;
          const isSelected = selectedMetric === mc.key;
          const isSyncing = mc.availability === 'expected';
          return (
            <TouchableOpacity
              key={mc.key}
              style={[
                styles.metricChip,
                isSelected && { backgroundColor: mc.color + '18', borderColor: mc.color },
                isSyncing && styles.metricChipSyncing,
              ]}
              onPress={() => handleMetric(mc.key)}
              disabled={isSyncing}
            >
              <IconComp size={14} color={isSelected ? mc.color : Colors.textTertiary} />
              <Text style={[styles.metricChipText, isSelected && { color: mc.color }]}>{mc.label}</Text>
              {isSyncing && <Text style={styles.syncingTag}>syncing…</Text>}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <Text style={styles.sectionTitle}>All Metrics Overview</Text>
      {allTrends.map(trend => {
        const TrendIcon = trendIcons[trend.direction].icon;
        const trendColor = trend.higherBetter
          ? (trend.direction === 'improving' ? '#059669' : trend.direction === 'declining' ? '#DC2626' : '#6B7280')
          : (trend.direction === 'improving' ? '#DC2626' : trend.direction === 'declining' ? '#059669' : '#6B7280');
        const IconComp = trend.icon;

        return (
          <TouchableOpacity
            key={trend.key}
            style={[styles.metricRow, selectedMetric === trend.key && styles.metricRowActive]}
            onPress={() => handleMetric(trend.key)}
          >
            <View style={[styles.metricRowIcon, { backgroundColor: trend.color + '15' }]}>
              <IconComp size={16} color={trend.color} />
            </View>
            <Text style={styles.metricRowLabel}>{trend.label}</Text>
            <View style={styles.metricRowTrend}>
              <TrendIcon size={14} color={trendColor} />
              <Text style={[styles.metricRowChange, { color: trendColor }]}>
                {trend.changePercent > 0 ? '+' : ''}{trend.changePercent}%
              </Text>
            </View>
          </TouchableOpacity>
        );
      })}

      {correlationInsights.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Correlation Insights</Text>
          {correlationInsights.map((insight, idx) => (
            <View key={idx} style={styles.correlationCard}>
              <BarChart3 size={16} color={Colors.primary} />
              <Text style={styles.correlationText}>{insight}</Text>
            </View>
          ))}
        </>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 40 },
  timeRangeBar: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  timeRangeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.surfaceSecondary,
    alignItems: 'center',
  },
  timeRangeBtnActive: { backgroundColor: Colors.primary },
  timeRangeText: { fontSize: 14, fontWeight: '600' as const, color: Colors.textSecondary },
  timeRangeTextActive: { color: '#fff' },
  chartCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  chartHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  chartMetricLabel: { fontSize: 16, fontWeight: '700' as const, color: Colors.text, marginBottom: 4 },
  chartTrendRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  chartTrendText: { fontSize: 13, fontWeight: '600' as const },
  chartCurrentBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  chartCurrentValue: { fontSize: 18, fontWeight: '800' as const },
  chartCurrentUnit: { fontSize: 12, fontWeight: '500' as const },
  chartArea: { height: 160, position: 'relative' as const, marginBottom: 8 },
  sparklineContainer: { position: 'relative' as const, height: 160 },
  sparklineBar: { position: 'absolute' as const, width: 4, borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  sparklineDot: { position: 'absolute' as const, width: 6, height: 6, borderRadius: 3 },
  noDataContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  noDataText: { fontSize: 13, color: Colors.textTertiary },
  chartAxisLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  axisLabel: { fontSize: 11, color: Colors.textTertiary },
  analysisCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  analysisTitle: { fontSize: 15, fontWeight: '700' as const, color: Colors.text, marginBottom: 12 },
  analysisGrid: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  analysisStat: { flex: 1, alignItems: 'center', backgroundColor: Colors.surfaceSecondary, borderRadius: 10, padding: 10 },
  analysisStatValue: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  analysisStatLabel: { fontSize: 10, color: Colors.textTertiary, fontWeight: '500' as const, marginTop: 2 },
  slopeRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  bestWorstRow: { flexDirection: 'row', gap: 12 },
  bestWorstItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.surfaceSecondary, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  bestWorstLabel: { fontSize: 11, fontWeight: '600' as const, color: Colors.textTertiary },
  bestWorstValue: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  bestWorstDate: { fontSize: 10, color: Colors.textTertiary },
  weekdayWeekendCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  wwHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  wwTitle: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  wwRow: { flexDirection: 'row', alignItems: 'center' },
  wwItem: { flex: 1, alignItems: 'center' },
  wwLabel: { fontSize: 11, color: Colors.textTertiary, fontWeight: '500' as const, marginBottom: 4 },
  wwValue: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  wwDiff: { fontSize: 18, fontWeight: '700' as const },
  wwDivider: { width: 1, height: 30, backgroundColor: Colors.borderLight },
  cycleCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  cycleHeader: { marginBottom: 12 },
  cycleTitle: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  cycleGrid: { flexDirection: 'row', gap: 8 },
  cyclePhaseItem: { flex: 1, alignItems: 'center', backgroundColor: Colors.surfaceSecondary, borderRadius: 10, padding: 10, gap: 4 },
  cyclePhaseDot: { width: 8, height: 8, borderRadius: 4 },
  cyclePhaseName: { fontSize: 10, fontWeight: '600' as const, color: Colors.textSecondary },
  cyclePhaseValue: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  cyclePhaseSamples: { fontSize: 9, color: Colors.textTertiary },
  sectionTitle: { fontSize: 17, fontWeight: '700' as const, color: Colors.text, marginBottom: 12, marginTop: 4 },
  metricPicker: { marginBottom: 20 },
  metricChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.surfaceSecondary,
    marginRight: 8,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  metricChipSyncing: { opacity: 0.5 },
  syncingTag: { fontSize: 10, fontStyle: 'italic' as const, color: Colors.textTertiary },
  metricChipText: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    gap: 12,
  },
  metricRowActive: { borderWidth: 1.5, borderColor: Colors.primary + '40' },
  metricRowIcon: { width: 32, height: 32, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  metricRowLabel: { flex: 1, fontSize: 14, fontWeight: '500' as const, color: Colors.text },
  metricRowTrend: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metricRowChange: { fontSize: 13, fontWeight: '700' as const },
  correlationCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: Colors.primary,
  },
  correlationText: { flex: 1, fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
});
