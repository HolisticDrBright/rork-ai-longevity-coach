import { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
} from 'react-native';
import {
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Eye,
  Lightbulb,
  CheckCircle,
  AlertCircle,
  Link,
  BarChart3,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useWearables } from '@/providers/WearablesProvider';
import { InsightMessage, CorrelationResult, PatternDetection } from '@/types/wearables';

const insightTypeConfig: Record<string, { color: string; bgColor: string; label: string }> = {
  observation: { color: '#6B7280', bgColor: '#F3F4F6', label: 'Observation' },
  correlation: { color: '#2563EB', bgColor: '#EFF6FF', label: 'Correlation' },
  positive: { color: '#059669', bgColor: '#ECFDF5', label: 'Positive' },
  warning: { color: '#D97706', bgColor: '#FFFBEB', label: 'Warning' },
  escalation: { color: '#DC2626', bgColor: '#FEF2F2', label: 'Action Needed' },
};

const confidenceBadge: Record<string, { color: string; bg: string }> = {
  low: { color: '#9CA3AF', bg: '#F3F4F6' },
  moderate: { color: '#D97706', bg: '#FFFBEB' },
  high: { color: '#059669', bg: '#ECFDF5' },
};

export default function InsightsDetailScreen() {
  const { insights, recommendation } = useWearables();

  const patterns = recommendation?.patterns ?? [];
  const correlations = recommendation?.correlations ?? [];

  const sortedInsights = useMemo(() => {
    return [...insights].sort((a, b) => a.priority - b.priority);
  }, [insights]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.pageDescription}>
        AI-generated insights based on your wearable data, nutrition, supplements, and symptom patterns. These are wellness observations, not medical diagnoses.
      </Text>

      {sortedInsights.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Key Insights</Text>
          {sortedInsights.map((insight) => (
            <InsightCard key={insight.id} insight={insight} />
          ))}
        </>
      )}

      {patterns.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Detected Patterns</Text>
          {patterns.map((pattern) => (
            <PatternCard key={pattern.id} pattern={pattern} />
          ))}
        </>
      )}

      {correlations.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Data Correlations</Text>
          {correlations.map((cor) => (
            <CorrelationCard key={cor.id} correlation={cor} />
          ))}
        </>
      )}

      {sortedInsights.length === 0 && patterns.length === 0 && correlations.length === 0 && (
        <View style={styles.emptyState}>
          <BarChart3 size={48} color={Colors.textTertiary} />
          <Text style={styles.emptyTitle}>Building your insights</Text>
          <Text style={styles.emptyText}>
            Keep logging your data for a few more days. The system needs at least 7 days of data to generate meaningful patterns and correlations.
          </Text>
        </View>
      )}

      <View style={styles.disclaimer}>
        <Text style={styles.disclaimerText}>
          Insights use cautious language for associations. Correlations do not imply causation. These observations are for wellness optimization and should be discussed with your healthcare practitioner for clinical decisions.
        </Text>
      </View>
    </ScrollView>
  );
}

