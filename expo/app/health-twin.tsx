import React from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { featureFlags } from '@/lib/featureFlags';
import {
  TwinCurrentStateCard,
  TwinDisclaimer,
  TwinSystemsGrid,
} from '@/components/reasoning/HealthTwinView';

export default function PatientHealthTwinScreen() {
  const twinQuery = trpc.twin.get.useQuery({}, { enabled: featureFlags.adaptiveHealthTwin });

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
      testID="patient-health-twin-screen"
    >
      <Text style={styles.subtitle}>
        A continuously updated model of your whole health picture: what is true right now, and how each body
        system is doing based on your labs, wearables, check-ins and practitioner input.
      </Text>

      {twinQuery.isLoading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
      ) : twinQuery.isError ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>Could not load your Health Twin. Pull to retry.</Text>
        </View>
      ) : twinQuery.data ? (
        <>
          <TwinCurrentStateCard state={twinQuery.data.currentState} />

          {twinQuery.data.missingData.length > 0 && (
            <View style={styles.missingCard}>
              <Text style={styles.missingTitle}>Complete your model</Text>
              {twinQuery.data.missingData.map((m) => (
                <Text key={m.subject} style={styles.missingItem}>
                  • {m.suggestion}
                </Text>
              ))}
            </View>
          )}

          <Text style={styles.sectionTitle}>Systems model</Text>
          <TwinSystemsGrid systems={twinQuery.data.systems} />

          <View style={styles.layer3Card}>
            <Text style={styles.layer3Title}>Response model</Text>
            <Text style={styles.layer3Text}>{twinQuery.data.layer3.note}</Text>
          </View>

          <TwinDisclaimer />
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 48 },
  center: { alignItems: 'center', paddingVertical: 40 },
  subtitle: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19, marginBottom: 14 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.text, marginBottom: 10, marginTop: 4 },
  mutedText: { fontSize: 14, color: Colors.textSecondary },
  errorText: { fontSize: 13, color: Colors.danger },
  missingCard: {
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
  },
  missingTitle: { fontSize: 13, fontWeight: '700', color: Colors.text, marginBottom: 6 },
  missingItem: { fontSize: 12.5, color: Colors.textSecondary, lineHeight: 19 },
  layer3Card: {
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 12,
    padding: 14,
    marginTop: 4,
    marginBottom: 12,
  },
  layer3Title: { fontSize: 13, fontWeight: '700', color: Colors.text, marginBottom: 4 },
  layer3Text: { fontSize: 12.5, color: Colors.textSecondary, lineHeight: 18 },
});
