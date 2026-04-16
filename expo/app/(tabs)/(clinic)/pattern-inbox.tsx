import { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, TextInput,
} from 'react-native';
import { Stack } from 'expo-router';
import {
  CheckCircle2, XCircle, RefreshCw, Sparkles,
  ChevronRight, Plus, AlertTriangle, Archive,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import ParadigmChip, { ALL_PARADIGMS, type Paradigm } from '@/components/patterns/ParadigmChip';
import HypothesisCard from '@/components/patterns/HypothesisCard';

interface Pattern {
  id: string;
  kind: string;
  left_entity: any;
  right_entity: any;
  method: string;
  time_lag_days: number;
  n_patients: number;
  effect_size: number;
  p_value: number;
  q_value: number;
  novelty_score: number | null;
  existing_rule_overlap: any;
  status: string;
  patient_visible_statistics: boolean;
}

export default function PatternInboxScreen() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paradigmScores, setParadigmScores] = useState<Record<string, number>>({});
  const [reviewNote, setReviewNote] = useState('');

  const listQuery = trpc.patterns.listPatterns.useQuery();
  const detailQuery = trpc.patterns.getPattern.useQuery(
    { id: selectedId ?? '' },
    { enabled: !!selectedId }
  );
  const utils = trpc.useUtils();

  const requestMutation = trpc.patterns.requestParadigmHypothesis.useMutation();
  const reviewMutation = trpc.patterns.reviewPattern.useMutation();
  const runMinerMutation = trpc.patterns.runMinerNow.useMutation();

  const patterns = (listQuery.data as Pattern[] | undefined) ?? [];
  const selectedPattern = detailQuery.data?.pattern as Pattern | undefined;
  const hypotheses = (detailQuery.data?.hypotheses ?? []) as any[];
  const reviews = (detailQuery.data?.reviews ?? []) as any[];

  const existingParadigms = useMemo(
    () => new Set(hypotheses.map(h => h.paradigm as Paradigm)),
    [hypotheses]
  );

  const [missingSelection, setMissingSelection] = useState<Set<Paradigm>>(new Set());

  const handleToggleMissing = (p: Paradigm) => {
    setMissingSelection(prev => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const handleGenerate = useCallback(async (paradigms: Paradigm[], forceRegenerate = false) => {
    if (!selectedId || paradigms.length === 0) return;
    try {
      const result = await requestMutation.mutateAsync({
        patternId: selectedId,
        paradigms,
        forceRegenerate,
      });
      await utils.patterns.getPattern.invalidate({ id: selectedId });
      await utils.patterns.listPatterns.invalidate();
      setMissingSelection(new Set());
      Alert.alert(
        'Generated',
        `Generated: ${result.generated.length > 0 ? result.generated.join(', ') : 'none'}` +
        (result.failed.length ? `\nFailed: ${result.failed.join(', ')}` : '')
      );
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Generation failed');
    }
  }, [selectedId, requestMutation, utils]);

  const handleAction = useCallback(async (
    action: 'promote_research' | 'promote_clinical' | 'reject' | 'retire',
  ) => {
    if (!selectedId) return;
    try {
      const result = await reviewMutation.mutateAsync({
        patternId: selectedId,
        action,
        notes: reviewNote || undefined,
        paradigmScores: Object.keys(paradigmScores).length ? paradigmScores : undefined,
      });
      await utils.patterns.listPatterns.invalidate();
      await utils.patterns.getPattern.invalidate({ id: selectedId });
      setReviewNote('');
      Alert.alert('Recorded', `Pattern now ${result.newStatus}`);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Review failed');
    }
  }, [selectedId, reviewMutation, reviewNote, paradigmScores, utils]);

  const handleRunMiner = useCallback(async () => {
    try {
      const result = await runMinerMutation.mutateAsync();
      await utils.patterns.listPatterns.invalidate();
      Alert.alert(
        'Miner complete',
        `Cohort ${result.cohortSize} · Tested ${result.candidatesConsidered} · FDR-survived ${result.candidatesPassedFdr} · Upserted ${result.candidatesUpserted}`
      );
    } catch (e: any) {
      Alert.alert('Miner failed', e?.message ?? 'See Sentry for details');
    }
  }, [runMinerMutation, utils]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Pattern Inbox' }} />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <Text style={styles.header}>Pattern inbox</Text>
          <TouchableOpacity
            style={styles.runMinerBtn}
            onPress={handleRunMiner}
            disabled={runMinerMutation.isPending}
          >
            {runMinerMutation.isPending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <RefreshCw color="#fff" size={14} />
                <Text style={styles.runMinerText}>Run miner</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
        <Text style={styles.subheader}>
          Candidates surface here after the miner runs. Sorted by q-value ascending (most significant first).
        </Text>

        {/* Pattern list */}
        {listQuery.isLoading ? (
          <ActivityIndicator color={Colors.primary} />
        ) : patterns.length === 0 ? (
          <View style={styles.emptyList}>
            <Archive color={Colors.textTertiary} size={32} />
            <Text style={styles.emptyTitle}>No patterns in the queue</Text>
            <Text style={styles.emptyBody}>Run the miner to surface new candidates.</Text>
          </View>
        ) : (
          <View style={styles.patternList}>
            {patterns.map(p => {
              const isSelected = p.id === selectedId;
              return (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.patternItem, isSelected && styles.patternItemSelected]}
                  onPress={() => { setSelectedId(p.id); setParadigmScores({}); setReviewNote(''); }}
                >
                  <View style={styles.patternItemHeader}>
                    <Text style={styles.patternKind}>{p.kind}</Text>
                    <Text style={styles.patternStatus}>{p.status}</Text>
                  </View>
                  <Text style={styles.patternEntities} numberOfLines={2}>
                    <Text style={{ fontWeight: '600' }}>{p.left_entity?.label ?? '?'}</Text> × <Text style={{ fontWeight: '600' }}>{p.right_entity?.label ?? '?'}</Text>
                  </Text>
                  <View style={styles.patternMetrics}>
                    <Text style={styles.metric}>ρ={p.effect_size.toFixed(3)}</Text>
                    <Text style={styles.metric}>q={p.q_value.toExponential(1)}</Text>
                    <Text style={styles.metric}>n={p.n_patients}</Text>
                    <Text style={styles.metric}>lag={p.time_lag_days}d</Text>
                    {p.novelty_score != null && (
                      <Text style={[styles.metric, { color: p.novelty_score > 0.7 ? Colors.success : Colors.textSecondary }]}>
                        novelty={Math.round(p.novelty_score * 100)}%
                      </Text>
                    )}
                  </View>
                  <ChevronRight color={Colors.textTertiary} size={16} style={styles.chevron} />
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Detail pane */}
        {selectedPattern && (
          <View style={styles.detailPane}>
            <Text style={styles.detailTitle}>
              {selectedPattern.left_entity?.label} × {selectedPattern.right_entity?.label}
            </Text>
            <Text style={styles.detailMeta}>
              {selectedPattern.kind} · method={selectedPattern.method} · n={selectedPattern.n_patients} · effect={selectedPattern.effect_size.toFixed(3)} · q={selectedPattern.q_value.toExponential(2)}
            </Text>

            {/* Paradigm chip row */}
            <Text style={styles.sectionLabel}>Paradigms</Text>
            <View style={styles.paradigmRow}>
              {ALL_PARADIGMS.map(p => {
                const exists = existingParadigms.has(p);
                const isSelected = missingSelection.has(p);
                return (
                  <ParadigmChip
                    key={p}
                    paradigm={p}
                    filled={exists}
                    selected={!exists && isSelected}
                    onPress={() => {
                      if (exists) return;
                      handleToggleMissing(p);
                    }}
                  />
                );
              })}
            </View>
            {missingSelection.size > 0 && (
              <TouchableOpacity
                style={styles.generateBtn}
                onPress={() => handleGenerate([...missingSelection])}
                disabled={requestMutation.isPending}
              >
                {requestMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Plus color="#fff" size={14} />
                    <Text style={styles.generateBtnText}>
                      Generate {missingSelection.size} paradigm{missingSelection.size === 1 ? '' : 's'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            )}

            {/* Hypotheses horizontal */}
            {hypotheses.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>Hypotheses</Text>
                <ScrollView horizontal contentContainerStyle={styles.hypothesesRow}>
                  {hypotheses.map((h: any) => (
                    <HypothesisCard
                      key={h.id}
                      hypothesis={h}
                      currentScore={paradigmScores[h.paradigm]}
                      onScore={(score) => setParadigmScores(prev => ({ ...prev, [h.paradigm]: score }))}
                    />
                  ))}
                </ScrollView>

                {existingParadigms.has('synergistic') && (
                  <TouchableOpacity
                    style={styles.regenSynBtn}
                    onPress={() => handleGenerate(['synergistic'], true)}
                    disabled={requestMutation.isPending}
                  >
                    <Sparkles color={Colors.primary} size={14} />
                    <Text style={styles.regenSynText}>Regenerate synergistic</Text>
                  </TouchableOpacity>
                )}
              </>
            )}

            {/* Review actions */}
            <Text style={styles.sectionLabel}>Review</Text>
            <TextInput
              style={styles.noteInput}
              multiline
              placeholder="Reviewer notes (optional)"
              placeholderTextColor={Colors.textTertiary}
              value={reviewNote}
              onChangeText={setReviewNote}
            />
            <View style={styles.actionRow}>
              {(selectedPattern.status === 'candidate' || selectedPattern.status === 'under_review') && (
                <>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionPromote]}
                    onPress={() => handleAction('promote_research')}
                    disabled={reviewMutation.isPending}
                  >
                    <CheckCircle2 color="#fff" size={14} />
                    <Text style={styles.actionText}>Promote · Research</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionReject]}
                    onPress={() => handleAction('reject')}
                    disabled={reviewMutation.isPending}
                  >
                    <XCircle color="#fff" size={14} />
                    <Text style={styles.actionText}>Reject</Text>
                  </TouchableOpacity>
                </>
              )}
              {selectedPattern.status === 'research_signal' && (
                <>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionPromote]}
                    onPress={() => handleAction('promote_clinical')}
                    disabled={reviewMutation.isPending}
                  >
                    <CheckCircle2 color="#fff" size={14} />
                    <Text style={styles.actionText}>Promote · Clinical</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionReject]}
                    onPress={() => handleAction('retire')}
                    disabled={reviewMutation.isPending}
                  >
                    <Archive color="#fff" size={14} />
                    <Text style={styles.actionText}>Retire</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>

            {/* Audit log */}
            {reviews.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>Audit log</Text>
                {reviews.map((r: any) => (
                  <View key={r.id} style={styles.auditRow}>
                    <Text style={styles.auditAction}>{r.action}</Text>
                    <Text style={styles.auditMeta}>
                      {r.from_status} → {r.to_status ?? '(no change)'} · {new Date(r.created_at).toLocaleString()}
                    </Text>
                    {r.notes && <Text style={styles.auditNote}>{r.notes}</Text>}
                  </View>
                ))}
              </>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, gap: 14, paddingBottom: 40 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  header: { fontSize: 22, fontWeight: '800', color: Colors.text },
  subheader: { fontSize: 12, color: Colors.textSecondary, lineHeight: 18 },
  runMinerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
    backgroundColor: Colors.primary,
  },
  runMinerText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  emptyList: { alignItems: 'center', padding: 32, gap: 8 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
  emptyBody: { fontSize: 12, color: Colors.textSecondary },

  patternList: { gap: 8 },
  patternItem: {
    backgroundColor: Colors.surface, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.border,
    padding: 12, position: 'relative',
  },
  patternItemSelected: { borderColor: Colors.primary, borderWidth: 2 },
  patternItemHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  patternKind: { fontSize: 10, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase' },
  patternStatus: { fontSize: 10, fontWeight: '700', color: Colors.primary, textTransform: 'uppercase' },
  patternEntities: { fontSize: 14, color: Colors.text, marginTop: 4 },
  patternMetrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 },
  metric: { fontSize: 11, color: Colors.textSecondary, fontFamily: 'Courier' },
  chevron: { position: 'absolute', right: 12, top: 14 },

  detailPane: {
    backgroundColor: Colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
    padding: 14, gap: 10,
  },
  detailTitle: { fontSize: 16, fontWeight: '800', color: Colors.text },
  detailMeta: { fontSize: 11, color: Colors.textSecondary, fontFamily: 'Courier' },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', marginTop: 6 },
  paradigmRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  generateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: 10, backgroundColor: Colors.primary,
    alignSelf: 'flex-start', paddingHorizontal: 16,
  },
  generateBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  hypothesesRow: { gap: 10, paddingRight: 8 },
  regenSynBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
    borderWidth: 1, borderColor: Colors.primary,
  },
  regenSynText: { fontSize: 12, fontWeight: '600', color: Colors.primary },
  noteInput: {
    backgroundColor: Colors.background, borderRadius: 8,
    borderWidth: 1, borderColor: Colors.border,
    padding: 10, fontSize: 13, color: Colors.text,
    minHeight: 60, textAlignVertical: 'top',
  },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10,
  },
  actionPromote: { backgroundColor: Colors.success },
  actionReject: { backgroundColor: Colors.danger },
  actionText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  auditRow: { padding: 8, backgroundColor: Colors.surfaceSecondary, borderRadius: 6, gap: 2 },
  auditAction: { fontSize: 12, fontWeight: '700', color: Colors.text },
  auditMeta: { fontSize: 10, color: Colors.textTertiary, fontFamily: 'Courier' },
  auditNote: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
});
