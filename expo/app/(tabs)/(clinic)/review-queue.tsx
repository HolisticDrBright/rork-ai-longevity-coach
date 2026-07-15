import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { CheckCircle2, ShieldQuestion, XCircle } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { featureFlags } from '@/lib/featureFlags';
import type { PractitionerReview } from '@/types/reasoning';

const PRIORITY_COLORS: Record<PractitionerReview['priority'], string> = {
  routine: Colors.textTertiary,
  elevated: Colors.warning,
  urgent: Colors.danger,
};

export default function ReviewQueueScreen() {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const utils = trpc.useUtils();

  const queueQuery = trpc.reasoning.reviews.listQueue.useQuery(
    { status: 'pending' },
    { enabled: featureFlags.clinicalReasoning }
  );

  const decide = trpc.reasoning.reviews.decide.useMutation({
    onSuccess: () => void utils.reasoning.reviews.listQueue.invalidate(),
    onError: (e) => Alert.alert('Decision failed', e.message),
  });

  if (!featureFlags.clinicalReasoning) {
    return (
      <View style={styles.center}>
        <Text style={styles.mutedText}>Review queue is not enabled in this build.</Text>
      </View>
    );
  }

  const reviews = queueQuery.data ?? [];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={queueQuery.isRefetching} onRefresh={() => queueQuery.refetch()} />}
      testID="review-queue-screen"
    >
      <Text style={styles.subtitle}>
        System- and AI-generated findings wait here until a practitioner accepts, modifies or rejects them.
        Nothing below has been shown to patients as a conclusion.
      </Text>

      {queueQuery.isLoading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: 32 }} />
      ) : reviews.length === 0 ? (
        <View style={styles.center}>
          <ShieldQuestion size={32} color={Colors.textTertiary} />
          <Text style={styles.emptyTitle}>Queue is clear</Text>
          <Text style={styles.mutedText}>New findings appear here after each analysis run.</Text>
        </View>
      ) : (
        reviews.map((review) => (
          <View key={review.id} style={styles.card} testID={`review-card-${review.id}`}>
            <View style={styles.cardHeader}>
              <View style={[styles.priorityDot, { backgroundColor: PRIORITY_COLORS[review.priority] }]} />
              <Text style={styles.cardType}>
                {review.subjectType.replace(/_/g, ' ')} · patient {review.patientId.slice(0, 8)}
              </Text>
              <Text style={styles.cardDate}>{new Date(review.createdAt).toLocaleDateString()}</Text>
            </View>
            <Text style={styles.cardSummary}>{review.proposedSummary}</Text>

            <TextInput
              style={styles.noteInput}
              placeholder="Rationale / note (optional)"
              placeholderTextColor={Colors.textTertiary}
              value={notes[review.id] ?? ''}
              onChangeText={(t) => setNotes((prev) => ({ ...prev, [review.id]: t }))}
            />

            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[styles.actionButton, styles.acceptButton]}
                disabled={decide.isPending}
                onPress={() => decide.mutate({ reviewId: review.id, decision: 'accepted', note: notes[review.id] })}
                testID={`review-accept-${review.id}`}
              >
                <CheckCircle2 size={14} color={Colors.textInverse} />
                <Text style={styles.actionText}>Accept</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, styles.rejectButton]}
                disabled={decide.isPending}
                onPress={() => decide.mutate({ reviewId: review.id, decision: 'rejected', note: notes[review.id] })}
                testID={`review-reject-${review.id}`}
              >
                <XCircle size={14} color={Colors.textInverse} />
                <Text style={styles.actionText}>Reject</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, styles.dismissButton]}
                disabled={decide.isPending}
                onPress={() => decide.mutate({ reviewId: review.id, decision: 'dismissed', note: notes[review.id] })}
              >
                <Text style={[styles.actionText, { color: Colors.textSecondary }]}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 48 },
  subtitle: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19, marginBottom: 14 },
  center: { alignItems: 'center', paddingVertical: 40, gap: 8 },
  emptyTitle: { fontSize: 15, fontWeight: '600', color: Colors.text },
  mutedText: { fontSize: 13, color: Colors.textTertiary, textAlign: 'center' },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    padding: 14,
    marginBottom: 12,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  priorityDot: { width: 8, height: 8, borderRadius: 4 },
  cardType: { flex: 1, fontSize: 12, fontWeight: '600', color: Colors.textSecondary, textTransform: 'capitalize' },
  cardDate: { fontSize: 11, color: Colors.textTertiary },
  cardSummary: { fontSize: 14, color: Colors.text, lineHeight: 20, marginBottom: 10 },
  noteInput: {
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: Colors.text,
    marginBottom: 10,
  },
  actionRow: { flexDirection: 'row', gap: 8 },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  acceptButton: { backgroundColor: Colors.success },
  rejectButton: { backgroundColor: Colors.danger },
  dismissButton: { backgroundColor: Colors.surfaceSecondary },
  actionText: { color: Colors.textInverse, fontSize: 13, fontWeight: '600' },
});
