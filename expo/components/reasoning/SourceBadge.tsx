import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  Activity,
  BookOpen,
  Bot,
  Cog,
  MessageCircle,
  Stethoscope,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import {
  REVIEW_STATUS_LABELS,
  SOURCE_TYPE_LABELS,
  type ReasoningReviewStatus,
  type ReasoningSourceType,
} from '@/types/reasoning';

// Visual fact–inference separation: every reasoning surface tags its origin.
const SOURCE_STYLES: Record<
  ReasoningSourceType,
  { color: string; background: string; Icon: React.ComponentType<{ size?: number; color?: string }> }
> = {
  measured: { color: '#0D5C63', background: '#E1F0F1', Icon: Activity },
  patient_reported: { color: '#7A5AA0', background: '#F0E9F8', Icon: MessageCircle },
  practitioner_entered: { color: '#1D6F42', background: '#E3F2E8', Icon: Stethoscope },
  published_evidence: { color: '#8A6D1D', background: '#F7F0DC', Icon: BookOpen },
  ai_inference: { color: '#B4530A', background: '#FDEBDD', Icon: Bot },
  rule_engine: { color: '#4A5568', background: '#E9EDF2', Icon: Cog },
};

export function SourceBadge({
  sourceType,
  compact = false,
}: {
  sourceType: ReasoningSourceType;
  compact?: boolean;
}) {
  const style = SOURCE_STYLES[sourceType] ?? SOURCE_STYLES.measured;
  const Icon = style.Icon;
  return (
    <View style={[styles.badge, { backgroundColor: style.background }]} testID={`source-badge-${sourceType}`}>
      <Icon size={compact ? 10 : 12} color={style.color} />
      {!compact && (
        <Text style={[styles.badgeText, { color: style.color }]}>
          {SOURCE_TYPE_LABELS[sourceType] ?? sourceType}
        </Text>
      )}
    </View>
  );
}

const REVIEW_STYLES: Record<ReasoningReviewStatus, { color: string; background: string }> = {
  not_required: { color: Colors.textTertiary, background: Colors.surfaceSecondary },
  pending_review: { color: '#B4530A', background: '#FDEBDD' },
  accepted: { color: '#1D6F42', background: '#E3F2E8' },
  modified: { color: '#8A6D1D', background: '#F7F0DC' },
  rejected: { color: '#B3261E', background: '#FBE4E2' },
};

export function ReviewStatusPill({ status }: { status: ReasoningReviewStatus }) {
  const style = REVIEW_STYLES[status] ?? REVIEW_STYLES.not_required;
  return (
    <View style={[styles.badge, { backgroundColor: style.background }]} testID={`review-pill-${status}`}>
      <Text style={[styles.badgeText, { color: style.color }]}>{REVIEW_STATUS_LABELS[status] ?? status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    alignSelf: 'flex-start',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
});