function InsightCard({ insight }: { insight: InsightMessage }) {
  const config = insightTypeConfig[insight.type] ?? insightTypeConfig.observation;
  const confBadge = confidenceBadge[insight.confidence] ?? confidenceBadge.low;

  const InsightIcon = insight.type === 'positive' ? CheckCircle
    : insight.type === 'warning' ? AlertCircle
    : insight.type === 'escalation' ? AlertTriangle
    : insight.type === 'correlation' ? Link
    : Eye;

  return (
    <View style={[styles.insightCard, { borderLeftColor: config.color }]}>
      <View style={styles.insightHeader}>
        <View style={[styles.insightIconWrap, { backgroundColor: config.bgColor }]}>
          <InsightIcon size={16} color={config.color} />
        </View>
        <View style={styles.insightHeaderText}>
          <Text style={styles.insightTitle}>{insight.title}</Text>
          <View style={styles.insightBadges}>
            <View style={[styles.badge, { backgroundColor: config.bgColor }]}>
              <Text style={[styles.badgeText, { color: config.color }]}>{config.label}</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: confBadge.bg }]}>
              <Text style={[styles.badgeText, { color: confBadge.color }]}>{insight.confidence} confidence</Text>
            </View>
          </View>
        </View>
      </View>
      <Text style={styles.insightBody}>{insight.body}</Text>
      {insight.actionSuggestion && (
        <View style={styles.actionSuggestion}>
          <Lightbulb size={14} color={Colors.accent} />
          <Text style={styles.actionSuggestionText}>{insight.actionSuggestion}</Text>
        </View>
      )}
      {insight.relatedFactors.length > 0 && (
        <View style={styles.factorRow}>
          {insight.relatedFactors.map((f, i) => (
            <View key={i} style={styles.factorChip}>
              <Text style={styles.factorText}>{f.replace(/_/g, ' ')}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function PatternCard({ pattern }: { pattern: PatternDetection }) {
  const severityColors: Record<string, { color: string; bg: string }> = {
    mild: { color: '#D97706', bg: '#FFFBEB' },
    moderate: { color: '#EA580C', bg: '#FFF7ED' },
    severe: { color: '#DC2626', bg: '#FEF2F2' },
  };
  const sev = severityColors[pattern.severity] ?? severityColors.mild;

  return (
    <View style={[styles.patternCard, { borderLeftColor: sev.color }]}>
      <View style={styles.patternHeader}>
        <View style={[styles.badge, { backgroundColor: sev.bg }]}>
          <Text style={[styles.badgeText, { color: sev.color }]}>{pattern.severity}</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: confidenceBadge[pattern.confidence]?.bg ?? '#F3F4F6' }]}>
          <Text style={[styles.badgeText, { color: confidenceBadge[pattern.confidence]?.color ?? '#9CA3AF' }]}>
            {pattern.confidence}
          </Text>
        </View>
        {pattern.escalationNeeded && (
          <View style={[styles.badge, { backgroundColor: '#FEF2F2' }]}>
            <AlertTriangle size={10} color="#DC2626" />
            <Text style={[styles.badgeText, { color: '#DC2626' }]}>Escalation</Text>
          </View>
        )}
      </View>
      <Text style={styles.patternDescription}>{pattern.description}</Text>
      <View style={styles.patternFactors}>
        {pattern.factors.map((f, i) => (
          <View key={i} style={styles.factorChip}>
            <Text style={styles.factorText}>{f.replace(/_/g, ' ')}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.patternDays}>Persisting: {pattern.daysPersisting} days</Text>
    </View>
  );
}

function CorrelationCard({ correlation }: { correlation: CorrelationResult }) {
  const isPositive = correlation.direction === 'positive';
  const strengthLabel = correlation.strength > 0.7 ? 'Strong' : correlation.strength > 0.4 ? 'Moderate' : 'Weak';
  const confBadge = confidenceBadge[correlation.confidence] ?? confidenceBadge.low;

  return (
    <View style={styles.correlationCard}>
      <View style={styles.correlationHeader}>
        <View style={styles.correlationFactors}>
          <Text style={styles.correlationFactorA}>{correlation.factorA}</Text>
          {isPositive
            ? <TrendingUp size={16} color="#059669" />
            : <TrendingDown size={16} color="#DC2626" />
          }
          <Text style={styles.correlationFactorB}>{correlation.factorB}</Text>
        </View>
      </View>
      <Text style={styles.correlationInsight}>{correlation.insight}</Text>
      <View style={styles.correlationMeta}>
        <View style={[styles.badge, { backgroundColor: confBadge.bg }]}>
          <Text style={[styles.badgeText, { color: confBadge.color }]}>{correlation.confidence}</Text>
        </View>
        <Text style={styles.correlationStrength}>{strengthLabel} ({(correlation.strength * 100).toFixed(0)}%)</Text>
        <Text style={styles.correlationDataPoints}>{correlation.dataPoints} data points</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 40 },
  pageDescription: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19, marginBottom: 20 },
  sectionTitle: { fontSize: 17, fontWeight: '700' as const, color: Colors.text, marginBottom: 12, marginTop: 8 },
  insightCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  insightHeader: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  insightIconWrap: { width: 32, height: 32, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  insightHeaderText: { flex: 1 },
  insightTitle: { fontSize: 14, fontWeight: '700' as const, color: Colors.text, marginBottom: 4 },
  insightBadges: { flexDirection: 'row', gap: 6 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 10, fontWeight: '600' as const },
  insightBody: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19, marginBottom: 10 },
  actionSuggestion: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FFFBEB',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  actionSuggestionText: { flex: 1, fontSize: 12, color: '#92400E', lineHeight: 17 },
  factorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  factorChip: { backgroundColor: Colors.surfaceSecondary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  factorText: { fontSize: 10, color: Colors.textTertiary, fontWeight: '500' as const },
  patternCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  patternHeader: { flexDirection: 'row', gap: 6, marginBottom: 10 },
  patternDescription: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19, marginBottom: 10 },
  patternFactors: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  patternDays: { fontSize: 11, color: Colors.textTertiary },
  correlationCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 3,
    borderLeftColor: Colors.primary,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  correlationHeader: { marginBottom: 10 },
  correlationFactors: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  correlationFactorA: { fontSize: 13, fontWeight: '600' as const, color: Colors.text },
  correlationFactorB: { fontSize: 13, fontWeight: '600' as const, color: Colors.text },
  correlationInsight: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19, marginBottom: 10 },
  correlationMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  correlationStrength: { fontSize: 11, color: Colors.textTertiary, fontWeight: '500' as const },
  correlationDataPoints: { fontSize: 11, color: Colors.textTertiary },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  emptyText: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20, paddingHorizontal: 20 },
  disclaimer: { padding: 14, backgroundColor: Colors.surfaceSecondary, borderRadius: 10, marginTop: 12, marginBottom: 20 },
  disclaimerText: { fontSize: 11, color: Colors.textTertiary, lineHeight: 16, textAlign: 'center' },
});
