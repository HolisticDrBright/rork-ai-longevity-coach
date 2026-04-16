import { View, Text, StyleSheet, ScrollView } from 'react-native';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
  Heart,
  Moon,
  Zap,
  Droplets,
  BarChart3,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import type { InsightDirection, CorrelationConfidence } from '@/types';

interface CorrelationInsight {
  metricName: string;
  baselineValue?: number;
  currentValue?: number;
  changePercent?: number;
  direction: InsightDirection;
  confidence: CorrelationConfidence;
  aiExplanation?: string;
  insightType: 'biomarker' | 'wearable' | 'composite';
}

interface WearableEffectiveness {
  metric: string;
  baseline: number;
  current: number;
  delta: number;
  deltaPercent: number;
  direction: InsightDirection;
}

const DIRECTION_CONFIG: Record<InsightDirection, { color: string; icon: any; label: string }> = {
  improved: { color: Colors.success, icon: TrendingUp, label: 'Improved' },
  declined: { color: Colors.danger, icon: TrendingDown, label: 'Declined' },
  stable: { color: Colors.textTertiary, icon: Minus, label: 'Stable' },
};

const CONFIDENCE_LABEL: Record<CorrelationConfidence, string> = {
  strong: 'Strong correlation',
  moderate: 'Moderate correlation',
  weak: 'Weak correlation',
};

const METRIC_ICONS: Record<string, any> = {
  'HRV': Activity,
  'Resting Heart Rate': Heart,
  'Deep Sleep': Moon,
  'REM Sleep': Moon,
  'Total Sleep': Moon,
  'Recovery Score': Zap,
  'SpO2': Droplets,
  'Daily Steps': Activity,
};

function InsightCard({ insight }: { insight: CorrelationInsight }) {
  const dir = DIRECTION_CONFIG[insight.direction];
  const DirIcon = dir.icon;
  const MetricIcon = METRIC_ICONS[insight.metricName] ?? BarChart3;

  return (
    <View style={styles.insightCard}>
      <View style={styles.insightHeader}>
        <MetricIcon color={Colors.primary} size={18} />
        <Text style={styles.insightMetric}>{insight.metricName}</Text>
        <View style={[styles.directionBadge, { backgroundColor: dir.color + '15' }]}>
          <DirIcon color={dir.color} size={14} />
          <Text style={[styles.directionText, { color: dir.color }]}>{dir.label}</Text>
        </View>
      </View>

      {insight.baselineValue != null && insight.currentValue != null && (
        <View style={styles.valuesRow}>
          <View style={styles.valueBox}>
            <Text style={styles.valueLabel}>Baseline</Text>
            <Text style={styles.valueNumber}>{insight.baselineValue.toFixed(1)}</Text>
          </View>
          <View style={styles.arrowContainer}>
            <DirIcon color={dir.color} size={20} />
          </View>
          <View style={styles.valueBox}>
            <Text style={styles.valueLabel}>Current</Text>
            <Text style={[styles.valueNumber, { color: dir.color }]}>{insight.currentValue.toFixed(1)}</Text>
          </View>
          {insight.changePercent != null && (
            <View style={[styles.changeBadge, { backgroundColor: dir.color + '15' }]}>
              <Text style={[styles.changeText, { color: dir.color }]}>
                {insight.changePercent > 0 ? '+' : ''}{insight.changePercent.toFixed(1)}%
              </Text>
            </View>
          )}
        </View>
      )}

      {insight.aiExplanation && (
        <Text style={styles.explanationText}>{insight.aiExplanation}</Text>
      )}

      <Text style={styles.confidenceText}>{CONFIDENCE_LABEL[insight.confidence]}</Text>
    </View>
  );
}

function EffectivenessBar({ item }: { item: WearableEffectiveness }) {
  const dir = DIRECTION_CONFIG[item.direction];
  const barWidth = Math.min(Math.abs(item.deltaPercent), 100);

  return (
    <View style={styles.effectivenessRow}>
      <Text style={styles.effectivenessLabel}>{item.metric}</Text>
      <View style={styles.barContainer}>
        <View style={[styles.bar, { width: `${barWidth}%`, backgroundColor: dir.color }]} />
      </View>
      <Text style={[styles.effectivenessDelta, { color: dir.color }]}>
        {item.deltaPercent > 0 ? '+' : ''}{item.deltaPercent.toFixed(0)}%
      </Text>
    </View>
  );
}

