import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  Share,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { AlertTriangle, Share2, ChevronDown, ChevronUp, Info } from 'lucide-react-native';

import Colors from '@/constants/colors';
import { fetchSessionDetail, type SessionDetail, type VisualSessionStatus } from '@/lib/visualAnalyzerClient';

const STATUS_TONE: Record<VisualSessionStatus, { color: string; label: string }> = {
  pending: { color: Colors.warning, label: 'Queued' },
  analyzing: { color: Colors.warning, label: 'Analyzing' },
  correlating: { color: Colors.warning, label: 'Correlating' },
  rendering: { color: Colors.warning, label: 'Rendering' },
  review_pending: { color: Colors.primary, label: 'Awaiting practitioner review' },
  signed_off: { color: Colors.success, label: 'Reviewed & signed off' },
  render_failed: { color: Colors.danger, label: 'Render failed' },
  failed: { color: Colors.danger, label: 'Failed' },
};

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={styles.section}>
      <TouchableOpacity style={styles.sectionHeader} onPress={() => setOpen(!open)}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {open ? <ChevronUp size={18} color={Colors.textSecondary} /> : <ChevronDown size={18} color={Colors.textSecondary} />}
      </TouchableOpacity>
      {open && <View style={styles.sectionBody}>{children}</View>}
    </View>
  );
}

function shareReport(detail: SessionDetail): void {
  const lines: string[] = [];
  lines.push(`Visual Assessment — ${new Date(detail.session.captured_at).toLocaleString()}`);
  if (detail.session.visual_health_index != null) {
    lines.push(`Visual Health Index: ${Math.round(detail.session.visual_health_index * 100)}/100`);
  }
  if (detail.convergent.length > 0) {
    lines.push('\nConvergent findings:');
    for (const c of detail.convergent) {
      lines.push(`  • ${c.tag} — ${(c.combined_confidence * 100).toFixed(0)}% confidence across ${c.contributing_modalities.join(', ')}`);
    }
  }
  if (detail.redFlags.length > 0) {
    lines.push('\nRed flags requiring practitioner attention:');
    for (const rf of detail.redFlags) {
      lines.push(`  • [${rf.severity}] ${rf.observation}`);
    }
  }
  lines.push('\nObservational findings only. Reviewed by Dr. Bright (DAOM, L.Ac.) before sign-off.');
  Share.share({ message: lines.join('\n') }).catch(() => undefined);
}

