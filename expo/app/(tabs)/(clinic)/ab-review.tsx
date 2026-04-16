import { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { Stack } from 'expo-router';
import {
  BeakerIcon,
  Cpu,
  Check,
  Minus,
  Star,
  Clock,
  AlertCircle,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';

interface AbEvaluation {
  id: string;
  patient_fixture_id: string;
  deterministic: any;
  claude: any;
  deterministic_generation_ms: number | null;
  claude_generation_ms: number | null;
  claude_model: string | null;
  claude_system_prompt_version: string | null;
  reviewer_score: number | null;
  reviewer_winner: 'deterministic' | 'claude' | 'tie' | 'neither' | null;
  reviewer_notes: string | null;
  generated_at: string;
  reviewed_at: string | null;
}

type Winner = 'deterministic' | 'claude' | 'tie' | 'neither';

const SCREEN_W = Dimensions.get('window').width;
const CARD_W = Math.min(420, SCREEN_W * 0.88);

function ProtocolPreview({ label, data, ms, icon: Icon, tint, failed }: {
  label: string;
  data: any;
  ms: number | null;
  icon: any;
  tint: string;
  failed?: boolean;
}) {
  const months = Array.isArray(data?.months) ? data.months : [];
  const summary = data?.summary ?? {};
  const safetyNotes = Array.isArray(data?.safetyNotes) ? data.safetyNotes : [];
  const reviewItems = Array.isArray(data?.practitionerReviewRequired) ? data.practitionerReviewRequired : [];

  if (failed) {
    return (
      <View style={[styles.previewCard, { borderColor: Colors.danger + '40' }]}>
        <View style={[styles.previewHeader, { backgroundColor: tint + '15' }]}>
          <Icon color={tint} size={16} />
          <Text style={[styles.previewLabel, { color: tint }]}>{label}</Text>
          <View style={styles.previewBadge}>
            <Text style={styles.previewBadgeText}>FAILED</Text>
          </View>
        </View>
        <View style={styles.failedBody}>
          <AlertCircle color={Colors.danger} size={22} />
          <Text style={styles.failedText}>
            {data?.error ?? 'Generation failed.'}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.previewCard}>
      <View style={[styles.previewHeader, { backgroundColor: tint + '15' }]}>
        <Icon color={tint} size={16} />
        <Text style={[styles.previewLabel, { color: tint }]}>{label}</Text>
        {ms != null && (
          <View style={styles.previewBadge}>
            <Clock color={Colors.textSecondary} size={10} />
            <Text style={styles.previewBadgeText}>{ms}ms</Text>
          </View>
        )}
      </View>

      <ScrollView style={styles.previewBody} nestedScrollEnabled>
        {/* Summary */}
        <View style={styles.sectionBlock}>
          <Text style={styles.sectionTitle}>Summary</Text>
          <Text style={styles.summaryNumber}>
            -{summary.targetBiologicalAgeReduction ?? summary.target_biological_age_reduction ?? 0} yrs target
          </Text>
          <Text style={styles.summaryLabel}>Root causes</Text>
          {(summary.primaryRootCauses ?? summary.primary_root_causes ?? []).map((c: string, i: number) => (
            <Text key={i} style={styles.bullet}>• {c}</Text>
          ))}
        </View>

        {/* Months */}
        {months.map((m: any) => (
          <View key={m.month} style={styles.sectionBlock}>
            <Text style={styles.monthHeader}>Month {m.month} · {m.theme}</Text>
            <Text style={styles.sectionLabel}>
              Hallmarks: {(m.hallmarksTargeted ?? []).join(', ')}
            </Text>
            {(m.supplements ?? []).length > 0 && (
              <Text style={styles.countLine}>💊 {(m.supplements ?? []).length} supplements</Text>
            )}
            {(m.peptides ?? []).length > 0 && (
              <Text style={styles.countLine}>💉 {(m.peptides ?? []).length} peptides</Text>
            )}
            <Text style={styles.countLine}>🍽 {m.diet?.type ?? '—'}</Text>
            <Text style={styles.countLine}>⏱ {m.fasting?.protocol ?? '—'}</Text>
            {(m.peptides ?? []).slice(0, 3).map((p: any, i: number) => (
              <Text key={i} style={styles.item}>  · {p.name} — {p.dose} ({p.cycle})</Text>
            ))}
          </View>
        ))}

        {/* Review required */}
        {reviewItems.length > 0 && (
          <View style={styles.sectionBlock}>
            <Text style={[styles.sectionTitle, { color: Colors.warning }]}>
              Review required ({reviewItems.length})
            </Text>
            {reviewItems.slice(0, 4).map((r: string, i: number) => (
              <Text key={i} style={styles.bullet}>• {r}</Text>
            ))}
          </View>
        )}

        {/* Safety notes */}
        {safetyNotes.length > 0 && (
          <View style={styles.sectionBlock}>
            <Text style={styles.sectionLabel}>Safety notes ({safetyNotes.length})</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function EvaluationCard({ evaluation, onReview }: {
  evaluation: AbEvaluation;
  onReview: (params: { score: number; winner: Winner; notes: string }) => Promise<void>;
}) {
  const [score, setScore] = useState<number>(evaluation.reviewer_score ?? 3);
  const [winner, setWinner] = useState<Winner>(evaluation.reviewer_winner ?? 'tie');
  const [notes, setNotes] = useState<string>(evaluation.reviewer_notes ?? '');
  const [saving, setSaving] = useState(false);

  const claudeFailed = evaluation.claude?.failed === true;

  const submit = async () => {
    setSaving(true);
    try {
      await onReview({ score, winner, notes });
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.evalCard}>
      <View style={styles.evalHeader}>
        <Text style={styles.fixtureId}>{evaluation.patient_fixture_id}</Text>
        <Text style={styles.generatedAt}>
          {new Date(evaluation.generated_at).toLocaleString()}
        </Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.previewRow}>
        <ProtocolPreview
          label="Deterministic"
          data={evaluation.deterministic}
          ms={evaluation.deterministic_generation_ms}
          icon={Cpu}
          tint="#3B82F6"
        />
        <ProtocolPreview
          label={`Claude (${evaluation.claude_model ?? 'unknown'})`}
          data={evaluation.claude}
          ms={evaluation.claude_generation_ms}
          icon={BeakerIcon}
          tint="#8B5CF6"
          failed={claudeFailed}
        />
      </ScrollView>

      {/* Scoring */}
      {!claudeFailed && (
        <View style={styles.reviewBox}>
          <View style={styles.winnerRow}>
            {(['claude', 'tie', 'deterministic', 'neither'] as Winner[]).map(w => (
              <TouchableOpacity
                key={w}
                style={[styles.winnerChip, winner === w && styles.winnerChipActive]}
                onPress={() => setWinner(w)}
              >
                <Text style={[styles.winnerChipText, winner === w && styles.winnerChipTextActive]}>
                  {w === 'claude' ? 'Claude wins' :
                   w === 'deterministic' ? 'Det wins' :
                   w === 'tie' ? 'Tie' : 'Neither'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.starRow}>
            <Text style={styles.scoreLabel}>Quality:</Text>
            {[1, 2, 3, 4, 5].map(n => (
              <TouchableOpacity key={n} onPress={() => setScore(n)}>
                <Star
                  color={n <= score ? Colors.warning : Colors.borderLight}
                  fill={n <= score ? Colors.warning : 'none'}
                  size={22}
                />
              </TouchableOpacity>
            ))}
            <Text style={styles.scoreValue}>{score}/5</Text>
          </View>

          <TextInput
            style={styles.notesInput}
            multiline
            placeholder="Reviewer notes (what worked, what didn't, safety concerns, etc.)"
            placeholderTextColor={Colors.textTertiary}
            value={notes}
            onChangeText={setNotes}
          />

          <TouchableOpacity style={styles.submitBtn} onPress={submit} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" size="small" /> : (
              <>
                <Check color="#fff" size={16} />
                <Text style={styles.submitBtnText}>
                  {evaluation.reviewed_at ? 'Update review' : 'Save review'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}

      {evaluation.reviewed_at && (
        <Text style={styles.reviewedAt}>
          Last reviewed: {new Date(evaluation.reviewed_at).toLocaleString()}
        </Text>
      )}
    </View>
  );
}

export default function AbReviewScreen() {
  const evaluationsQuery = trpc.longevity.listAbEvaluations.useQuery();
  const statsQuery = trpc.longevity.getGenerationStats.useQuery();
  const reviewMutation = trpc.longevity.saveAbEvaluationReview.useMutation();
  const utils = trpc.useUtils();

  const evaluations = useMemo(
    () => (evaluationsQuery.data as AbEvaluation[] | undefined) ?? [],
    [evaluationsQuery.data]
  );

  const handleReview = useCallback(async (evalId: string, params: {
    score: number;
    winner: Winner;
    notes: string;
  }) => {
    try {
      await reviewMutation.mutateAsync({
        evaluationId: evalId,
        score: params.score,
        winner: params.winner,
        notes: params.notes,
      });
      await utils.longevity.listAbEvaluations.invalidate();
      Alert.alert('Saved', 'Review recorded.');
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to save review.');
    }
  }, [reviewMutation, utils]);

  if (evaluationsQuery.isLoading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={Colors.primary} /></View>;
  }
  if (evaluationsQuery.isError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Practitioner access required.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'A/B Review' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.header}>Longevity A/B Review</Text>

        {/* Aggregate stats */}
        {statsQuery.data && (
          <View style={styles.statsCard}>
            <Text style={styles.statsTitle}>Generation stats (last 500 protocols)</Text>
            <View style={styles.statsRow}>
              {statsQuery.data.byMethod.map(m => (
                <View key={m.method} style={styles.statCell}>
                  <Text style={styles.statLabel}>{m.method}</Text>
                  <Text style={styles.statValue}>{m.count}</Text>
                  <Text style={styles.statSub}>~{m.meanMs}ms</Text>
                </View>
              ))}
              {statsQuery.data.claudeSuccessRate != null && (
                <View style={styles.statCell}>
                  <Text style={styles.statLabel}>Claude success</Text>
                  <Text style={styles.statValue}>{statsQuery.data.claudeSuccessRate}%</Text>
                </View>
              )}
            </View>
          </View>
        )}

        <Text style={styles.subheader}>
          {evaluations.length} evaluation pair{evaluations.length === 1 ? '' : 's'} to review.
          Run <Text style={styles.mono}>bun expo/scripts/longevity-ab-eval.ts</Text> to generate more.
        </Text>

        {evaluations.map(ev => (
          <EvaluationCard
            key={ev.id}
            evaluation={ev}
            onReview={(params) => handleReview(ev.id, params)}
          />
        ))}

        {evaluations.length === 0 && (
          <View style={styles.emptyState}>
            <Minus color={Colors.textTertiary} size={40} />
            <Text style={styles.emptyTitle}>No evaluations yet</Text>
            <Text style={styles.emptyText}>
              Run the eval script to generate side-by-side protocols for the 5 test patients.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  content: { padding: 16, gap: 14, paddingBottom: 40 },
  header: { fontSize: 22, fontWeight: '800', color: Colors.text },
  subheader: { fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  mono: { fontFamily: 'Courier', color: Colors.primary },
  errorText: { fontSize: 14, color: Colors.danger, textAlign: 'center' },

  statsCard: {
    backgroundColor: Colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
    padding: 14, gap: 8,
  },
  statsTitle: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase' },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCell: { flex: 1, minWidth: 80, alignItems: 'center', padding: 8 },
  statLabel: { fontSize: 11, color: Colors.textTertiary, textTransform: 'uppercase' },
  statValue: { fontSize: 20, fontWeight: '800', color: Colors.primary, marginTop: 2 },
  statSub: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },

  evalCard: {
    backgroundColor: Colors.surface, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border,
    padding: 12, gap: 10,
  },
  evalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fixtureId: { fontSize: 13, fontWeight: '700', color: Colors.text, fontFamily: 'Courier' },
  generatedAt: { fontSize: 11, color: Colors.textTertiary },

  previewRow: { gap: 10, paddingRight: 10 },
  previewCard: {
    width: CARD_W, height: 400,
    backgroundColor: Colors.background, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  previewHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  previewLabel: { flex: 1, fontSize: 13, fontWeight: '700' },
  previewBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
    backgroundColor: Colors.surface,
  },
  previewBadgeText: { fontSize: 10, fontWeight: '600', color: Colors.textSecondary },
  previewBody: { flex: 1, padding: 10 },
  sectionBlock: {
    marginBottom: 10, paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase' },
  sectionLabel: { fontSize: 11, color: Colors.textTertiary, marginTop: 2 },
  summaryNumber: { fontSize: 18, fontWeight: '800', color: Colors.primary, marginVertical: 4 },
  summaryLabel: { fontSize: 11, color: Colors.textSecondary, fontWeight: '600', marginTop: 4 },
  monthHeader: { fontSize: 13, fontWeight: '700', color: Colors.text },
  countLine: { fontSize: 12, color: Colors.text, marginTop: 3 },
  bullet: { fontSize: 12, color: Colors.text, lineHeight: 18 },
  item: { fontSize: 11, color: Colors.textSecondary, lineHeight: 16 },

  failedBody: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10, padding: 20 },
  failedText: { fontSize: 13, color: Colors.danger, textAlign: 'center' },

  reviewBox: { gap: 10, padding: 10, backgroundColor: Colors.surfaceSecondary, borderRadius: 10 },
  winnerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  winnerChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
  },
  winnerChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  winnerChipText: { fontSize: 12, color: Colors.textSecondary, fontWeight: '500' },
  winnerChipTextActive: { color: '#fff', fontWeight: '700' },
  starRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  scoreLabel: { fontSize: 13, fontWeight: '600', color: Colors.text },
  scoreValue: { marginLeft: 8, fontSize: 13, fontWeight: '700', color: Colors.primary },
  notesInput: {
    backgroundColor: Colors.surface, borderRadius: 8,
    borderWidth: 1, borderColor: Colors.border,
    padding: 10, fontSize: 13, color: Colors.text,
    minHeight: 70, textAlignVertical: 'top',
  },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 10,
  },
  submitBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  reviewedAt: { fontSize: 11, color: Colors.textTertiary, fontStyle: 'italic', textAlign: 'right' },

  emptyState: { alignItems: 'center', padding: 40, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: Colors.text },
  emptyText: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center' },
});
