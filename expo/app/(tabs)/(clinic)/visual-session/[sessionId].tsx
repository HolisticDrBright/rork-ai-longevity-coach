import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
  Linking,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CheckCircle, AlertTriangle, Mail, Eye } from 'lucide-react-native';

import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';

type ImageRow = {
  id: string;
  modality: string;
  angle: string;
  storage_key: string;
  mime_type: string;
  captured_at: string;
};

// Resolves a Storage key to a short-lived signed URL so an <Image>
// can render it. Caches the URL for its TTL (~5 min from
// visualDiagnostics.getSignedAssetUrl).
function SessionImage({ storageKey, modality, angle }: { storageKey: string; modality: string; angle: string }) {
  const urlQuery = trpc.visualDiagnostics.getSignedAssetUrl.useQuery(
    { storageKey },
    { enabled: !!storageKey, staleTime: 4 * 60 * 1000 },
  );
  return (
    <View style={imageStyles.tile}>
      {urlQuery.data?.url ? (
        <Image source={{ uri: urlQuery.data.url }} style={imageStyles.img} resizeMode="cover" />
      ) : urlQuery.isError ? (
        <View style={imageStyles.errorBox}>
          <Text style={imageStyles.errorText}>Image unavailable</Text>
        </View>
      ) : (
        <View style={imageStyles.loading}>
          <ActivityIndicator color={Colors.primary} size="small" />
        </View>
      )}
      <Text style={imageStyles.caption}>{modality} · {angle}</Text>
    </View>
  );
}