export default function SessionDetailScreen() {
  const params = useLocalSearchParams<{ sessionId: string }>();
  const sessionId = params.sessionId ?? '';

  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const load = useCallback(async () => {
    const data = await fetchSessionDetail(sessionId);
    setDetail(data);
  }, [sessionId]);

  useEffect(() => {
    load().finally(() => setIsLoading(false));
  }, [load]);

  // Auto-refresh while still analyzing/correlating. We depend on the
  // status STRING (not the full detail object) so the interval doesn't
  // tear down / re-create on every poll tick. A ref to the load fn
  // keeps the effect dep list stable across re-renders. (Audit bug #13.)
  const loadRef = useRef(load);
  loadRef.current = load;
  const status = detail?.session.status;
  useEffect(() => {
    if (!status) return;
    const isTerminal =
      status === 'review_pending' ||
      status === 'signed_off' ||
      status === 'failed' ||
      status === 'render_failed';
    if (isTerminal) return;
    const interval = setInterval(() => loadRef.current(), 3000);
    return () => clearInterval(interval);
  }, [status]);

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={Colors.primary} />
      </SafeAreaView>
    );
  }

  if (!detail) {
    return (
      <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={styles.errorText}>Assessment not found.</Text>
      </SafeAreaView>
    );
  }

  const tone = STATUS_TONE[detail.session.status];
  const vhi = detail.session.visual_health_index;
  const vhiPct = vhi != null ? Math.round(vhi * 100) : null;

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={async () => {
              setIsRefreshing(true);
              await load();
              setIsRefreshing(false);
            }}
          />
        }
      >
        {/* Header */}
        <View style={styles.headerCard}>
          <View style={[styles.statusDot, { backgroundColor: tone.color }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.headerDate}>{new Date(detail.session.captured_at).toLocaleString()}</Text>
            <Text style={[styles.headerStatus, { color: tone.color }]}>{tone.label}</Text>
          </View>
          {vhiPct != null && (
            <View style={styles.vhiPill}>
              <Text style={styles.vhiPillNum}>{vhiPct}</Text>
              <Text style={styles.vhiPillLabel}>VHI</Text>
            </View>
          )}
        </View>

        {/* Modality findings */}
        <Section title={`Per-modality findings (${detail.findings.length})`}>
          {detail.findings.length === 0 ? (
            <Text style={styles.muted}>Analysis still in progress…</Text>
          ) : (
            detail.findings.map((f) => (
              <View key={f.modality} style={styles.findingCard}>
                <Text style={styles.findingModality}>{f.modality}</Text>
                {f.confidence != null && (
                  <Text style={styles.findingConfidence}>
                    Confidence: {Math.round(f.confidence * 100)}%
                  </Text>
                )}
                {f.cross_modality_tags.length > 0 && (
                  <View style={styles.tagRow}>
                    {f.cross_modality_tags.slice(0, 8).map((t) => (
                      <View key={t} style={styles.tag}>
                        <Text style={styles.tagText}>{t}</Text>
                      </View>
                    ))}
                  </View>
                )}
                {f.red_flags && f.red_flags.length > 0 && (
                  <Text style={styles.redFlagInline}>
                    {f.red_flags.length} red flag{f.red_flags.length === 1 ? '' : 's'} — see below
                  </Text>
                )}
              </View>
            ))
          )}
        </Section>

        {/* Convergent findings — the cross-modality story */}
        <Section title={`Convergent findings (${detail.convergent.length})`}>
          {detail.convergent.length === 0 ? (
            <Text style={styles.muted}>No findings supported by two or more modalities.</Text>
          ) : (
            detail.convergent.map((c) => (
              <View key={c.tag} style={styles.convergentCard}>
                <View style={styles.convergentHeader}>
                  <Text style={styles.convergentTag}>{c.tag}</Text>
                  <Text style={styles.convergentConfidence}>
                    {Math.round(c.combined_confidence * 100)}%
                  </Text>
                </View>
                <Text style={styles.convergentMeta}>
                  Across {c.contributing_modalities.length} {c.contributing_modalities.length === 1 ? 'modality' : 'modalities'}: {c.contributing_modalities.join(', ')}
                  {c.trend ? `  ·  ${c.trend} vs prior` : ''}
                </Text>
              </View>
            ))
          )}
        </Section>

        {/* Divergent findings */}
        {detail.divergent.length > 0 && (
          <Section title={`Divergent findings (${detail.divergent.length})`} defaultOpen={false}>
            {detail.divergent.map((d, i) => (
              <View key={`${d.tag_a}-${d.tag_b}-${i}`} style={styles.divergentCard}>
                <Text style={styles.divergentText}>
                  {d.tag_a}  vs  {d.tag_b}
                </Text>
                {d.note && <Text style={styles.divergentNote}>{d.note}</Text>}
              </View>
            ))}
          </Section>
        )}

        {/* Red flags */}
        {detail.redFlags.length > 0 && (
          <Section title={`Red flags — practitioner attention (${detail.redFlags.length})`}>
            {detail.redFlags.map((rf) => (
              <View
                key={rf.modality + rf.observation}
                style={[styles.redFlagCard, rf.severity === 'critical' && styles.redFlagCritical]}
              >
                <View style={styles.redFlagHeader}>
                  <AlertTriangle size={16} color={rf.severity === 'critical' ? Colors.danger : Colors.warning} />
                  <Text style={[styles.redFlagSeverity, { color: rf.severity === 'critical' ? Colors.danger : Colors.warning }]}>
                    {rf.severity}
                  </Text>
                  <Text style={styles.redFlagModality}>{rf.modality}</Text>
                </View>
                <Text style={styles.redFlagObservation}>{rf.observation}</Text>
                {rf.recommended_action && (
                  <Text style={styles.redFlagAction}>Recommended: {rf.recommended_action}</Text>
                )}
                {rf.acknowledged_at && (
                  <Text style={styles.redFlagAck}>Acknowledged by practitioner</Text>
                )}
              </View>
            ))}
          </Section>
        )}

        {/* Share */}
        <TouchableOpacity style={styles.shareBtn} onPress={() => shareReport(detail)}>
          <Share2 size={16} color={Colors.textInverse} />
          <Text style={styles.shareBtnText}>Share report summary</Text>
        </TouchableOpacity>

        {Platform.OS === 'web' && (
          <View style={styles.webNoteCard}>
            <Info size={14} color={Colors.textSecondary} />
            <Text style={styles.webNoteText}>
              Native share-sheet is fully available on iOS and Android. Web uses the browser share API where supported.
            </Text>
          </View>
        )}

        <View style={styles.disclosureCard}>
          <Text style={styles.disclosureText}>
            All findings are observational and reviewed by Dr. Bright (DAOM, L.Ac., Functional Medicine certified) before sign-off. Prescription items, where mentioned, are always via her prescribing MD/NP partner.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 16, paddingBottom: 48 },
  headerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  headerDate: { fontSize: 14, color: Colors.text, fontWeight: '500' },
  headerStatus: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  vhiPill: {
    alignItems: 'center',
    backgroundColor: Colors.primary + '15',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  vhiPillNum: { fontSize: 18, fontWeight: '700', color: Colors.primary },
  vhiPillLabel: { fontSize: 9, color: Colors.primary, fontWeight: '600' },

  section: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
  },
  sectionTitle: { fontSize: 14, fontWeight: '600', color: Colors.text },
  sectionBody: { paddingHorizontal: 14, paddingBottom: 14, gap: 8 },
  muted: { fontSize: 12, color: Colors.textSecondary, fontStyle: 'italic' },

  findingCard: { backgroundColor: Colors.surfaceSecondary, padding: 10, borderRadius: 8 },
  findingModality: { fontSize: 13, fontWeight: '600', color: Colors.text, textTransform: 'capitalize' },
  findingConfidence: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 8 },
  tag: { backgroundColor: Colors.primary + '15', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  tagText: { fontSize: 10, color: Colors.primary, fontWeight: '500' },
  redFlagInline: { fontSize: 11, color: Colors.warning, marginTop: 6, fontWeight: '500' },

  convergentCard: { backgroundColor: Colors.surfaceSecondary, padding: 10, borderRadius: 8 },
  convergentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  convergentTag: { fontSize: 13, fontWeight: '600', color: Colors.text },
  convergentConfidence: { fontSize: 12, color: Colors.primary, fontWeight: '600' },
  convergentMeta: { fontSize: 11, color: Colors.textSecondary, marginTop: 4 },

  divergentCard: { backgroundColor: Colors.surfaceSecondary, padding: 10, borderRadius: 8 },
  divergentText: { fontSize: 13, color: Colors.text, fontWeight: '500' },
  divergentNote: { fontSize: 11, color: Colors.textSecondary, marginTop: 4 },

  redFlagCard: {
    backgroundColor: Colors.warning + '10',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.warning + '40',
  },
  redFlagCritical: { backgroundColor: Colors.danger + '10', borderColor: Colors.danger + '40' },
  redFlagHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  redFlagSeverity: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  redFlagModality: { fontSize: 11, color: Colors.textSecondary, marginLeft: 'auto', textTransform: 'capitalize' },
  redFlagObservation: { fontSize: 13, color: Colors.text, lineHeight: 18 },
  redFlagAction: { fontSize: 11, color: Colors.textSecondary, marginTop: 4, fontStyle: 'italic' },
  redFlagAck: { fontSize: 11, color: Colors.success, marginTop: 4, fontWeight: '500' },

  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    padding: 12,
    borderRadius: 8,
    marginTop: 12,
  },
  shareBtnText: { color: Colors.textInverse, fontWeight: '600' },

  webNoteCard: { flexDirection: 'row', gap: 6, padding: 8, marginTop: 8 },
  webNoteText: { flex: 1, fontSize: 11, color: Colors.textSecondary },

  disclosureCard: { backgroundColor: Colors.surfaceSecondary, padding: 12, borderRadius: 8, marginTop: 16 },
  disclosureText: { fontSize: 11, color: Colors.textSecondary, lineHeight: 16 },

  errorText: { fontSize: 14, color: Colors.danger },
});
