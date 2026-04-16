import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { BarChart3, Clock, DollarSign, Activity } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { PARADIGM_COLORS, type Paradigm } from '@/components/patterns/ParadigmChip';

export default function PatternStatsScreen() {
  const statsQuery = trpc.patterns.getStats.useQuery();

  if (statsQuery.isLoading) {
    return <View style={styles.loading}><ActivityIndicator color={Colors.primary} /></View>;
  }
  if (statsQuery.isError || !statsQuery.data) {
    return (
      <View style={styles.loading}>
        <Text style={styles.error}>Practitioner access required.</Text>
      </View>
    );
  }

  const s = statsQuery.data as any;
  const statusEntries = Object.entries(s.byStatus ?? {}) as [string, number][];
  const paradigmEntries = s.byParadigm ?? [];
  const scoreStats = s.paradigmScoreStats ?? {};
  const runs = s.recentRuns ?? [];

  const totalGenerations = paradigmEntries.reduce((a: number, p: any) => a + p.count, 0);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Pattern Stats' }} />

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.header}>Pattern engine stats</Text>

        {/* Lifecycle status */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <BarChart3 color={Colors.primary} size={16} />
            <Text style={styles.cardTitle}>Lifecycle</Text>
          </View>
          {statusEntries.length === 0 ? (
            <Text style={styles.empty}>No patterns yet.</Text>
          ) : (
            <View style={styles.statusRow}>
              {statusEntries.map(([status, count]) => (
                <View key={status} style={styles.statusCell}>
                  <Text style={styles.statusCount}>{count}</Text>
                  <Text style={styles.statusLabel}>{status}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Paradigm usage + token cost */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <DollarSign color={Colors.primary} size={16} />
            <Text style={styles.cardTitle}>Paradigm usage + token cost</Text>
          </View>
          {paradigmEntries.length === 0 ? (
            <Text style={styles.empty}>No hypotheses generated yet.</Text>
          ) : (
            paradigmEntries.map((p: any) => {
              const color = PARADIGM_COLORS[p.paradigm as Paradigm] ?? Colors.primary;
              const pct = totalGenerations > 0 ? (p.count / totalGenerations) * 100 : 0;
              return (
                <View key={p.paradigm} style={styles.paradigmRow}>
                  <View style={styles.paradigmInfo}>
                    <Text style={[styles.paradigmName, { color }]}>{p.paradigm}</Text>
                    <Text style={styles.paradigmMeta}>
                      {p.count} calls · in≈{p.meanInputTokens}t · out≈{p.meanOutputTokens}t · {p.meanLatencyMs}ms
                    </Text>
                  </View>
                  <View style={styles.barContainer}>
                    <View style={[styles.bar, { width: `${pct}%`, backgroundColor: color }]} />
                  </View>
                </View>
              );
            })
          )}
        </View>

        {/* Paradigm score distribution */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Activity color={Colors.primary} size={16} />
            <Text style={styles.cardTitle}>Reviewer score distribution (1–5)</Text>
          </View>
          {Object.keys(scoreStats).length === 0 ? (
            <Text style={styles.empty}>No paradigm scores recorded yet.</Text>
          ) : (
            Object.entries(scoreStats as Record<string, { n: number; mean: number }>).map(([p, stats]) => {
              const color = PARADIGM_COLORS[p as Paradigm] ?? Colors.primary;
              const pct = (stats.mean / 5) * 100;
              return (
                <View key={p} style={styles.paradigmRow}>
                  <View style={styles.paradigmInfo}>
                    <Text style={[styles.paradigmName, { color }]}>{p}</Text>
                    <Text style={styles.paradigmMeta}>mean {stats.mean.toFixed(1)} over {stats.n} reviews</Text>
                  </View>
                  <View style={styles.barContainer}>
                    <View style={[styles.bar, { width: `${pct}%`, backgroundColor: color }]} />
                  </View>
                </View>
              );
            })
          )}
        </View>

        {/* Miner run history */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Clock color={Colors.primary} size={16} />
            <Text style={styles.cardTitle}>Miner runs (last 20)</Text>
          </View>
          {runs.length === 0 ? (
            <Text style={styles.empty}>No runs yet.</Text>
          ) : (
            runs.map((r: any) => (
              <View key={r.id} style={styles.runRow}>
                <View style={styles.runHeader}>
                  <Text style={[styles.runStatus, {
                    color: r.status === 'succeeded' ? Colors.success
                      : r.status === 'failed' ? Colors.danger : Colors.warning,
                  }]}>
                    {r.status}
                  </Text>
                  <Text style={styles.runTime}>
                    {new Date(r.started_at).toLocaleString()}
                  </Text>
                </View>
                <Text style={styles.runMeta}>
                  cohort={r.cohort_size ?? '—'} · tested={r.candidates_considered ?? '—'} · filter={r.candidates_passed_filter ?? '—'} · fdr={r.candidates_passed_fdr ?? '—'} · upserted={r.candidates_upserted ?? '—'} · {r.duration_ms ?? 0}ms
                </Text>
                {r.error_message && (
                  <Text style={styles.runError}>{r.error_message}</Text>
                )}
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  error: { fontSize: 13, color: Colors.danger },
  header: { fontSize: 22, fontWeight: '800', color: Colors.text, marginBottom: 4 },
  card: {
    backgroundColor: Colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border, padding: 14, gap: 10,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: Colors.text },
  empty: { fontSize: 12, color: Colors.textTertiary, fontStyle: 'italic' },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statusCell: { flex: 1, minWidth: 80, padding: 10, backgroundColor: Colors.surfaceSecondary, borderRadius: 8 },
  statusCount: { fontSize: 22, fontWeight: '800', color: Colors.primary },
  statusLabel: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  paradigmRow: { gap: 4 },
  paradigmInfo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  paradigmName: { fontSize: 13, fontWeight: '700', textTransform: 'capitalize' },
  paradigmMeta: { fontSize: 11, color: Colors.textSecondary, fontFamily: 'Courier' },
  barContainer: { height: 6, backgroundColor: Colors.borderLight, borderRadius: 3 },
  bar: { height: 6, borderRadius: 3 },
  runRow: {
    padding: 10, borderRadius: 8,
    backgroundColor: Colors.surfaceSecondary, gap: 4,
  },
  runHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  runStatus: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  runTime: { fontSize: 11, color: Colors.textTertiary },
  runMeta: { fontSize: 11, color: Colors.textSecondary, fontFamily: 'Courier' },
  runError: { fontSize: 11, color: Colors.danger, marginTop: 4 },
});
