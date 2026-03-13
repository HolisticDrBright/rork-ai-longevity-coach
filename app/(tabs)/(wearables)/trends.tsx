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
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useWearables } from '@/providers/WearablesProvider';
import { TrendDirection } from '@/types/wearables';

const SCREEN_WIDTH = Dimensions.get('window').width;

type TimeRange = 7 | 14 | 30;

const metricConfigs = [
  { key: 'hrv', label: 'HRV', unit: 'ms', icon: Heart, color: '#4A90D9', higherBetter: true },
  { key: 'restingHr', label: 'Resting HR', unit: 'bpm', icon: Activity, color: '#E76F51', higherBetter: false },
  { key: 'sleepScore', label: 'Sleep Score', unit: '', icon: Moon, color: '#7C3AED', higherBetter: true },
  { key: 'sleepDuration', label: 'Sleep Duration', unit: 'h', icon: Moon, color: '#2563EB', higherBetter: true },
  { key: 'steps', label: 'Steps', unit: '', icon: Activity, color: '#16A34A', higherBetter: true },
  { key: 'readinessScore', label: 'Readiness', unit: '', icon: Target, color: '#0D9488', higherBetter: true },
  { key: 'adherenceScore', label: 'Adherence', unit: '%', icon: Target, color: '#F59E0B', higherBetter: true },
  { key: 'energyScore', label: 'Energy', unit: '/10', icon: Zap, color: '#F97316', higherBetter: true },
  { key: 'moodScore', label: 'Mood', unit: '/10', icon: Brain, color: '#8B5CF6', higherBetter: true },
  { key: 'sorenessScore', label: 'Soreness', unit: '/10', icon: Flame, color: '#DC2626', higherBetter: false },
];

const trendIcons: Record<TrendDirection, { icon: typeof TrendingUp; color: string; label: string }> = {
  improving: { icon: TrendingUp, color: '#059669', label: 'Improving' },
  stable: { icon: Minus, color: '#6B7280', label: 'Stable' },
  declining: { icon: TrendingDown, color: '#DC2626', label: 'Declining' },
  insufficient_data: { icon: BarChart3, color: '#9CA3AF', label: 'Insufficient data' },
};

export default function TrendsScreen() {
  const { getTrendSeries, records } = useWearables();
  const [timeRange, setTimeRange] = useState<TimeRange>(14);
  const [selectedMetric, setSelectedMetric] = useState<string>('hrv');

  const handleTimeRange = useCallback((range: TimeRange) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTimeRange(range);
  }, []);

  const handleMetric = useCallback((key: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedMetric(key);
  }, []);

  const trendData = useMemo(() => getTrendSeries(selectedMetric, timeRange), [getTrendSeries, selectedMetric, timeRange]);
  const metricConfig = metricConfigs.find(m => m.key === selectedMetric)!;

  const allTrends = useMemo(() => {
    return metricConfigs.map(mc => {
      const series = getTrendSeries(mc.key, timeRange);
      return { ...mc, direction: series.direction, changePercent: series.changePercent };
    });
  }, [getTrendSeries, timeRange]);

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

      <Text style={styles.sectionTitle}>Select Metric</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.metricPicker}>
        {metricConfigs.map(mc => {
          const IconComp = mc.icon;
          const isSelected = selectedMetric === mc.key;
          return (
            <TouchableOpacity
              key={mc.key}
              style={[styles.metricChip, isSelected && { backgroundColor: mc.color + '18', borderColor: mc.color }]}
              onPress={() => handleMetric(mc.key)}
            >
              <IconComp size={14} color={isSelected ? mc.color : Colors.textTertiary} />
              <Text style={[styles.metricChipText, isSelected && { color: mc.color }]}>{mc.label}</Text>
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
    marginBottom: 20,
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
