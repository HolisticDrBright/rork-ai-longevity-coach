import { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, Modal, Switch, SafeAreaView,
} from 'react-native';
import { Stack, router } from 'expo-router';
import {
  FlaskConical, AlertTriangle, ArrowLeft, Info, MessageSquare, ChevronRight, X,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import ParadigmChip, { ALL_PARADIGMS, type Paradigm, PARADIGM_LABELS } from '@/components/patterns/ParadigmChip';

export default function ExperimentalInsightsScreen() {
  const flagStateQuery = trpc.patterns.getClaudeFlagState.useQuery();
  const patternsQuery = trpc.patterns.listMyExperimentalPatterns.useQuery(undefined, {
    enabled: !!flagStateQuery.data?.surfaceFlagEnabled && !!flagStateQuery.data?.surfaceOptedIn,
  });
  const acknowledgeMutation = trpc.patterns.acknowledgeExperimental.useMutation();
  const hideParadigmsMutation = trpc.patterns.setHiddenParadigms.useMutation();
  const optInMutation = trpc.patterns.setSurfaceExperimentalInsights.useMutation();
  const utils = trpc.useUtils();

  const [selectedPattern, setSelectedPattern] = useState<any | null>(null);
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);

  const flagState = flagStateQuery.data as any;

  // If the flag is off at the server level, hide the whole screen.
  if (flagStateQuery.isLoading) {
    return <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>;
  }
  if (!flagState?.surfaceFlagEnabled) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}><ArrowLeft color={Colors.text} size={22} /></TouchableOpacity>
          <Text style={styles.headerTitle}>Experimental Insights</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.center}>
          <FlaskConical color={Colors.textTertiary} size={40} />
          <Text style={styles.emptyTitle}>Not available</Text>
          <Text style={styles.emptyBody}>
            This experimental surface is disabled on your account. Contact your practitioner if you're
            interested in participating.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // Opt-in prompt if user has access but hasn't turned it on.
  if (!flagState?.surfaceOptedIn) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}><ArrowLeft color={Colors.text} size={22} /></TouchableOpacity>
          <Text style={styles.headerTitle}>Experimental Insights</Text>
          <View style={{ width: 24 }} />
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.consentCard}>
            <FlaskConical color={Colors.primary} size={32} />
            <Text style={styles.consentTitle}>Experimental insights — opt in</Text>
            <Text style={styles.consentBody}>
              When you opt in, we may surface research-stage patterns we've discovered in our
              cohort — associations between symptoms, biomarkers, wearables, and interventions that
              our practitioner has reviewed and promoted to "research signal" status.
            </Text>
            <View style={styles.disclaimerBox}>
              <AlertTriangle color={Colors.warning} size={16} />
              <Text style={styles.disclaimerText}>
                These are HYPOTHESES, not medical advice. They're surfaced for your curiosity and
                discussion with your practitioner. They haven't been validated clinically.
              </Text>
            </View>
            <View style={styles.checkRow}>
              <Switch value={consentChecked} onValueChange={setConsentChecked}
                trackColor={{ true: Colors.primary, false: Colors.borderLight }} />
              <Text style={styles.checkText}>I understand these are experimental and not medical advice</Text>
            </View>
            <TouchableOpacity
              style={[styles.optInBtn, !consentChecked && styles.optInBtnDisabled]}
              onPress={async () => {
                if (!consentChecked) return;
                try {
                  await optInMutation.mutateAsync({ enabled: true });
                  await utils.patterns.getClaudeFlagState.invalidate();
                } catch (e: any) { Alert.alert('Error', e?.message ?? 'Opt-in failed'); }
              }}
              disabled={!consentChecked || optInMutation.isPending}
            >
              {optInMutation.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.optInBtnText}>Enable experimental insights</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const patterns = (patternsQuery.data as any[] | undefined) ?? [];

  const handleSelect = async (pattern: any) => {
    const exposure = (pattern.patient_pattern_exposures ?? [])[0];
    if (!exposure?.acknowledged_experimental) {
      // Require acknowledgment before showing details
      setSelectedPattern(pattern);
      setShowConsentModal(true);
    } else {
      setSelectedPattern(pattern);
    }
  };

  const handleAcknowledge = useCallback(async () => {
    if (!selectedPattern) return;
    try {
      await acknowledgeMutation.mutateAsync({ patternId: selectedPattern.id });
      await utils.patterns.listMyExperimentalPatterns.invalidate();
      setShowConsentModal(false);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to acknowledge');
    }
  }, [selectedPattern, acknowledgeMutation, utils]);

  const handleToggleHidden = useCallback(async (paradigm: Paradigm) => {
    if (!selectedPattern) return;
    const exposure = (selectedPattern.patient_pattern_exposures ?? [])[0];
    const current: Paradigm[] = exposure?.hidden_paradigms ?? [];
    const next = current.includes(paradigm)
      ? current.filter(p => p !== paradigm)
      : [...current, paradigm];
    try {
      await hideParadigmsMutation.mutateAsync({
        patternId: selectedPattern.id,
        hiddenParadigms: next,
      });
      await utils.patterns.listMyExperimentalPatterns.invalidate();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to update preferences');
    }
  }, [selectedPattern, hideParadigmsMutation, utils]);

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}><ArrowLeft color={Colors.text} size={22} /></TouchableOpacity>
        <Text style={styles.headerTitle}>Experimental Insights</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Persistent banner */}
      <View style={styles.experimentalBanner}>
        <FlaskConical color={Colors.warning} size={14} />
        <Text style={styles.bannerText}>
          Experimental · Research-only · Not medical advice
        </Text>
      </View>

      {!selectedPattern ? (
        <ScrollView contentContainerStyle={styles.content}>
          {patternsQuery.isLoading ? (
            <ActivityIndicator color={Colors.primary} />
          ) : patterns.length === 0 ? (
            <View style={styles.empty}>
              <FlaskConical color={Colors.textTertiary} size={32} />
              <Text style={styles.emptyTitle}>No insights yet</Text>
              <Text style={styles.emptyBody}>
                Your practitioner hasn't promoted any patterns to research-signal status for you yet.
                Check back after your next appointment.
              </Text>
            </View>
          ) : (
            patterns.map(p => {
              const exposure = (p.patient_pattern_exposures ?? [])[0];
              const acknowledged = !!exposure?.acknowledged_experimental;
              return (
                <TouchableOpacity key={p.id} style={styles.patternCard} onPress={() => handleSelect(p)}>
                  <View style={styles.patternCardHeader}>
                    <Text style={styles.patternCardKind}>{p.kind.replace(/_/g, ' ')}</Text>
                    {!acknowledged && (
                      <View style={styles.newBadge}>
                        <Text style={styles.newBadgeText}>NEW</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.patternCardTitle}>
                    {p.left_entity?.label} · {p.right_entity?.label}
                  </Text>
                  {p.patient_visible_statistics && (
                    <Text style={styles.patternCardMeta}>
                      Based on {p.n_patients} patients in our cohort
                    </Text>
                  )}
                  <ChevronRight color={Colors.textTertiary} size={16} style={{ position: 'absolute', right: 14, top: 24 }} />
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <TouchableOpacity style={styles.backRow} onPress={() => setSelectedPattern(null)}>
            <ArrowLeft color={Colors.primary} size={16} />
            <Text style={styles.backText}>Back to all insights</Text>
          </TouchableOpacity>

          <Text style={styles.detailTitle}>
            {selectedPattern.left_entity?.label} · {selectedPattern.right_entity?.label}
          </Text>
          <Text style={styles.detailSub}>{selectedPattern.kind.replace(/_/g, ' ')}</Text>

          {/* Paradigm display toggles */}
          <View style={styles.lensToggleBlock}>
            <Text style={styles.lensLabel}>Display lenses</Text>
            <Text style={styles.lensHint}>
              Toggle to hide any paradigm you'd rather not read. Your preferences don't affect generation.
            </Text>
            <View style={styles.paradigmRow}>
              {ALL_PARADIGMS.map(p => {
                const hidden = ((selectedPattern.patient_pattern_exposures ?? [])[0]?.hidden_paradigms ?? []).includes(p);
                return (
                  <ParadigmChip
                    key={p}
                    paradigm={p}
                    filled={!hidden}
                    onPress={() => handleToggleHidden(p)}
                  />
                );
              })}
            </View>
          </View>

          {/* Hypotheses */}
          {(selectedPattern.pattern_hypotheses ?? []).map((h: any) => (
            <View key={h.id} style={styles.hypoCard}>
              <ParadigmChip paradigm={h.paradigm} filled compact />
              <Text style={[styles.hypoMech, { marginTop: 8 }]}>{h.mechanism}</Text>
              <Text style={styles.hypoRationale}>{h.rationale}</Text>
              {h.safety_concerns && h.safety_concerns.length > 0 && (
                <View style={styles.cautionBox}>
                  <AlertTriangle color={Colors.warning} size={12} />
                  <Text style={styles.cautionText}>
                    {h.safety_concerns.join(' · ')}
                  </Text>
                </View>
              )}
            </View>
          ))}

          {/* CTA */}
          <TouchableOpacity
            style={styles.discussBtn}
            onPress={() => Alert.alert('Message sent', 'Your practitioner will see this on their dashboard.')}
          >
            <MessageSquare color="#fff" size={16} />
            <Text style={styles.discussText}>Discuss with my practitioner</Text>
          </TouchableOpacity>

          <Text style={styles.footerNote}>
            This framing is experimental. It reflects research-stage associations in our cohort and
            paradigm-specific interpretations. It is not a diagnosis and should not change your protocol
            without discussing with your practitioner.
          </Text>
        </ScrollView>
      )}

      {/* First-view consent modal */}
      <Modal visible={showConsentModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <FlaskConical color={Colors.primary} size={20} />
              <Text style={styles.modalTitle}>Before we show this</Text>
              <TouchableOpacity onPress={() => { setSelectedPattern(null); setShowConsentModal(false); }}>
                <X color={Colors.textSecondary} size={20} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalBody}>
              This insight is a research-stage hypothesis — a pattern our practitioner saw in the
              cohort and thought was worth sharing. It has not been clinically validated.
            </Text>
            <View style={styles.disclaimerBox}>
              <Info color={Colors.primary} size={14} />
              <Text style={styles.disclaimerText}>
                Reading this will not change your protocol. Bring anything interesting to your next
                appointment. You can hide any paradigm you don't want to see on the detail screen.
              </Text>
            </View>
            <TouchableOpacity
              style={styles.modalBtn}
              onPress={handleAcknowledge}
              disabled={acknowledgeMutation.isPending}
            >
              {acknowledgeMutation.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.modalBtnText}>I understand — show me the insight</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 10 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  headerTitle: { fontSize: 16, fontWeight: '700', color: Colors.text },
  experimentalBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.warning + '15',
    paddingHorizontal: 16, paddingVertical: 6,
  },
  bannerText: { fontSize: 11, fontWeight: '700', color: Colors.warning, textTransform: 'uppercase' },

  content: { padding: 16, gap: 12, paddingBottom: 40 },
  empty: { alignItems: 'center', padding: 32, gap: 10 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
  emptyBody: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', lineHeight: 18 },

  consentCard: {
    backgroundColor: Colors.surface, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border,
    padding: 18, gap: 12, alignItems: 'stretch',
  },
  consentTitle: { fontSize: 18, fontWeight: '800', color: Colors.text, marginTop: 4 },
  consentBody: { fontSize: 13, color: Colors.textSecondary, lineHeight: 20 },
  disclaimerBox: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    backgroundColor: Colors.warning + '10', borderRadius: 8,
    padding: 10,
  },
  disclaimerText: { flex: 1, fontSize: 12, color: Colors.text, lineHeight: 18 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkText: { flex: 1, fontSize: 12, color: Colors.text },
  optInBtn: {
    backgroundColor: Colors.primary, borderRadius: 10,
    paddingVertical: 12, alignItems: 'center',
  },
  optInBtnDisabled: { backgroundColor: Colors.textTertiary },
  optInBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  patternCard: {
    backgroundColor: Colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
    padding: 14, position: 'relative',
  },
  patternCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  patternCardKind: { fontSize: 10, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase' },
  newBadge: { backgroundColor: Colors.primary, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  newBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  patternCardTitle: { fontSize: 14, fontWeight: '700', color: Colors.text, marginTop: 4 },
  patternCardMeta: { fontSize: 11, color: Colors.textSecondary, marginTop: 4 },

  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  backText: { fontSize: 13, fontWeight: '600', color: Colors.primary },
  detailTitle: { fontSize: 18, fontWeight: '800', color: Colors.text },
  detailSub: { fontSize: 11, color: Colors.textSecondary, textTransform: 'uppercase', fontWeight: '600' },

  lensToggleBlock: {
    backgroundColor: Colors.surface, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.border, padding: 12, gap: 6,
  },
  lensLabel: { fontSize: 12, fontWeight: '700', color: Colors.text },
  lensHint: { fontSize: 11, color: Colors.textSecondary, lineHeight: 16 },
  paradigmRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },

  hypoCard: {
    backgroundColor: Colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
    padding: 14, gap: 6,
  },
  hypoMech: { fontSize: 14, fontWeight: '700', color: Colors.text, lineHeight: 20 },
  hypoRationale: { fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  cautionBox: {
    flexDirection: 'row', gap: 6, alignItems: 'flex-start',
    backgroundColor: Colors.warning + '10', borderRadius: 6, padding: 8,
  },
  cautionText: { flex: 1, fontSize: 11, color: Colors.text, lineHeight: 16 },

  discussBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 12,
  },
  discussText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  footerNote: {
    fontSize: 11, color: Colors.textTertiary, lineHeight: 16,
    fontStyle: 'italic', textAlign: 'center', marginTop: 8,
  },

  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: Colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, gap: 12,
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  modalTitle: { flex: 1, fontSize: 17, fontWeight: '800', color: Colors.text },
  modalBody: { fontSize: 14, color: Colors.text, lineHeight: 20 },
  modalBtn: {
    backgroundColor: Colors.primary, borderRadius: 10,
    paddingVertical: 14, alignItems: 'center',
  },
  modalBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
