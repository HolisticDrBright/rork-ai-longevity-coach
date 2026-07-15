import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { featureFlags } from '@/lib/featureFlags';
import { TimelineList } from '@/components/reasoning/TimelineList';
import type { TimelineEventKind } from '@/types/reasoning';

const FILTERS: { key: TimelineEventKind | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'lab_panel', label: 'Labs' },
  { key: 'symptom', label: 'Symptoms' },
  { key: 'protocol', label: 'Protocols' },
  { key: 'supplement', label: 'Supplements' },
  { key: 'meal', label: 'Meals' },
  { key: 'wearable_day', label: 'Wearables' },
  { key: 'clinical_fact', label: 'Findings' },
];

export default function PatientTimelineScreen() {
  const [filter, setFilter] = useState<TimelineEventKind | 'all'>('all');

  const kinds = useMemo(
    () => (filter === 'all' ? undefined : filter === 'lab_panel' ? (['lab_panel', 'lab_marker'] as TimelineEventKind[]) : [filter]),
    [filter]
  );

  const timelineQuery = trpc.reasoning.timeline.get.useQuery(
    { kinds, limitPerSource: 100 },
    { enabled: featureFlags.clinicalReasoning }
  );

  if (!featureFlags.clinicalReasoning) {
    return (
      <View style={styles.center}>
        <Text style={styles.disabledText}>The health timeline is not enabled in this build.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={timelineQuery.isRefetching} onRefresh={() => timelineQuery.refetch()} />
      }
      testID="patient-timeline-screen"
    >
      <Text style={styles.subtitle}>
        One chronological record of everything measured, reported and prescribed. Each entry shows where it
        came from — measurements, your reports, practitioner entries and system findings are always
        distinguished.
      </Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
            onPress={() => setFilter(f.key)}
            testID={`timeline-filter-${f.key}`}
          >
            <Text style={[styles.filterText, filter === f.key && styles.filterTextActive]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {timelineQuery.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : timelineQuery.isError ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>Could not load your timeline. Pull to retry.</Text>
        </View>
      ) : (
        <TimelineList events={timelineQuery.data ?? []} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: 16,
    paddingBottom: 48,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 19,
    color: Colors.textSecondary,
    marginBottom: 12,
  },
  filterRow: {
    marginBottom: 16,
    flexGrow: 0,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    marginRight: 8,
  },
  filterChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  filterText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  filterTextActive: {
    color: Colors.textInverse,
  },
  center: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  errorText: {
    color: Colors.danger,
    fontSize: 13,
  },
  disabledText: {
    color: Colors.textSecondary,
    fontSize: 14,
  },
});
