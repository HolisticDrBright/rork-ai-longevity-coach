import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Play, Plus, RefreshCcw } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { featureFlags } from '@/lib/featureFlags';
import { TimelineList } from '@/components/reasoning/TimelineList';
import { HypothesisCard } from '@/components/reasoning/HypothesisCard';
import { ReviewStatusPill, SourceBadge } from '@/components/reasoning/SourceBadge';
import type { ClinicalHypothesis } from '@/types/reasoning';

const DESKTOP_BREAKPOINT = 980;

export default function ClinicalReasoningScreen() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;

  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [selectedHypothesisId, setSelectedHypothesisId] = useState<string | null>(null);
  const [newHypothesisName, setNewHypothesisName] = useState('');
  const [showNewHypothesis, setShowNewHypothesis] = useState(false);

  const utils = trpc.useUtils();

  const relationshipsQuery = trpc.reasoning.relationships.list.useQuery(undefined, {
    enabled: featureFlags.clinicalReasoning,
  });

  const myPatients = useMemo(
    () => (relationshipsQuery.data ?? []).filter((r) => r.status === 'active'),
    [relationshipsQuery.data]
  );

  const patientId = selectedPatientId ?? myPatients[0]?.patientId ?? null;

  const timelineQuery = trpc.reasoning.timeline.get.useQuery(
    { patientId: patientId ?? undefined, limitPerSource: 60 },
    { enabled: featureFlags.clinicalReasoning && !!patientId }
  );

  const hypothesesQuery = trpc.reasoning.hypotheses.list.useQuery(
    { patientId: patientId ?? undefined },
    { enabled: featureFlags.clinicalReasoning && !!patientId }
  );

  const snapshotsQuery = trpc.reasoning.snapshots.list.useQuery(
    { patientId: patientId ?? undefined, limit: 1 },
    { enabled: featureFlags.clinicalReasoning && !!patientId }
  );

  const runAnalysis = trpc.reasoning.analysis.run.useMutation({
    onSuccess: () => {
      void utils.reasoning.snapshots.list.invalidate();
      void utils.reasoning.hypotheses.list.invalidate();
      void utils.reasoning.reviews.listQueue.invalidate();
    },
    onError: (e) => Alert.alert('Analysis failed', e.message),
  });

  const createHypothesis = trpc.reasoning.hypotheses.create.useMutation({
    onSuccess: () => {
      setNewHypothesisName('');
      setShowNewHypothesis(false);
      void utils.reasoning.hypotheses.list.invalidate();
    },
    onError: (e) => Alert.alert('Could not add hypothesis', e.message),
  });

  const updateStatus = trpc.reasoning.hypotheses.updateStatus.useMutation({
    onSuccess: () => void utils.reasoning.hypotheses.list.invalidate(),
    onError: (e) => Alert.alert('Update failed', e.message),
  });

  if (!featureFlags.clinicalReasoning) {
    return (
      <View style={styles.centerFill}>
        <Text style={styles.mutedText}>Clinical reasoning is not enabled in this build.</Text>
      </View>
    );
  }

  const hypotheses = hypothesesQuery.data ?? [];
  const selectedHypothesis: ClinicalHypothesis | undefined =
    hypotheses.find((h) => h.id === selectedHypothesisId) ?? hypotheses[0];
  const latestSnapshot = snapshotsQuery.data?.[0];

  const patientSelector = (
    <View style={styles.patientBar}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {myPatients.length === 0 ? (
          <Text style={styles.mutedText}>
            No authorized patients yet. Patients grant access from Profile → Care team using your share code.
          </Text>
        ) : (
          myPatients.map((r) => (
            <TouchableOpacity
              key={r.id}
              style={[styles.patientChip, patientId === r.patientId && styles.patientChipActive]}
              onPress={() => {
                setSelectedPatientId(r.patientId);
                setSelectedHypothesisId(null);
              }}
              testID={`patient-chip-${r.patientId}`}
            >
              <Text
                style={[styles.patientChipText, patientId === r.patientId && styles.patientChipTextActive]}
                numberOfLines={1}
              >
                {r.note || `Patient ${r.patientId.slice(0, 8)}`}
              </Text>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
      {patientId && (
        <TouchableOpacity
          style={styles.runButton}
          onPress={() => runAnalysis.mutate({ patientId, trigger: 'manual' })}
          disabled={runAnalysis.isPending}
          testID="run-analysis-button"
        >
          {runAnalysis.isPending ? (
            <ActivityIndicator size="small" color={Colors.textInverse} />
          ) : (
            <Play size={14} color={Colors.textInverse} />
          )}
          <Text style={styles.runButtonText}>Run analysis</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  const timelineColumn = (
    <View style={[styles.column, isDesktop && styles.columnLeft]}>
      <View style={styles.columnHeader}>
        <Text style={styles.columnTitle}>Timeline</Text>
        <TouchableOpacity onPress={() => timelineQuery.refetch()}>
          <RefreshCcw size={14} color={Colors.textSecondary} />
        </TouchableOpacity>
      </View>
      {timelineQuery.isLoading ? (
        <ActivityIndicator color={Colors.primary} style={styles.loader} />
      ) : (
        <TimelineList events={(timelineQuery.data ?? []).slice(0, 50)} />
      )}
    </View>
  );

  const hypothesesColumn = (
    <View style={[styles.column, isDesktop && styles.columnCenter]}>
      <View style={styles.columnHeader}>
        <Text style={styles.columnTitle}>Ranked hypotheses</Text>
        <TouchableOpacity onPress={() => setShowNewHypothesis((v) => !v)} testID="add-hypothesis-toggle">
          <Plus size={16} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      {latestSnapshot && (
        <View style={styles.snapshotCard}>
          <Text style={styles.snapshotTitle}>
            Since last analysis (#{latestSnapshot.snapshotNumber}, {new Date(latestSnapshot.createdAt).toLocaleDateString()})
          </Text>
          <Text style={styles.snapshotSummary}>{latestSnapshot.diffFromPrevious?.summary ?? '—'}</Text>
          {(latestSnapshot.detectedChanges ?? []).slice(0, 4).map((c) => (
            <Text key={c.metric} style={styles.snapshotChange}>
              • {c.label}: {c.direction} {c.magnitudePercent}% ({c.severity})
            </Text>
          ))}
        </View>
      )}

      {showNewHypothesis && (
        <View style={styles.newHypothesisBox}>
          <TextInput
            style={styles.input}
            placeholder="Hypothesis name (e.g. HPA-axis dysregulation driving fatigue)"
            placeholderTextColor={Colors.textTertiary}
            value={newHypothesisName}
            onChangeText={setNewHypothesisName}
            testID="new-hypothesis-input"
          />
          <TouchableOpacity
            style={[styles.smallButton, !newHypothesisName.trim() && styles.smallButtonDisabled]}
            disabled={!newHypothesisName.trim() || !patientId || createHypothesis.isPending}
            onPress={() =>
              patientId &&
              createHypothesis.mutate({ patientId, name: newHypothesisName.trim() })
            }
          >
            <Text style={styles.smallButtonText}>Add hypothesis</Text>
          </TouchableOpacity>
        </View>
      )}

      {hypothesesQuery.isLoading ? (
        <ActivityIndicator color={Colors.primary} style={styles.loader} />
      ) : hypotheses.length === 0 ? (
        <Text style={styles.mutedText}>
          No hypotheses yet. Add one, or run the analysis to detect changes worth explaining.
        </Text>
      ) : (
        hypotheses.map((h) => (
          <HypothesisCard
            key={h.id}
            hypothesis={h}
            selected={selectedHypothesis?.id === h.id}
            onPress={() => setSelectedHypothesisId(h.id)}
          />
        ))
      )}
    </View>
  );

  const evidenceColumn = (
    <View style={[styles.column, isDesktop && styles.columnRight]}>
      <Text style={styles.columnTitle}>Evidence & actions</Text>
      {selectedHypothesis ? (
        <View>
          <Text style={styles.detailName}>{selectedHypothesis.name}</Text>
          <View style={styles.badgeRow}>
            <SourceBadge sourceType={selectedHypothesis.sourceType} />
            <ReviewStatusPill status={selectedHypothesis.reviewStatus} />
          </View>
          {selectedHypothesis.description ? (
            <Text style={styles.detailDescription}>{selectedHypothesis.description}</Text>
          ) : null}

          <Text style={styles.sectionLabel}>Supporting evidence</Text>
          {(selectedHypothesis.supportingEvidence ?? []).length === 0 ? (
            <Text style={styles.mutedText}>None recorded.</Text>
          ) : (
            (selectedHypothesis.supportingEvidence ?? []).map((e) => (
              <View key={e.id} style={styles.evidenceCard}>
                <Text style={styles.evidenceSummary}>{e.summary}</Text>
                <SourceBadge sourceType={e.sourceType} compact />
              </View>
            ))
          )}

          <Text style={styles.sectionLabel}>Contradicting evidence</Text>
          {(selectedHypothesis.contradictingEvidence ?? []).length === 0 ? (
            <Text style={styles.mutedText}>None recorded.</Text>
          ) : (
            (selectedHypothesis.contradictingEvidence ?? []).map((e) => (
              <View key={e.id} style={[styles.evidenceCard, styles.evidenceCardContra]}>
                <Text style={styles.evidenceSummary}>{e.summary}</Text>
                <SourceBadge sourceType={e.sourceType} compact />
              </View>
            ))
          )}

          {selectedHypothesis.missingEvidence.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Missing data</Text>
              {selectedHypothesis.missingEvidence.map((m, i) => (
                <Text key={`${m}-${i}`} style={styles.missingItem}>
                  • {m}
                </Text>
              ))}
            </>
          )}

          <Text style={styles.sectionLabel}>Practitioner decision</Text>
          <View style={styles.actionRow}>
            {(['supported', 'weakened', 'rejected'] as const).map((s) => (
              <TouchableOpacity
                key={s}
                style={styles.actionButton}
                disabled={updateStatus.isPending}
                onPress={() => updateStatus.mutate({ hypothesisId: selectedHypothesis.id, status: s })}
                testID={`hypothesis-action-${s}`}
              >
                <Text style={styles.actionButtonText}>
                  {s === 'supported' ? 'Mark supported' : s === 'weakened' ? 'Mark weakened' : 'Reject'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.disclaimer}>
            Support levels are reasoning strength from the evidence ledger — not validated medical
            probabilities and not a diagnosis.
          </Text>
        </View>
      ) : (
        <Text style={styles.mutedText}>Select a hypothesis to inspect its evidence.</Text>
      )}
    </View>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} testID="clinical-reasoning-screen">
      {patientSelector}
      {!patientId ? null : isDesktop ? (
        <View style={styles.desktopRow}>
          {timelineColumn}
          {hypothesesColumn}
          {evidenceColumn}
        </View>
      ) : (
        <View>
          {hypothesesColumn}
          {evidenceColumn}
          {timelineColumn}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 48 },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  patientBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  patientChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: Colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    marginRight: 8,
    maxWidth: 200,
  },
  patientChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  patientChipText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' },
  patientChipTextActive: { color: Colors.textInverse },
  runButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 18,
  },
  runButtonText: { color: Colors.textInverse, fontSize: 13, fontWeight: '600' },
  desktopRow: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  column: { marginBottom: 20 },
  columnLeft: { flex: 27 },
  columnCenter: { flex: 43 },
  columnRight: { flex: 30 },
  columnHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  columnTitle: { fontSize: 16, fontWeight: '700', color: Colors.text, marginBottom: 6 },
  loader: { marginVertical: 20 },
  mutedText: { fontSize: 13, color: Colors.textTertiary, lineHeight: 18 },
  snapshotCard: {
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  snapshotTitle: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary, marginBottom: 4 },
  snapshotSummary: { fontSize: 13, color: Colors.text, marginBottom: 6 },
  snapshotChange: { fontSize: 12, color: Colors.textSecondary, lineHeight: 18 },
  newHypothesisBox: { marginBottom: 12, gap: 8 },
  input: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: Colors.text,
  },
  smallButton: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  smallButtonDisabled: { opacity: 0.5 },
  smallButtonText: { color: Colors.textInverse, fontWeight: '600', fontSize: 13 },
  detailName: { fontSize: 15, fontWeight: '700', color: Colors.text, marginBottom: 8 },
  badgeRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 8 },
  detailDescription: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19, marginBottom: 8 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 14,
    marginBottom: 6,
  },
  evidenceCard: {
    backgroundColor: Colors.surface,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: Colors.success,
    padding: 10,
    marginBottom: 6,
    gap: 6,
  },
  evidenceCardContra: { borderLeftColor: Colors.coral },
  evidenceSummary: { fontSize: 13, color: Colors.text, lineHeight: 18 },
  missingItem: { fontSize: 13, color: Colors.textSecondary, lineHeight: 20 },
  actionRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  actionButton: {
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  actionButtonText: { color: Colors.primary, fontSize: 12, fontWeight: '600' },
  disclaimer: {
    fontSize: 11,
    color: Colors.textTertiary,
    fontStyle: 'italic',
    marginTop: 14,
    lineHeight: 16,
  },
});
