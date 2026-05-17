import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { AlertTriangle, ChevronRight, FileText } from 'lucide-react-native';

import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';

export default function VisualReviewQueueScreen() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const queueQuery = trpc.visualDiagnostics.listReviewQueue.useQuery(
    { status: 'review_pending' as const, limit: 50 },
    { staleTime: 30_000 }
  );

  // queueQuery is a new object reference every render but its .refetch
  // method is stable, so we depend on the stable function ref instead
  // of the whole query object to avoid an effect-refire-per-render storm
  // (audit bug #9).
  const refetch = queueQuery.refetch;

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        <Text style={styles.heading}>Awaiting practitioner review</Text>
        <Text style={styles.subheading}>
          Visual assessments where all per-modality analyzers and the correlator have completed but Dr. Bright hasn't yet signed off.
        </Text>

        {queueQuery.isLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={Colors.primary} />
          </View>
        ) : queueQuery.isError ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>
              {queueQuery.error?.message ?? 'Failed to load review queue.'}
            </Text>
          </View>
        ) : !queueQuery.data || queueQuery.data.length === 0 ? (
          <View style={styles.empty}>
            <FileText size={32} color={Colors.textTertiary} />
            <Text style={styles.emptyText}>No assessments awaiting review.</Text>
          </View>
        ) : (
          queueQuery.data.map((s) => {
            const counts = s.redFlagCounts;
            const hasUrgent = counts.critical > 0 || counts.high > 0;
            return (
              <TouchableOpacity
                key={s.id}
                style={[styles.row, hasUrgent && styles.rowUrgent]}
                onPress={() => router.push(`/(tabs)/(clinic)/visual-session/${s.id}` as never)}
                activeOpacity={0.7}
              >
                <View style={styles.rowMain}>
                  <Text style={styles.rowDate}>{new Date(s.captured_at).toLocaleString()}</Text>
                  <Text style={styles.rowMeta}>
                    Patient: {s.user_id.slice(0, 8)}…
                    {s.visual_health_index != null
                      ? `   ·   VHI ${Math.round(s.visual_health_index * 100)}`
                      : ''}
                  </Text>
                  {(counts.critical > 0 || counts.high > 0 || counts.total > 0) && (
                    <View style={styles.flagRow}>
                      {counts.critical > 0 && (
                        <View style={[styles.flagBadge, { backgroundColor: Colors.danger + '20' }]}>
                          <AlertTriangle size={11} color={Colors.danger} />
                          <Text style={[styles.flagText, { color: Colors.danger }]}>
                            {counts.critical} critical
                          </Text>
                        </View>
                      )}
                      {counts.high > 0 && (
                        <View style={[styles.flagBadge, { backgroundColor: Colors.warning + '20' }]}>
                          <AlertTriangle size={11} color={Colors.warning} />
                          <Text style={[styles.flagText, { color: Colors.warning }]}>
                            {counts.high} high
                          </Text>
                        </View>
                      )}
                      {counts.total > counts.critical + counts.high && (
                        <Text style={styles.flagOther}>+{counts.total - counts.critical - counts.high} other</Text>
                      )}
                    </View>
                  )}
                </View>
                <ChevronRight size={18} color={Colors.textTertiary} />
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 16, paddingBottom: 48 },
  heading: { fontSize: 22, fontWeight: '700', color: Colors.text, marginBottom: 6 },
  subheading: { fontSize: 13, color: Colors.textSecondary, marginBottom: 16, lineHeight: 18 },
  loading: { padding: 24, alignItems: 'center' },
  errorCard: { padding: 16, backgroundColor: Colors.danger + '10', borderRadius: 8 },
  errorText: { color: Colors.danger, fontSize: 13 },
  empty: { padding: 32, alignItems: 'center', gap: 12 },
  emptyText: { fontSize: 13, color: Colors.textSecondary },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  rowUrgent: { borderColor: Colors.danger + '60' },
  rowMain: { flex: 1 },
  rowDate: { fontSize: 14, fontWeight: '600', color: Colors.text },
  rowMeta: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  flagRow: { flexDirection: 'row', gap: 6, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' },
  flagBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  flagText: { fontSize: 10, fontWeight: '600' },
  flagOther: { fontSize: 10, color: Colors.textSecondary },
});
