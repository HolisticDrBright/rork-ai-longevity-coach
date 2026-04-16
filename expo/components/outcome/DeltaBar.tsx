import { View, Text, StyleSheet } from 'react-native';
import { TrendingUp, TrendingDown, Minus, HelpCircle } from 'lucide-react-native';
import Colors from '@/constants/colors';

export interface DeltaLike {
  label: string;
  unit?: string;
  baseline?: number;
  current?: number;
  deltaPercent?: number;
  direction: 'improved' | 'declined' | 'stable' | 'unknown';
  sentiment: 'positive' | 'negative' | 'neutral';
  missing?: boolean;
  summary?: string;
}

const dirConfig = {
  improved: { icon: TrendingUp, color: Colors.success },
  declined: { icon: TrendingDown, color: Colors.danger },
  stable: { icon: Minus, color: Colors.textTertiary },
  unknown: { icon: HelpCircle, color: Colors.textTertiary },
};

export default function DeltaBar({ delta }: { delta: DeltaLike }) {
  const cfg = dirConfig[delta.direction];
  const Icon = cfg.icon;

  return (
    <View style={styles.row}>
      <View style={styles.header}>
        <Text style={styles.label}>{delta.label}</Text>
        {delta.deltaPercent != null && !delta.missing && (
          <View style={[styles.badge, { backgroundColor: cfg.color + '20' }]}>
            <Icon color={cfg.color} size={12} />
            <Text style={[styles.badgeText, { color: cfg.color }]}>
              {delta.deltaPercent >= 0 ? '+' : ''}{delta.deltaPercent.toFixed(1)}%
            </Text>
          </View>
        )}
      </View>

      {delta.missing ? (
        <Text style={styles.missing}>Not measured in both time points.</Text>
      ) : (
        <>
          <View style={styles.valuesRow}>
            <View style={styles.valueCell}>
              <Text style={styles.valueLabel}>Baseline</Text>
              <Text style={styles.valueNumber}>
                {delta.baseline?.toFixed(1) ?? '—'}
                {delta.unit ? <Text style={styles.valueUnit}> {delta.unit}</Text> : null}
              </Text>
            </View>
            <View style={styles.arrowCell}>
              <Icon color={cfg.color} size={18} />
            </View>
            <View style={styles.valueCell}>
              <Text style={styles.valueLabel}>Current</Text>
              <Text style={[styles.valueNumber, { color: cfg.color }]}>
                {delta.current?.toFixed(1) ?? '—'}
                {delta.unit ? <Text style={styles.valueUnit}> {delta.unit}</Text> : null}
              </Text>
            </View>
          </View>
          {delta.summary && <Text style={styles.summary}>{delta.summary}</Text>}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    gap: 6,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { flex: 1, fontSize: 13, fontWeight: '600', color: Colors.text },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
  },
  badgeText: { fontSize: 11, fontWeight: '700' },
  valuesRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  valueCell: { flex: 1 },
  valueLabel: { fontSize: 10, color: Colors.textTertiary, textTransform: 'uppercase' },
  valueNumber: { fontSize: 18, fontWeight: '700', color: Colors.text, marginTop: 2 },
  valueUnit: { fontSize: 11, fontWeight: '500', color: Colors.textSecondary },
  arrowCell: { paddingHorizontal: 6 },
  summary: { fontSize: 11, color: Colors.textSecondary, lineHeight: 16 },
  missing: { fontSize: 12, color: Colors.textTertiary, fontStyle: 'italic' },
});