interface Props {
  insights: CorrelationInsight[];
  wearableEffectiveness?: WearableEffectiveness[];
  effectivenessScore?: number;
  protocolName?: string;
}

export default function PeptideCorrelationDashboard({
  insights,
  wearableEffectiveness,
  effectivenessScore,
  protocolName,
}: Props) {
  const biomarkerInsights = insights.filter(i => i.insightType === 'biomarker');
  const wearableInsights = insights.filter(i => i.insightType === 'wearable');

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Effectiveness Score */}
      {effectivenessScore != null && (
        <View style={styles.scoreContainer}>
          <View style={styles.scoreCircle}>
            <Text style={styles.scoreNumber}>{effectivenessScore}</Text>
            <Text style={styles.scoreMax}>/100</Text>
          </View>
          <View style={styles.scoreInfo}>
            <Text style={styles.scoreTitle}>Protocol Effectiveness</Text>
            {protocolName && <Text style={styles.scoreSub}>{protocolName}</Text>}
          </View>
        </View>
      )}

      {/* Wearable Effectiveness Bars */}
      {wearableEffectiveness && wearableEffectiveness.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Wearable Impact</Text>
          <View style={styles.effectivenessCard}>
            {wearableEffectiveness.map((item, i) => (
              <EffectivenessBar key={i} item={item} />
            ))}
          </View>
        </View>
      )}

      {/* Wearable Insights */}
      {wearableInsights.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Wearable Correlations ({wearableInsights.length})</Text>
          {wearableInsights.map((insight, i) => (
            <InsightCard key={`w-${i}`} insight={insight} />
          ))}
        </View>
      )}

      {/* Biomarker Insights */}
      {biomarkerInsights.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Biomarker Correlations ({biomarkerInsights.length})</Text>
          {biomarkerInsights.map((insight, i) => (
            <InsightCard key={`b-${i}`} insight={insight} />
          ))}
        </View>
      )}

      {insights.length === 0 && (
        <View style={styles.emptyState}>
          <BarChart3 color={Colors.textTertiary} size={40} />
          <Text style={styles.emptyTitle}>No Correlations Yet</Text>
          <Text style={styles.emptySubtitle}>
            Correlations will appear after you upload new labs or capture wearable snapshots during your protocol.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scoreContainer: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
    backgroundColor: Colors.primary, borderRadius: 16, padding: 20, margin: 16,
  },
  scoreCircle: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center', flexDirection: 'row',
  },
  scoreNumber: { fontSize: 28, fontWeight: '800', color: '#fff' },
  scoreMax: { fontSize: 14, color: 'rgba(255,255,255,0.7)', marginTop: 8 },
  scoreInfo: { flex: 1 },
  scoreTitle: { fontSize: 18, fontWeight: '700', color: '#fff' },
  scoreSub: { fontSize: 13, color: 'rgba(255,255,255,0.8)', marginTop: 2 },
  section: { paddingHorizontal: 16, marginBottom: 16, gap: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.text },
  insightCard: {
    backgroundColor: Colors.surface, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: Colors.border, gap: 10,
  },
  insightHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  insightMetric: { fontSize: 15, fontWeight: '600', color: Colors.text, flex: 1 },
  directionBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  directionText: { fontSize: 12, fontWeight: '600' },
  valuesRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  valueBox: { alignItems: 'center' },
  valueLabel: { fontSize: 11, color: Colors.textTertiary },
  valueNumber: { fontSize: 20, fontWeight: '700', color: Colors.text },
  arrowContainer: { paddingHorizontal: 8 },
  changeBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, marginLeft: 'auto' },
  changeText: { fontSize: 14, fontWeight: '700' },
  explanationText: { fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  confidenceText: { fontSize: 11, color: Colors.textTertiary, fontStyle: 'italic' },
  effectivenessCard: {
    backgroundColor: Colors.surface, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: Colors.border, gap: 12,
  },
  effectivenessRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  effectivenessLabel: { width: 100, fontSize: 13, color: Colors.text, fontWeight: '500' },
  barContainer: { flex: 1, height: 8, backgroundColor: Colors.borderLight, borderRadius: 4 },
  bar: { height: 8, borderRadius: 4 },
  effectivenessDelta: { width: 50, textAlign: 'right', fontSize: 13, fontWeight: '700' },
  emptyState: { alignItems: 'center', padding: 40, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
  emptySubtitle: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
});
