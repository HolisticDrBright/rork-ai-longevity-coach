import React from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  FlaskConical,
  Minus,
  Pill,
  Target,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { SourceBadge } from './SourceBadge';
import type { ReasoningSourceType } from '@/types/reasoning';

// Shapes mirror twin.get's return (kept structural so the component stays dumb).
export interface TwinSystemStateView {
  key: string;
  label: string;
  score: number | null;
  trend: 'improving' | 'stable' | 'worsening' | 'unknown';
  contributors: { summary: string; direction: 'concern' | 'reassuring'; sourceType: ReasoningSourceType; observedAt?: string }[];
  contradictions: string[];
  dataQuality: number;
  missingData: string[];
  reviewStatus: 'none_pending' | 'pending_review';
  hypotheses: { id: string; name: string; supportScore: number; status: string }[];
}

export interface TwinCurrentStateView {
  goals: string[];
  activeSymptoms: { name: string; severity: number | null; lastLoggedAt: string }[];
  medications: string[];
  supplements: string[];
  risks: { summary: string; severity: string; source: ReasoningSourceType }[];
  abnormalBiomarkers: {
    name: string;
    value: number;
    unit?: string;
    referenceLow?: number | null;
    referenceHigh?: number | null;
    collectedAt: string;
  }[];
  patterns: {
    avgSleepMinutes: number | null;
    avgHrv: number | null;
    avgRestingHr: number | null;
    avgSteps: number | null;
    checkinDays: number;
  };
}

function scoreColor(score: number | null): string {
  if (score === null) return Colors.textTertiary;
  if (score >= 75) return Colors.success;
  if (score >= 50) return Colors.warning;
  return Colors.danger;
}

function TrendIcon({ trend }: { trend: TwinSystemStateView['trend'] }) {
  if (trend === 'improving') return <ArrowUpRight size={14} color={Colors.success} />;
  if (trend === 'worsening') return <ArrowDownRight size={14} color={Colors.danger} />;
  if (trend === 'stable') return <Minus size={14} color={Colors.textTertiary} />;
  return null;
}

export function TwinCurrentStateCard({ state }: { state: TwinCurrentStateView }) {
  const p = state.patterns;
  return (
    <View style={styles.card} testID="twin-current-state">
      <Text style={styles.cardTitle}>Current state</Text>

      {state.goals.length > 0 && (
        <View style={styles.row}>
          <Target size={14} color={Colors.primary} />
          <Text style={styles.rowText}>{state.goals.join(' · ')}</Text>
        </View>
      )}

      {state.risks.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>Active risks & changes</Text>
          {state.risks.slice(0, 5).map((r, i) => (
            <View key={`${r.summary}-${i}`} style={styles.row}>
              <AlertTriangle size={14} color={Colors.warning} />
              <Text style={styles.rowText}>{r.summary}</Text>
            </View>
          ))}
        </>
      )}

      {state.abnormalBiomarkers.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>Biomarkers outside range</Text>
          {state.abnormalBiomarkers.slice(0, 6).map((b) => (
            <View key={b.name} style={styles.row}>
              <FlaskConical size={14} color={Colors.coral} />
              <Text style={styles.rowText}>
                {b.name}: {b.value}
                {b.unit ? ` ${b.unit}` : ''}
                {b.referenceLow != null || b.referenceHigh != null
                  ? ` (ref ${b.referenceLow ?? '—'}–${b.referenceHigh ?? '—'})`
                  : ''}
              </Text>
            </View>
          ))}
        </>
      )}

      {state.activeSymptoms.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>Recent symptoms</Text>
          <Text style={styles.inlineList}>
            {state.activeSymptoms
              .slice(0, 6)
              .map((s) => `${s.name}${s.severity != null ? ` (${s.severity}/10)` : ''}`)
              .join(' · ')}
          </Text>
        </>
      )}

      {(state.medications.length > 0 || state.supplements.length > 0) && (
        <>
          <Text style={styles.sectionLabel}>Medications & supplements</Text>
          <View style={styles.row}>
            <Pill size={14} color={Colors.textSecondary} />
            <Text style={styles.rowText}>
              {[...state.medications, ...state.supplements].slice(0, 10).join(' · ') || '—'}
            </Text>
          </View>
        </>
      )}

      <Text style={styles.sectionLabel}>7-day patterns</Text>
      <View style={styles.row}>
        <Activity size={14} color={Colors.textSecondary} />
        <Text style={styles.rowText}>
          {[
            p.avgSleepMinutes != null ? `Sleep ${Math.round(p.avgSleepMinutes / 6) / 10}h` : null,
            p.avgHrv != null ? `HRV ${p.avgHrv}` : null,
            p.avgRestingHr != null ? `RHR ${p.avgRestingHr}` : null,
            p.avgSteps != null ? `${p.avgSteps} steps` : null,
          ]
            .filter(Boolean)
            .join(' · ') || `No wearable data in the last 7 days`}
        </Text>
      </View>
    </View>
  );
}

