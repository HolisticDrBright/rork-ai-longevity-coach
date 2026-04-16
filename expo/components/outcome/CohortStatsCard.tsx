import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { TrendingDown, Activity, Flame, BarChart3 } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';

export default function CohortStatsCard() {
  const statsQuery = trpc.longevity.cohortStats.useQuery({ days: 90 });

  if (statsQuery.isLoading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }
  if (statsQuery.isError || !statsQuery.data) {
    return null; // quietly hide for non-practitioners
  }

  const s = statsQuery.data;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <BarChart3 color={Colors.primary} size={18} />
        <Text style={styles.title}>Clinic outcomes · last 90 days</Text>
      </View>
      <Text style={styles.nLabel}>n = {s.n} approved outcome reports</Text>

      {s.n === 0 ? (
        <Text style={styles.empty}>
          No approved outcome reports in the window yet. Review and approve Month 6 reports to populate this widget.
        </Text>
      ) : (
        <View style={styles.grid}>
          <Stat
            icon={TrendingDown}
            label="Median TruAge shift"
            value={s.medianTruAgeDeltaYears != null
              ? `${s.medianTruAgeDeltaYears < 0 ? '−' : '+'}${Math.abs(s.medianTruAgeDeltaYears).toFixed(1)} yrs`
              : '—'}
            good={s.medianTruAgeDeltaYears != null && s.medianTruAgeDeltaYears < 0}
          />
          <Stat
            icon={Flame}
            label="Median CRP change"
            value={s.medianCrpDeltaPercent != null
              ? `${s.medianCrpDeltaPercent >= 0 ? '+' : ''}${s.medianCrpDeltaPercent.toFixed(0)}%`
              : '—'}
            good={s.medianCrpDeltaPercent != null && s.medianCrpDeltaPercent < 0}
          />
          <Stat
            icon={Activity}
            label="Median HRV change"
            value={s.medianHrvDeltaPercent != null
              ? `${s.medianHrvDeltaPercent >= 0 ? '+' : ''}${s.medianHrvDeltaPercent.toFixed(0)}%`
              : '—'}
            good={s.medianHrvDeltaPercent != null && s.medianHrvDeltaPercent > 0}
          />
          <Stat
            icon={BarChart3}
            label="Mean data completeness"
            value={s.meanDataCompletenessPct != null ? `${s.meanDataCompletenessPct}%` : '—'}
          />
        </View>
      )}
    </View>
  );
}

function Stat({ icon: Icon, label, value, good }: {
  icon: any; label: string; value: string; good?: boolean;
}) {
  const color = good === true ? Colors.success : good === false ? Colors.danger : Colors.primary;
  return (
    <View style={styles.statCell}>
      <Icon color={color} size={14} />
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
    padding: 14, gap: 10,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 14, fontWeight: '700', color: Colors.text },
  nLabel: { fontSize: 11, color: Colors.textSecondary },
  empty: { fontSize: 12, color: Colors.textTertiary, fontStyle: 'italic' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  statCell: {
    flex: 1, minWidth: 120, padding: 10, gap: 4,
    backgroundColor: Colors.surfaceSecondary, borderRadius: 8,
  },
  statLabel: { fontSize: 10, color: Colors.textSecondary, textTransform: 'uppercase' },
  statValue: { fontSize: 18, fontWeight: '800' },
});
