import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { featureFlags } from '@/lib/featureFlags';
import {
  TwinCurrentStateCard,
  TwinDisclaimer,
  TwinSystemsGrid,
} from '@/components/reasoning/HealthTwinView';

export default function ClinicHealthTwinScreen() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 980;
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);

  const relationshipsQuery = trpc.reasoning.relationships.list.useQuery(undefined, {
    enabled: featureFlags.adaptiveHealthTwin,
  });
  const myPatients = useMemo(
    () => (relationshipsQuery.data ?? []).filter((r) => r.status === 'active'),
    [relationshipsQuery.data]
  );
  const patientId = selectedPatientId ?? myPatients[0]?.patientId ?? null;

  const twinQuery = trpc.twin.get.useQuery(
    { patientId: patientId ?? undefined },
    { enabled: featureFlags.adaptiveHealthTwin && !!patientId }
  );

  if (!featureFlags.adaptiveHealthTwin) {
    return (
      <View style={styles.center}>
        <Text style={styles.mutedText}>The Adaptive Health Twin is not enabled in this build.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={twinQuery.isRefetching} onRefresh={() => twinQuery.refetch()} />}
      testID="clinic-health-twin-screen"
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.patientBar}>
        {myPatients.length === 0 ? (
          <Text style={styles.mutedText}>
            No authorized patients yet. Patients grant access from Profile → Care team.
          </Text>
        ) : (
          myPatients.map((r) => (
            <TouchableOpacity
              key={r.id}
              style={[styles.patientChip, patientId === r.patientId && styles.patientChipActive]}
              onPress={() => setSelectedPatientId(r.patientId)}
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

      {!patientId ? null : twinQuery.isLoading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
      ) : twinQuery.isError ? (
        <Text style={styles.errorText}>{twinQuery.error.message}</Text>
      ) : twinQuery.data ? (
        <View style={isDesktop ? styles.desktopRow : undefined}>
          <View style={isDesktop ? styles.leftCol : undefined}>
            <TwinCurrentStateCard state={twinQuery.data.currentState} />
            {twinQuery.data.dataQualityIssues.length > 0 && (
              <View style={styles.issuesCard}>
                <Text style={styles.issuesTitle}>Data quality</Text>
                {twinQuery.data.dataQualityIssues.map((i, idx) => (
                  <Text key={`${i.subject}-${idx}`} style={styles.issueItem}>
                    • {i.detail}
                  </Text>
                ))}
              </View>
            )}
          </View>
          <View style={isDesktop ? styles.rightCol : undefined}>
            <Text style={styles.sectionTitle}>Systems model</Text>
            <TwinSystemsGrid systems={twinQuery.data.systems} />
            <TwinDisclaimer />
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 48 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  patientBar: { marginBottom: 14, flexGrow: 0 },
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
  desktopRow: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  leftCol: { flex: 32 },
  rightCol: { flex: 68 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.text, marginBottom: 10 },
  mutedText: { fontSize: 13, color: Colors.textTertiary },
  errorText: { fontSize: 13, color: Colors.danger, marginTop: 20 },
  issuesCard: { backgroundColor: Colors.surfaceSecondary, borderRadius: 12, padding: 14 },
  issuesTitle: { fontSize: 13, fontWeight: '700', color: Colors.text, marginBottom: 6 },
  issueItem: { fontSize: 12.5, color: Colors.textSecondary, lineHeight: 19 },
});
