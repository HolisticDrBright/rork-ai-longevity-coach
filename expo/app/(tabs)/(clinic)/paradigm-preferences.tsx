import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, Switch,
} from 'react-native';
import { Stack } from 'expo-router';
import { Save, DollarSign } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import ParadigmChip, { ALL_PARADIGMS, type Paradigm } from '@/components/patterns/ParadigmChip';

interface Preset {
  key: string;
  label: string;
  paradigms: Paradigm[];
}

const PRESETS: Preset[] = [
  { key: 'conventional', label: 'Conventional focus', paradigms: ['western', 'functional', 'synergistic'] },
  { key: 'integrative', label: 'Integrative broad', paradigms: ['western', 'functional', 'naturopathic', 'tcm', 'synergistic'] },
  { key: 'full', label: 'Full spectrum', paradigms: [...ALL_PARADIGMS] },
  { key: 'eastern', label: 'Eastern-forward', paradigms: ['functional', 'tcm', 'ayurvedic', 'synergistic'] },
];

// Rough per-call token estimate (input + output across main + synergistic passes)
const TOKEN_COST_PER_PARADIGM = 900;
const TOKEN_COST_SYNERGISTIC = 1500;

export default function ParadigmPreferencesScreen() {
  const prefsQuery = trpc.patterns.getPractitionerParadigmPrefs.useQuery();
  const updateMutation = trpc.patterns.updatePractitionerParadigmPrefs.useMutation();
  const utils = trpc.useUtils();

  const [defaults, setDefaults] = useState<Paradigm[]>(['western', 'functional', 'synergistic']);
  const [alwaysSynergistic, setAlwaysSynergistic] = useState(true);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const d = prefsQuery.data as any;
    if (d) {
      setDefaults((d.default_paradigms ?? ['western', 'functional', 'synergistic']) as Paradigm[]);
      setAlwaysSynergistic(!!d.always_include_synergistic);
    }
  }, [prefsQuery.data]);

  const togglePara = (p: Paradigm) => {
    setDefaults(prev => {
      const next = prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p];
      setDirty(true);
      return next;
    });
  };

  const applyPreset = (preset: Preset) => {
    setDefaults(preset.paradigms);
    setDirty(true);
  };

  const handleSave = useCallback(async () => {
    try {
      let final = defaults;
      if (alwaysSynergistic && !final.includes('synergistic')) {
        final = [...final, 'synergistic'];
      }
      await updateMutation.mutateAsync({
        defaultParadigms: final,
        alwaysIncludeSynergistic: alwaysSynergistic,
      });
      await utils.patterns.getPractitionerParadigmPrefs.invalidate();
      setDirty(false);
      Alert.alert('Saved', 'Paradigm preferences updated.');
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Save failed');
    }
  }, [defaults, alwaysSynergistic, updateMutation, utils]);

  const nonSyn = defaults.filter(p => p !== 'synergistic').length;
  const hasSyn = defaults.includes('synergistic') || alwaysSynergistic;
  const estTokens = nonSyn * TOKEN_COST_PER_PARADIGM + (hasSyn ? TOKEN_COST_SYNERGISTIC : 0);

  if (prefsQuery.isLoading) {
    return <View style={styles.loading}><ActivityIndicator color={Colors.primary} /></View>;
  }
  if (prefsQuery.isError) {
    return (
      <View style={styles.loading}>
        <Text style={styles.error}>Practitioner access required.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Paradigm Preferences' }} />

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.header}>Paradigm preferences</Text>
        <Text style={styles.subheader}>
          These defaults apply when the hypothesizer runs on new patterns. You can still request
          additional paradigms ad-hoc on any pattern from the inbox.
        </Text>

        {/* Presets */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Presets</Text>
          <View style={styles.presetRow}>
            {PRESETS.map(p => (
              <TouchableOpacity
                key={p.key}
                style={styles.preset}
                onPress={() => applyPreset(p)}
              >
                <Text style={styles.presetLabel}>{p.label}</Text>
                <Text style={styles.presetMeta}>{p.paradigms.length} paradigms</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Paradigm multi-select */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Default paradigms</Text>
          <View style={styles.paradigmGrid}>
            {ALL_PARADIGMS.map(p => (
              <ParadigmChip
                key={p}
                paradigm={p}
                filled={defaults.includes(p)}
                onPress={() => togglePara(p)}
              />
            ))}
          </View>
        </View>

        {/* Synergistic toggle */}
        <View style={styles.section}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.toggleLabel}>Always include Synergistic</Text>
              <Text style={styles.toggleHint}>
                Runs a second pass that synthesizes across the other selected paradigms — typically
                the most valuable lens for cross-framework reasoning.
              </Text>
            </View>
            <Switch
              value={alwaysSynergistic}
              onValueChange={(v) => { setAlwaysSynergistic(v); setDirty(true); }}
              trackColor={{ true: Colors.primary, false: Colors.borderLight }}
            />
          </View>
        </View>

        {/* Cost estimator */}
        <View style={styles.costCard}>
          <View style={styles.rowBetween}>
            <View style={styles.rowLeft}>
              <DollarSign color={Colors.primary} size={16} />
              <Text style={styles.costLabel}>Estimated cost per pattern</Text>
            </View>
            <Text style={styles.costValue}>~{estTokens.toLocaleString()} tokens</Text>
          </View>
          <Text style={styles.costBreakdown}>
            {nonSyn} paradigm pass{nonSyn === 1 ? '' : 'es'}{hasSyn ? ' + synergistic synthesis' : ''} — sized against Claude Opus input+output averages.
          </Text>
        </View>

        {/* Save */}
        <TouchableOpacity
          style={[styles.saveBtn, (!dirty || updateMutation.isPending) && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={!dirty || updateMutation.isPending}
        >
          {updateMutation.isPending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Save color="#fff" size={16} />
              <Text style={styles.saveBtnText}>{dirty ? 'Save preferences' : 'No changes'}</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, gap: 14, paddingBottom: 40 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  error: { fontSize: 13, color: Colors.danger },
  header: { fontSize: 22, fontWeight: '800', color: Colors.text },
  subheader: { fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  section: { gap: 8 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase' },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  preset: {
    backgroundColor: Colors.surface, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.border,
    padding: 10, minWidth: 140, flex: 1,
  },
  presetLabel: { fontSize: 13, fontWeight: '700', color: Colors.text },
  presetMeta: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  paradigmGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  toggleLabel: { fontSize: 14, fontWeight: '700', color: Colors.text },
  toggleHint: { fontSize: 12, color: Colors.textSecondary, marginTop: 2, lineHeight: 16 },
  costCard: {
    backgroundColor: Colors.primary + '10', borderRadius: 12,
    borderWidth: 1, borderColor: Colors.primary + '30',
    padding: 14, gap: 6,
  },
  costLabel: { fontSize: 13, fontWeight: '700', color: Colors.primary },
  costValue: { fontSize: 18, fontWeight: '800', color: Colors.primary, fontFamily: 'Courier' },
  costBreakdown: { fontSize: 11, color: Colors.textSecondary, lineHeight: 16 },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 14,
  },
  saveBtnDisabled: { backgroundColor: Colors.textTertiary },
  saveBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