export function TwinSystemsGrid({ systems }: { systems: TwinSystemStateView[] }) {
  const { width } = useWindowDimensions();
  const columns = width >= 1100 ? 3 : width >= 720 ? 2 : 1;

  return (
    <View style={[styles.grid, { gap: 12 }]} testID="twin-systems-grid">
      {systems.map((s) => (
        <View key={s.key} style={[styles.systemCard, { flexBasis: `${100 / columns - 2}%` as unknown as number }]}>
          <View style={styles.systemHeader}>
            <Text style={styles.systemLabel} numberOfLines={2}>
              {s.label}
            </Text>
            <TrendIcon trend={s.trend} />
          </View>

          <View style={styles.scoreRow}>
            <Text style={[styles.scoreValue, { color: scoreColor(s.score) }]}>
              {s.score === null ? '—' : s.score}
            </Text>
            <Text style={styles.scoreLabel}>{s.score === null ? 'insufficient data' : 'support level'}</Text>
          </View>
          {s.score !== null && (
            <View style={styles.scoreTrack}>
              <View
                style={[
                  styles.scoreFill,
                  { width: `${Math.max(2, Math.min(100, s.score))}%`, backgroundColor: scoreColor(s.score) },
                ]}
              />
            </View>
          )}

          {s.contributors
            .filter((c) => c.direction === 'concern')
            .slice(0, 3)
            .map((c, i) => (
              <View key={`${c.summary}-${i}`} style={styles.contributorRow}>
                <SourceBadge sourceType={c.sourceType} compact />
                <Text style={styles.contributorText} numberOfLines={2}>
                  {c.summary}
                </Text>
              </View>
            ))}

          {s.hypotheses.length > 0 && (
            <Text style={styles.hypothesisNote} numberOfLines={2}>
              {s.hypotheses.length} hypothesis(es): {s.hypotheses.map((h) => h.name).join('; ')}
            </Text>
          )}

          {s.missingData.length > 0 && (
            <Text style={styles.missingText} numberOfLines={2}>
              Missing: {s.missingData.join('; ')}
            </Text>
          )}

          <View style={styles.systemFooter}>
            <Text style={styles.footerText}>Data quality {Math.round(s.dataQuality * 100)}%</Text>
            {s.reviewStatus === 'pending_review' && (
              <Text style={[styles.footerText, { color: '#B4530A' }]}>Pending review</Text>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

export function TwinDisclaimer() {
  return (
    <Text style={styles.disclaimer}>
      The Adaptive Health Twin is a personalized response model built from your own measurements, reports and
      practitioner input. Support levels reflect current data coverage and findings — they are not diagnoses
      and not a biological simulation.
    </Text>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    padding: 14,
    marginBottom: 14,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: Colors.text, marginBottom: 8 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 12,
    marginBottom: 6,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  rowText: { flex: 1, fontSize: 13, color: Colors.text, lineHeight: 18 },
  inlineList: { fontSize: 13, color: Colors.text, lineHeight: 19 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  systemCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    padding: 13,
    flexGrow: 1,
    minWidth: 260,
  },
  systemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 },
  systemLabel: { flex: 1, fontSize: 13.5, fontWeight: '700', color: Colors.text },
  scoreRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 8 },
  scoreValue: { fontSize: 22, fontWeight: '800' },
  scoreLabel: { fontSize: 11, color: Colors.textTertiary },
  scoreTrack: { height: 5, borderRadius: 3, backgroundColor: Colors.surfaceSecondary, overflow: 'hidden', marginTop: 4, marginBottom: 8 },
  scoreFill: { height: 5, borderRadius: 3 },
  contributorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  contributorText: { flex: 1, fontSize: 12, color: Colors.textSecondary, lineHeight: 16 },
  hypothesisNote: { fontSize: 11.5, color: Colors.primaryDark, marginTop: 8, lineHeight: 15 },
  missingText: { fontSize: 11.5, color: Colors.textTertiary, fontStyle: 'italic', marginTop: 6, lineHeight: 15 },
  systemFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  footerText: { fontSize: 10.5, color: Colors.textTertiary },
  disclaimer: {
    fontSize: 11,
    color: Colors.textTertiary,
    fontStyle: 'italic',
    lineHeight: 16,
    marginTop: 4,
    marginBottom: 24,
  },
});
