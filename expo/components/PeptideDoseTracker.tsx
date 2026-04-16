import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ScrollView,
} from 'react-native';
import {
  Syringe,
  Check,
  X,
  Clock,
  MapPin,
  Trophy,
  Calendar,
  ChevronDown,
} from 'lucide-react-native';
import Colors from '@/constants/colors';

interface ProtocolPeptide {
  id: string;
  peptideName: string;
  doseAmount: number;
  doseUnit: string;
  frequency: string;
  timing?: string;
}

interface AdherenceStats {
  totalScheduled: number;
  totalTaken: number;
  totalSkipped: number;
  adherencePercent: number;
  currentStreak: number;
  longestStreak: number;
}

const INJECTION_SITES = [
  'Left Abdomen', 'Right Abdomen', 'Left Thigh', 'Right Thigh',
  'Left Deltoid', 'Right Deltoid', 'Left Glute', 'Right Glute',
];

interface Props {
  peptides: ProtocolPeptide[];
  adherence?: AdherenceStats;
  onLogDose?: (peptideId: string, site?: string, notes?: string) => Promise<void>;
  onSkipDose?: (peptideId: string, reason?: string) => Promise<void>;
  recentSites?: string[];
}

export default function PeptideDoseTracker({ peptides, adherence, onLogDose, onSkipDose, recentSites }: Props) {
  const [selectedSite, setSelectedSite] = useState<string | null>(null);
  const [showSites, setShowSites] = useState(false);
  const [notes, setNotes] = useState('');
  const [logging, setLogging] = useState<string | null>(null);

  const handleLog = useCallback(async (peptideId: string) => {
    if (!onLogDose) return;
    setLogging(peptideId);
    try {
      await onLogDose(peptideId, selectedSite ?? undefined, notes || undefined);
      Alert.alert('Logged', 'Dose recorded successfully.');
      setNotes('');
    } catch {
      Alert.alert('Error', 'Failed to log dose.');
    } finally {
      setLogging(null);
    }
  }, [onLogDose, selectedSite, notes]);

  const handleSkip = useCallback(async (peptideId: string) => {
    if (!onSkipDose) return;
    Alert.alert('Skip Dose', 'Why are you skipping?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Forgot', onPress: () => onSkipDose(peptideId, 'Forgot') },
      { text: 'Side effects', onPress: () => onSkipDose(peptideId, 'Side effects') },
      { text: 'Out of supply', onPress: () => onSkipDose(peptideId, 'Out of supply') },
      { text: 'Off day (cycling)', onPress: () => onSkipDose(peptideId, 'Cycling off day') },
    ]);
  }, [onSkipDose]);

  // Suggest next injection site (rotate through avoiding recent)
  const suggestedSite = INJECTION_SITES.find(s => !(recentSites ?? []).includes(s)) ?? INJECTION_SITES[0];

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Adherence Stats */}
      {adherence && (
        <View style={styles.statsContainer}>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{adherence.adherencePercent}%</Text>
            <Text style={styles.statLabel}>Adherence</Text>
          </View>
          <View style={styles.statCard}>
            <View style={styles.streakRow}>
              <Trophy color={Colors.warning} size={16} />
              <Text style={styles.statNumber}>{adherence.currentStreak}</Text>
            </View>
            <Text style={styles.statLabel}>Current Streak</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{adherence.totalTaken}/{adherence.totalScheduled}</Text>
            <Text style={styles.statLabel}>Doses Taken</Text>
          </View>
        </View>
      )}

      {/* Injection Site Selector */}
      <TouchableOpacity style={styles.siteSelector} onPress={() => setShowSites(!showSites)}>
        <MapPin color={Colors.primary} size={18} />
        <Text style={styles.siteLabel}>
          {selectedSite ?? `Suggested: ${suggestedSite}`}
        </Text>
        <ChevronDown color={Colors.textTertiary} size={16} />
      </TouchableOpacity>

      {showSites && (
        <View style={styles.siteGrid}>
          {INJECTION_SITES.map((site) => {
            const isRecent = (recentSites ?? []).includes(site);
            return (
              <TouchableOpacity
                key={site}
                style={[styles.siteChip, selectedSite === site && styles.siteChipActive, isRecent && styles.siteChipRecent]}
                onPress={() => { setSelectedSite(site); setShowSites(false); }}
              >
                <Text style={[styles.siteChipText, selectedSite === site && styles.siteChipTextActive]}>
                  {site}{isRecent ? ' (recent)' : ''}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Notes Input */}
      <TextInput
        style={styles.notesInput}
        placeholder="Optional notes..."
        placeholderTextColor={Colors.textTertiary}
        value={notes}
        onChangeText={setNotes}
      />

      {/* Peptide Dose Cards */}
      <View style={styles.doseList}>
        {peptides.map((pep) => (
          <View key={pep.id} style={styles.doseCard}>
            <View style={styles.doseHeader}>
              <Syringe color={Colors.primary} size={20} />
              <View style={styles.doseInfo}>
                <Text style={styles.doseName}>{pep.peptideName}</Text>
                <Text style={styles.doseDetails}>
                  {pep.doseAmount} {pep.doseUnit} · {pep.frequency}
                  {pep.timing ? ` · ${pep.timing}` : ''}
                </Text>
              </View>
            </View>
            <View style={styles.doseActions}>
              <TouchableOpacity
                style={styles.skipButton}
                onPress={() => handleSkip(pep.id)}
              >
                <X color={Colors.danger} size={18} />
                <Text style={styles.skipText}>Skip</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.logButton}
                onPress={() => handleLog(pep.id)}
                disabled={logging === pep.id}
              >
                <Check color="#fff" size={18} />
                <Text style={styles.logText}>
                  {logging === pep.id ? 'Logging...' : 'Log Dose'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  statsContainer: { flexDirection: 'row', padding: 16, gap: 10 },
  statCard: {
    flex: 1, backgroundColor: Colors.surface, borderRadius: 12, padding: 14,
    alignItems: 'center', borderWidth: 1, borderColor: Colors.border,
  },
  statNumber: { fontSize: 22, fontWeight: '800', color: Colors.primary },
  statLabel: { fontSize: 11, color: Colors.textSecondary, marginTop: 4 },
  streakRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  siteSelector: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 16, padding: 14, backgroundColor: Colors.surface,
    borderRadius: 10, borderWidth: 1, borderColor: Colors.border,
  },
  siteLabel: { flex: 1, fontSize: 14, color: Colors.text },
  siteGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 6, marginTop: 8 },
  siteChip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
  },
  siteChipActive: { backgroundColor: Colors.primary + '15', borderColor: Colors.primary },
  siteChipRecent: { opacity: 0.5 },
  siteChipText: { fontSize: 12, color: Colors.text },
  siteChipTextActive: { color: Colors.primary, fontWeight: '600' },
  notesInput: {
    marginHorizontal: 16, marginTop: 10, padding: 12,
    backgroundColor: Colors.surface, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.border, fontSize: 14, color: Colors.text,
  },
  doseList: { padding: 16, gap: 10 },
  doseCard: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: Colors.border, gap: 12,
  },
  doseHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  doseInfo: { flex: 1 },
  doseName: { fontSize: 16, fontWeight: '700', color: Colors.text },
  doseDetails: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  doseActions: { flexDirection: 'row', gap: 10 },
  skipButton: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: Colors.danger,
  },
  skipText: { fontSize: 14, fontWeight: '600', color: Colors.danger },
  logButton: {
    flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 10, backgroundColor: Colors.success,
  },
  logText: { fontSize: 14, fontWeight: '600', color: '#fff' },
});