const imageStyles = StyleSheet.create({
  tile: { width: 140, marginRight: 8 },
  img: { width: 140, height: 140, borderRadius: 8, backgroundColor: Colors.surfaceSecondary },
  loading: { width: 140, height: 140, borderRadius: 8, backgroundColor: Colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  errorBox: { width: 140, height: 140, borderRadius: 8, backgroundColor: Colors.danger + '15', alignItems: 'center', justifyContent: 'center' },
  errorText: { fontSize: 11, color: Colors.danger, textAlign: 'center', paddingHorizontal: 8 },
  caption: { fontSize: 11, color: Colors.textSecondary, marginTop: 4, textAlign: 'center' },
});

type RedFlagRow = {
  id: string;
  modality: string;
  severity: string;
  observation: string;
  recommended_action: string | null;
  acknowledged_at: string | null;
  clinic_alert_event_id: string | null;
};

type RecommendationRender = {
  id: string;
  finding_tags: string[];
  exclusions: string[];
  db_version_used: number;
  products_returned: Record<string, unknown>[];
  copy_generated: string | null;
  created_at: string;
};

export default function PractitionerVisualSessionScreen() {
  const params = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const sessionId = params.sessionId ?? '';

  const [reviewerNotes, setReviewerNotes] = useState('');

  const sessionQuery = trpc.visualDiagnostics.getSession.useQuery(
    { sessionId },
    { enabled: !!sessionId }
  );
  const rendersQuery = trpc.visualDiagnostics.listRecommendationRenders.useQuery(
    { sessionId },
    { enabled: !!sessionId }
  );

  const signOffMut = trpc.visualDiagnostics.signOffSession.useMutation({
    onSuccess: () => {
      Alert.alert('Signed off', 'Session marked as reviewed.');
      sessionQuery.refetch();
    },
    onError: (e) => Alert.alert('Sign-off failed', e.message),
  });

  const ackMut = trpc.visualDiagnostics.acknowledgeRedFlag.useMutation({
    onSuccess: () => sessionQuery.refetch(),
  });

  const handleSignOff = useCallback(() => {
    Alert.alert(
      'Sign off this assessment?',
      'This marks all findings as reviewed by Dr. Bright. The patient will see the "Signed off" status.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign off',
          style: 'default',
          onPress: () => signOffMut.mutate({ sessionId, reviewerNotes: reviewerNotes.trim() || undefined }),
        },
      ]
    );
  }, [sessionId, reviewerNotes, signOffMut]);

  const handleAck = useCallback(
    (id: string) => {
      ackMut.mutate({ redFlagId: id });
    },
    [ackMut]
  );

  const emailReport = useCallback(() => {
    if (!sessionQuery.data) return;
    const s = sessionQuery.data;
    const lines: string[] = [];
    lines.push(`Visual Assessment Report — ${new Date(s.session.captured_at).toLocaleString()}`);
    lines.push(`Session ID: ${s.session.id}`);
    if (s.session.visual_health_index != null) {
      lines.push(`Visual Health Index: ${Math.round(s.session.visual_health_index * 100)}/100`);
    }
    lines.push('');
    if (s.convergent.length > 0) {
      lines.push('Convergent findings:');
      for (const c of s.convergent) {
        lines.push(`  - ${c.tag} (${Math.round(c.combined_confidence * 100)}%, ${c.contributing_modalities.join(', ')})`);
      }
      lines.push('');
    }
    if (s.redFlags.length > 0) {
      lines.push('Red flags:');
      for (const rf of s.redFlags) {
        lines.push(`  - [${rf.severity}] ${rf.observation}`);
        if (rf.recommended_action) lines.push(`    Recommended: ${rf.recommended_action}`);
      }
      lines.push('');
    }
    lines.push('Observational findings only. Reviewed by Dr. Bright, DAOM, L.Ac., Functional Medicine certified. Rx is always via prescribing MD/NP partner.');

    const subject = `Visual Assessment — ${new Date(s.session.captured_at).toLocaleDateString()}`;
    const body = encodeURIComponent(lines.join('\n'));
    const url = `mailto:?subject=${encodeURIComponent(subject)}&body=${body}`;
    Linking.openURL(url).catch(() => Alert.alert('Email unavailable', 'No mail client found on this device.'));
  }, [sessionQuery.data]);

  if (sessionQuery.isLoading) {
    return (
      <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={Colors.primary} />
      </SafeAreaView>
    );
  }

  if (sessionQuery.isError || !sessionQuery.data) {
    return (
      <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={styles.errorText}>
          {sessionQuery.error?.message ?? 'Assessment not found.'}
        </Text>
      </SafeAreaView>
    );
  }

  const s = sessionQuery.data;
  const isSignedOff = s.session.status === 'signed_off';

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Header */}
        <View style={styles.headerCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerDate}>{new Date(s.session.captured_at).toLocaleString()}</Text>
            <Text style={styles.headerMeta}>Patient {s.session.user_id.slice(0, 8)}…</Text>
            {s.session.visual_health_index != null && (
              <Text style={styles.headerVhi}>VHI {Math.round(s.session.visual_health_index * 100)}/100</Text>
            )}
          </View>
          <View style={[styles.statusPill, { backgroundColor: isSignedOff ? Colors.success + '20' : Colors.primary + '20' }]}>
            <Text style={[styles.statusPillText, { color: isSignedOff ? Colors.success : Colors.primary }]}>
              {isSignedOff ? 'Signed off' : 'Pending review'}
            </Text>
          </View>
        </View>

        {/* Captured images — practitioner needs to see source to verify findings */}
        {(s.images as ImageRow[] | undefined) && (s.images as ImageRow[]).length > 0 && (
          <>
            <Text style={styles.sectionHeader}>Captured images</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
              {(s.images as ImageRow[]).map((img) => (
                <SessionImage
                  key={img.id}
                  storageKey={img.storage_key}
                  modality={img.modality}
                  angle={img.angle}
                />
              ))}
            </ScrollView>
          </>
        )}

        {/* Per-modality findings */}
        <Text style={styles.sectionHeader}>Per-modality findings</Text>
        {s.findings.map((f) => (
          <View key={f.modality} style={styles.findingCard}>
            <View style={styles.findingHeader}>
              <Text style={styles.findingModality}>{f.modality}</Text>
              {f.confidence != null && (
                <Text style={styles.findingConfidence}>
                  {Math.round(f.confidence * 100)}% confidence
                </Text>
              )}
            </View>
            {f.cross_modality_tags.length > 0 && (
              <View style={styles.tagRow}>
                {f.cross_modality_tags.slice(0, 12).map((t: string) => (
                  <View key={t} style={styles.tag}>
                    <Text style={styles.tagText}>{t}</Text>
                  </View>
                ))}
              </View>
            )}
            <Text style={styles.versionMeta}>
              Prompt: {f.prompt_version}  ·  Model: {f.model_version}
            </Text>
          </View>
        ))}

        {/* Convergent */}
        <Text style={styles.sectionHeader}>Convergent across modalities ({s.convergent.length})</Text>
        {s.convergent.length === 0 ? (
          <Text style={styles.muted}>No convergent findings (require ≥2 modalities + combined confidence ≥0.7).</Text>
        ) : (
          s.convergent.map((c) => (
            <View key={c.tag} style={styles.convergentCard}>
              <View style={styles.convergentHeader}>
                <Text style={styles.convergentTag}>{c.tag}</Text>
                <Text style={styles.convergentConf}>{Math.round(c.combined_confidence * 100)}%</Text>
              </View>
              <Text style={styles.convergentMeta}>
                {c.contributing_modalities.join(' + ')}
                {c.trend ? `   ·   ${c.trend} vs prior` : ''}
              </Text>
            </View>
          ))
        )}

        {/* Red flags with ack */}
        {s.redFlags.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>Red flags ({s.redFlags.length})</Text>
            {(s.redFlags as RedFlagRow[]).map((rf) => (
              <View
                key={rf.id}
                style={[
                  styles.redFlagCard,
                  rf.severity === 'critical' && styles.redFlagCritical,
                  rf.acknowledged_at && styles.redFlagAcked,
                ]}
              >
                <View style={styles.redFlagHeader}>
                  <AlertTriangle size={14} color={rf.severity === 'critical' ? Colors.danger : Colors.warning} />
                  <Text style={[styles.redFlagSeverity, { color: rf.severity === 'critical' ? Colors.danger : Colors.warning }]}>
                    {rf.severity}
                  </Text>
                  <Text style={styles.redFlagModality}>{rf.modality}</Text>
                </View>
                <Text style={styles.redFlagObservation}>{rf.observation}</Text>
                {rf.recommended_action && (
                  <Text style={styles.redFlagAction}>Recommended: {rf.recommended_action}</Text>
                )}
                {rf.clinic_alert_event_id && (
                  <Text style={styles.alertEventLink}>↳ clinic_alert_events linked</Text>
                )}
                {rf.acknowledged_at ? (
                  <Text style={styles.ackedText}>Acknowledged · {new Date(rf.acknowledged_at).toLocaleString()}</Text>
                ) : (
                  <TouchableOpacity
                    style={styles.ackBtn}
                    onPress={() => handleAck(rf.id)}
                    disabled={ackMut.isPending}
                  >
                    <Eye size={12} color={Colors.primary} />
                    <Text style={styles.ackBtnText}>Acknowledge</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </>
        )}

        {/* Recommendation renders — "Why this product?" drill-down */}
        {rendersQuery.data && rendersQuery.data.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>Why these recommendations</Text>
            {(rendersQuery.data as RecommendationRender[]).map((r) => (
              <View key={r.id} style={styles.renderCard}>
                <Text style={styles.renderTags}>{r.finding_tags.join(', ')}</Text>
                <Text style={styles.renderMeta}>
                  {r.products_returned.length} product{r.products_returned.length === 1 ? '' : 's'}  ·  db v{r.db_version_used}
                </Text>
                {r.exclusions.length > 0 && (
                  <Text style={styles.renderExclusions}>
                    Filtered out: {r.exclusions.join(', ')}
                  </Text>
                )}
                {r.copy_generated && <Text style={styles.renderCopy}>{r.copy_generated}</Text>}
              </View>
            ))}
          </>
        )}

        {/* Sign-off + Email actions */}
        {!isSignedOff && (
          <View style={styles.signOffCard}>
            <Text style={styles.signOffHeader}>Reviewer notes (optional)</Text>
            <TextInput
              style={styles.notesInput}
              value={reviewerNotes}
              onChangeText={setReviewerNotes}
              placeholder="Anything to add to the patient's record…"
              placeholderTextColor={Colors.textTertiary}
              multiline
              maxLength={2000}
            />
            <TouchableOpacity
              style={[styles.signOffBtn, signOffMut.isPending && styles.btnDisabled]}
              onPress={handleSignOff}
              disabled={signOffMut.isPending}
            >
              {signOffMut.isPending ? (
                <ActivityIndicator size="small" color={Colors.textInverse} />
              ) : (
                <CheckCircle size={16} color={Colors.textInverse} />
              )}
              <Text style={styles.signOffBtnText}>
                {signOffMut.isPending ? 'Signing off…' : 'Sign off & complete'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity style={styles.emailBtn} onPress={emailReport}>
          <Mail size={16} color={Colors.text} />
          <Text style={styles.emailBtnText}>Email this report</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Back to review queue</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 16, paddingBottom: 48 },
  headerCard: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    padding: 14,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    alignItems: 'center',
    gap: 12,
  },
  headerDate: { fontSize: 14, fontWeight: '600', color: Colors.text },
  headerMeta: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  headerVhi: { fontSize: 12, color: Colors.primary, marginTop: 2, fontWeight: '500' },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusPillText: { fontSize: 11, fontWeight: '600' },

  sectionHeader: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    marginTop: 16,
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  muted: { fontSize: 12, color: Colors.textSecondary, fontStyle: 'italic' },

  findingCard: {
    backgroundColor: Colors.surface,
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  findingHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  findingModality: { fontSize: 14, fontWeight: '600', color: Colors.text, textTransform: 'capitalize' },
  findingConfidence: { fontSize: 11, color: Colors.primary, fontWeight: '500' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginVertical: 6 },
  tag: { backgroundColor: Colors.primary + '15', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  tagText: { fontSize: 10, color: Colors.primary, fontWeight: '500' },
  versionMeta: { fontSize: 10, color: Colors.textTertiary, marginTop: 4, fontFamily: 'monospace' },

  convergentCard: {
    backgroundColor: Colors.surface,
    padding: 12,
    borderRadius: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  convergentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  convergentTag: { fontSize: 13, fontWeight: '600', color: Colors.text },
  convergentConf: { fontSize: 12, color: Colors.primary, fontWeight: '600' },
  convergentMeta: { fontSize: 11, color: Colors.textSecondary, marginTop: 4 },

  redFlagCard: {
    backgroundColor: Colors.warning + '10',
    padding: 12,
    borderRadius: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: Colors.warning + '40',
  },
  redFlagCritical: { backgroundColor: Colors.danger + '10', borderColor: Colors.danger + '40' },
  redFlagAcked: { opacity: 0.6 },
  redFlagHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  redFlagSeverity: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  redFlagModality: { fontSize: 11, color: Colors.textSecondary, marginLeft: 'auto', textTransform: 'capitalize' },
  redFlagObservation: { fontSize: 13, color: Colors.text, lineHeight: 18 },
  redFlagAction: { fontSize: 11, color: Colors.textSecondary, marginTop: 4, fontStyle: 'italic' },
  alertEventLink: { fontSize: 10, color: Colors.primary, marginTop: 4 },
  ackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primary + '15',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  ackBtnText: { fontSize: 12, color: Colors.primary, fontWeight: '600' },
  ackedText: { fontSize: 11, color: Colors.success, marginTop: 6, fontWeight: '500' },

  renderCard: {
    backgroundColor: Colors.surface,
    padding: 12,
    borderRadius: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  renderTags: { fontSize: 12, fontWeight: '600', color: Colors.text },
  renderMeta: { fontSize: 11, color: Colors.textSecondary, marginTop: 4 },
  renderExclusions: { fontSize: 10, color: Colors.warning, marginTop: 4 },
  renderCopy: { fontSize: 12, color: Colors.text, marginTop: 6, lineHeight: 16, fontStyle: 'italic' },

  signOffCard: {
    backgroundColor: Colors.surface,
    padding: 14,
    borderRadius: 12,
    marginTop: 20,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  signOffHeader: { fontSize: 12, color: Colors.textSecondary, marginBottom: 8 },
  notesInput: {
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
    color: Colors.text,
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: 10,
  },
  signOffBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.success,
    paddingVertical: 12,
    borderRadius: 8,
  },
  signOffBtnText: { color: Colors.textInverse, fontWeight: '600' },
  btnDisabled: { opacity: 0.6 },
  emailBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.surfaceSecondary,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 10,
  },
  emailBtnText: { color: Colors.text, fontWeight: '500' },
  backBtn: { padding: 14, alignItems: 'center' },
  backBtnText: { fontSize: 13, color: Colors.primary, fontWeight: '500' },
  errorText: { fontSize: 14, color: Colors.danger, padding: 24 },
});
