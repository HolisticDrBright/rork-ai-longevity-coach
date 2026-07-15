import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react-native';
import Colors from '@/constants/colors';
import type { ClinicalHypothesis } from '@/types/reasoning';
import { ReviewStatusPill, SourceBadge } from './SourceBadge';

const STATUS_LABELS: Record<ClinicalHypothesis['status'], string> = {
  proposed: 'Proposed',
  under_review: 'Under review',
  supported: 'Supported',
  weakened: 'Weakened',
  unresolved: 'Unresolved',
  rejected: 'Rejected',
  archived: 'Archived',
};

export function HypothesisCard({
  hypothesis,
  onPress,
  selected = false,
}: {
  hypothesis: ClinicalHypothesis;
  onPress?: () => void;
  selected?: boolean;
}) {
  const supporting = hypothesis.supportingEvidence?.length ?? 0;
  const contradicting = hypothesis.contradictingEvidence?.length ?? 0;
  const scoreDelta =
    hypothesis.priorSupportScore !== undefined && hypothesis.priorSupportScore !== null
      ? hypothesis.supportScore - hypothesis.priorSupportScore
      : 0;

  return (
    <TouchableOpacity
      style={[styles.card, selected && styles.cardSelected]}
      onPress={onPress}
      disabled={!onPress}
      testID={`hypothesis-card-${hypothesis.id}`}
    >
      <View style={styles.headerRow}>
        <Text style={styles.name} numberOfLines={2}>
          {hypothesis.name}
        </Text>
        <Text style={styles.statusText}>{STATUS_LABELS[hypothesis.status]}</Text>
      </View>

      <View style={styles.badgeRow}>
        <SourceBadge sourceType={hypothesis.sourceType} />
        <ReviewStatusPill status={hypothesis.reviewStatus} />
      </View>

      {/* "Support level" — reasoning strength, deliberately NOT a probability */}
      <View style={styles.scoreRow}>
        <Text style={styles.scoreLabel}>Support level</Text>
        <Text style={styles.scoreValue}>
          {hypothesis.supportScore}/100
          {scoreDelta !== 0 && (
            <Text style={[styles.delta, { color: scoreDelta > 0 ? Colors.success : Colors.danger }]}>
              {'  '}
              {scoreDelta > 0 ? '▲' : '▼'} {Math.abs(scoreDelta)}
            </Text>
          )}
        </Text>
      </View>
      <View style={styles.scoreTrack}>
        <View style={[styles.scoreFill, { width: `${Math.max(2, Math.min(100, hypothesis.supportScore))}%` }]} />
      </View>

      <View style={styles.evidenceRow}>
        <View style={styles.evidenceItem}>
          <CheckCircle2 size={13} color={Colors.success} />
          <Text style={styles.evidenceText}>{supporting} supporting</Text>
        </View>
        <View style={styles.evidenceItem}>
          <AlertTriangle size={13} color={Colors.coral} />
          <Text style={styles.evidenceText}>{contradicting} contradicting</Text>
        </View>
        {hypothesis.missingEvidence.length > 0 && (
          <View style={styles.evidenceItem}>
            <HelpCircle size={13} color={Colors.textTertiary} />
            <Text style={styles.evidenceText}>{hypothesis.missingEvidence.length} missing</Text>
          </View>
        )}
      </View>

      {hypothesis.scoreChangeReason ? (
        <Text style={styles.changeReason} numberOfLines={2}>
          {hypothesis.scoreChangeReason}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  cardSelected: {
    borderColor: Colors.primary,
    borderWidth: 2,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  name: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
    flexWrap: 'wrap',
  },
  scoreRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    marginBottom: 4,
  },
  scoreLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  scoreValue: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.text,
  },
  delta: {
    fontSize: 11,
    fontWeight: '700',
  },
  scoreTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.surfaceSecondary,
    overflow: 'hidden',
  },
  scoreFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.primary,
  },
  evidenceRow: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 10,
    flexWrap: 'wrap',
  },
  evidenceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  evidenceText: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  changeReason: {
    marginTop: 8,
    fontSize: 12,
    color: Colors.textTertiary,
    fontStyle: 'italic',
  },
});
