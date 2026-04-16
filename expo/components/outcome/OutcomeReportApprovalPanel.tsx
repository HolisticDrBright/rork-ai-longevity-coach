import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { CheckCircle2, Share2, RefreshCw, Trophy, Edit3 } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import OutcomeReportView from './OutcomeReportView';

interface Props {
  protocolId: string;
}

export default function OutcomeReportApprovalPanel({ protocolId }: Props) {
  const reportQuery = trpc.longevity.outcomeReportGet.useQuery({ protocolId });
  const generateMutation = trpc.longevity.outcomeReportGenerate.useMutation();
  const updateNarrativeMutation = trpc.longevity.outcomeReportUpdateNarrative.useMutation();
  const approveMutation = trpc.longevity.outcomeReportApprove.useMutation();
  const shareMutation = trpc.longevity.outcomeReportShare.useMutation();
  const utils = trpc.useUtils();

  const [editingNarrative, setEditingNarrative] = useState(false);
  const [draftNarrative, setDraftNarrative] = useState('');

  const report = reportQuery.data as any;

  const handleGenerate = useCallback(async () => {
    try {
      await generateMutation.mutateAsync({ protocolId });
      await utils.longevity.outcomeReportGet.invalidate();
      Alert.alert('Generated', 'Outcome report built successfully.');
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to generate report.');
    }
  }, [generateMutation, protocolId, utils]);

  const handleSaveNarrative = useCallback(async () => {
    if (!report) return;
    try {
      await updateNarrativeMutation.mutateAsync({
        reportId: report.id,
        narrativeSummary: draftNarrative,
      });
      await utils.longevity.outcomeReportGet.invalidate();
      setEditingNarrative(false);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to save narrative.');
    }
  }, [report, draftNarrative, updateNarrativeMutation, utils]);

  const handleApprove = useCallback(async () => {
    if (!report) return;
    try {
      await approveMutation.mutateAsync({ reportId: report.id });
      await utils.longevity.outcomeReportGet.invalidate();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to approve.');
    }
  }, [report, approveMutation, utils]);

  const handleShare = useCallback(async () => {
    if (!report) return;
    try {
      await shareMutation.mutateAsync({ reportId: report.id });
      await utils.longevity.outcomeReportGet.invalidate();
      Alert.alert('Shared', 'Patient has been notified.');
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to share.');
    }
  }, [report, shareMutation, utils]);

  if (reportQuery.isLoading) {
    return <View style={styles.loading}><ActivityIndicator color={Colors.primary} /></View>;
  }

  if (!report) {
    return (
      <View style={styles.emptyCard}>
        <Trophy color={Colors.textTertiary} size={28} />
        <Text style={styles.emptyTitle}>No outcome report yet</Text>
        <Text style={styles.emptyBody}>
          Generate a Month 6 outcome report once baseline + Month 6 labs and wearable data are available.
        </Text>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={handleGenerate}
          disabled={generateMutation.isPending}
        >
          {generateMutation.isPending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <RefreshCw color="#fff" size={16} />
              <Text style={styles.primaryBtnText}>Generate report</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Status bar */}
      <View style={styles.statusBar}>
        <View style={styles.statusLeft}>
          <Trophy color={Colors.primary} size={16} />
          <Text style={styles.statusLabel}>Outcome report</Text>
          <StatusTag
            label={report.practitioner_approved ? 'Approved' : 'Draft'}
            tone={report.practitioner_approved ? 'success' : 'neutral'}
          />
          {report.shared_with_patient && <StatusTag label="Shared" tone="success" />}
          <StatusTag
            label={`${report.data_completeness_pct ?? report.report?.dataCompletenessPct ?? 0}% data`}
            tone="neutral"
          />
        </View>
      </View>

      {/* Report preview */}
      <View style={styles.previewWrap}>
        <OutcomeReportView
          report={report.report}
          narrativeSummary={report.narrative_summary}
        />
      </View>

      {/* Narrative editor */}
      <View style={styles.narrativeEditor}>
        <View style={styles.narrativeHeader}>
          <Edit3 color={Colors.primary} size={14} />
          <Text style={styles.narrativeLabel}>Practitioner narrative</Text>
          {!editingNarrative && (
            <TouchableOpacity
              onPress={() => {
                setDraftNarrative(report.narrative_summary ?? '');
                setEditingNarrative(true);
              }}
            >
              <Text style={styles.editLink}>Edit</Text>
            </TouchableOpacity>
          )}
        </View>
        {editingNarrative ? (
          <>
            <TextInput
              style={styles.narrativeTextarea}
              multiline
              value={draftNarrative}
              onChangeText={setDraftNarrative}
              placeholder="Override Claude's narrative here before sharing with the patient..."
              placeholderTextColor={Colors.textTertiary}
            />
            <View style={styles.editActions}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => setEditingNarrative(false)}>
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={handleSaveNarrative}
                disabled={updateNarrativeMutation.isPending}
              >
                {updateNarrativeMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.primaryBtnText}>Save narrative</Text>
                )}
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <Text style={styles.narrativeText}>
            {report.narrative_summary ?? 'No narrative yet.'}
          </Text>
        )}
      </View>

      {/* Approval + share actions */}
      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={handleGenerate}
          disabled={generateMutation.isPending}
        >
          <RefreshCw color={Colors.primary} size={14} />
          <Text style={styles.secondaryBtnText}>Regenerate</Text>
        </TouchableOpacity>

        {!report.practitioner_approved ? (
          <TouchableOpacity
            style={[styles.primaryBtn, { flex: 2 }]}
            onPress={handleApprove}
            disabled={approveMutation.isPending}
          >
            <CheckCircle2 color="#fff" size={16} />
            <Text style={styles.primaryBtnText}>Approve & unlock patient view</Text>
          </TouchableOpacity>
        ) : !report.shared_with_patient ? (
          <TouchableOpacity
            style={[styles.primaryBtn, { flex: 2, backgroundColor: Colors.success }]}
            onPress={handleShare}
            disabled={shareMutation.isPending}
          >
            <Share2 color="#fff" size={16} />
            <Text style={styles.primaryBtnText}>Share with patient</Text>
          </TouchableOpacity>
        ) : (
          <View style={[styles.sharedBadge, { flex: 2 }]}>
            <CheckCircle2 color={Colors.success} size={16} />
            <Text style={styles.sharedBadgeText}>Shared with patient</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function StatusTag({ label, tone }: { label: string; tone: 'success' | 'neutral' }) {
  const bg = tone === 'success' ? Colors.success + '20' : Colors.textTertiary + '20';
  const fg = tone === 'success' ? Colors.success : Colors.textSecondary;
  return (
    <View style={{ backgroundColor: bg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 }}>
      <Text style={{ fontSize: 10, fontWeight: '700', color: fg }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
    overflow: 'hidden',
  },
  loading: { padding: 20, alignItems: 'center' },
  emptyCard: {
    backgroundColor: Colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
    padding: 24, alignItems: 'center', gap: 10,
  },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
  emptyBody: { fontSize: 12, color: Colors.textSecondary, textAlign: 'center', lineHeight: 18 },
  statusBar: {
    padding: 12, backgroundColor: Colors.surfaceSecondary,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  statusLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  statusLabel: { fontSize: 13, fontWeight: '700', color: Colors.text },
  previewWrap: { maxHeight: 420, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  narrativeEditor: { padding: 12, gap: 8, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  narrativeHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  narrativeLabel: { flex: 1, fontSize: 12, fontWeight: '700', color: Colors.primary, textTransform: 'uppercase' },
  editLink: { fontSize: 12, fontWeight: '600', color: Colors.primary },
  narrativeText: { fontSize: 13, color: Colors.text, lineHeight: 20 },
  narrativeTextarea: {
    minHeight: 120, padding: 10,
    backgroundColor: Colors.surface, borderRadius: 8,
    borderWidth: 1, borderColor: Colors.border,
    fontSize: 13, color: Colors.text, textAlignVertical: 'top',
  },
  editActions: { flexDirection: 'row', gap: 8 },
  actionsRow: { flexDirection: 'row', gap: 8, padding: 12 },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16,
    flex: 1,
  },
  primaryBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14,
    borderWidth: 1, borderColor: Colors.primary, flex: 1,
  },
  secondaryBtnText: { color: Colors.primary, fontSize: 13, fontWeight: '600' },
  sharedBadge: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: Colors.success + '15', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16,
  },
  sharedBadgeText: { color: Colors.success, fontSize: 13, fontWeight: '700' },
});
