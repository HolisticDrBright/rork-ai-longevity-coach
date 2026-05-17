import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Camera, ChevronRight, Info } from 'lucide-react-native';

import Colors from '@/constants/colors';
import type { Modality } from '@/lib/visualAnalyzerClient';

interface ModalityOption {
  modality: Modality;
  title: string;
  description: string;
  enabled: boolean;
  note?: string;
}

const MODALITIES: ModalityOption[] = [
  {
    modality: 'skin',
    title: 'Facial skin',
    description: 'Forehead, cheeks, perioral, and jawline. Single portrait shot in even lighting.',
    enabled: true,
  },
  {
    modality: 'tongue',
    title: 'TCM tongue',
    description: 'Extended tongue, mouth fully open. Avoid eating, drinking, or brushing for at least 30 min before capture.',
    enabled: true,
  },
  {
    modality: 'tcm_face',
    title: 'TCM facial zones',
    description: 'Zang-Fu zone mapping. Coming in v1.1.',
    enabled: false,
    note: 'Phase 2',
  },
  {
    modality: 'nails',
    title: 'Nails',
    description: 'Both hands palms-down. Coming in v1.1.',
    enabled: false,
    note: 'Phase 2',
  },
  {
    modality: 'iris',
    title: 'Iris (iridology)',
    description: 'Six angles per eye. Coming in v1.1.',
    enabled: false,
    note: 'Phase 2',
  },
];

export default function NewSessionScreen() {
  const router = useRouter();
  const [isBaseline, setIsBaseline] = useState(false);

  const startCapture = (modality: Modality) => {
    router.push(
      `/(tabs)/visual-assessments/capture/${modality}?baseline=${isBaseline ? '1' : '0'}` as never
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.infoCard}>
          <Info size={16} color={Colors.primary} />
          <Text style={styles.infoText}>
            Each modality is captured separately. You can run one or several in a single session — convergent findings across modalities are weighted higher.
          </Text>
        </View>

        <View style={styles.toggleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleLabel}>Mark as baseline</Text>
            <Text style={styles.toggleDesc}>
              First assessment Dr. Bright compares future sessions against.
            </Text>
          </View>
          <Switch
            value={isBaseline}
            onValueChange={setIsBaseline}
            trackColor={{ false: Colors.borderLight, true: Colors.primaryLight }}
            thumbColor={isBaseline ? Colors.primary : '#FFFFFF'}
          />
        </View>

        <Text style={styles.sectionHeader}>Choose a modality</Text>

        {MODALITIES.map((m) => (
          <TouchableOpacity
            key={m.modality}
            style={[styles.modalityRow, !m.enabled && styles.modalityDisabled]}
            disabled={!m.enabled}
            onPress={() => startCapture(m.modality)}
            activeOpacity={0.7}
          >
            <View style={styles.modalityIcon}>
              <Camera size={20} color={m.enabled ? Colors.primary : Colors.textTertiary} />
            </View>
            <View style={styles.modalityBody}>
              <View style={styles.modalityHeader}>
                <Text style={[styles.modalityTitle, !m.enabled && styles.disabledText]}>{m.title}</Text>
                {m.note && (
                  <View style={styles.noteBadge}>
                    <Text style={styles.noteText}>{m.note}</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.modalityDesc, !m.enabled && styles.disabledText]}>{m.description}</Text>
            </View>
            {m.enabled && <ChevronRight size={18} color={Colors.textTertiary} />}
          </TouchableOpacity>
        ))}

        <View style={styles.disclosureCard}>
          <Text style={styles.disclosureText}>
            Images are processed with no-retention by the analysis service and stored privately in your account. Findings use observational language ("appears", "consistent with") and are reviewed by Dr. Bright before being marked complete.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 16, paddingBottom: 48 },
  infoCard: {
    flexDirection: 'row',
    backgroundColor: Colors.primary + '10',
    padding: 12,
    borderRadius: 8,
    gap: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.primary + '30',
  },
  infoText: { flex: 1, fontSize: 12, color: Colors.text, lineHeight: 16 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    padding: 14,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    gap: 12,
  },
  toggleLabel: { fontSize: 14, fontWeight: '600', color: Colors.text, marginBottom: 2 },
  toggleDesc: { fontSize: 12, color: Colors.textSecondary, lineHeight: 16 },
  sectionHeader: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    marginTop: 8,
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  modalityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    gap: 12,
  },
  modalityDisabled: { opacity: 0.55 },
  modalityIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primary + '10',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalityBody: { flex: 1 },
  modalityHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  modalityTitle: { fontSize: 15, fontWeight: '600', color: Colors.text },
  modalityDesc: { fontSize: 12, color: Colors.textSecondary, lineHeight: 16 },
  disabledText: { color: Colors.textTertiary },
  noteBadge: { backgroundColor: Colors.surfaceSecondary, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  noteText: { fontSize: 10, color: Colors.textSecondary, fontWeight: '600' },
  disclosureCard: {
    backgroundColor: Colors.surfaceSecondary,
    padding: 12,
    borderRadius: 8,
    marginTop: 24,
  },
  disclosureText: { fontSize: 11, color: Colors.textSecondary, lineHeight: 16 },
});
