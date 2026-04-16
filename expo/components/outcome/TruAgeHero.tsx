import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { TrendingDown, TrendingUp, Minus, HelpCircle } from 'lucide-react-native';
import Colors from '@/constants/colors';

interface Props {
  baseline?: number;
  current?: number;
  deltaYears?: number;
  targetDeltaYears?: number;
  direction: 'improved' | 'declined' | 'stable' | 'unknown';
  organs: { organ: string; baseline?: number; current?: number; delta?: number; direction: string }[];
}

export default function TruAgeHero({
  baseline, current, deltaYears, targetDeltaYears, direction, organs,
}: Props) {
  const gradientColors: [string, string] =
    direction === 'improved' ? ['#10B981', '#047857'] :
    direction === 'declined' ? ['#EF4444', '#991B1B'] :
    direction === 'stable' ? ['#6B7280', '#374151'] :
    [Colors.textTertiary, Colors.textSecondary];

  const Icon =
    direction === 'improved' ? TrendingDown :
    direction === 'declined' ? TrendingUp :
    direction === 'stable' ? Minus : HelpCircle;

  const hasData = baseline != null && current != null;

  return (
    <LinearGradient colors={gradientColors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
      <Text style={styles.kicker}>BIOLOGICAL AGE</Text>

      {!hasData ? (
        <View style={styles.missingContainer}>
          <HelpCircle color="rgba(255,255,255,0.8)" size={24} />
          <Text style={styles.missingTitle}>No TruAge data</Text>
          <Text style={styles.missingBody}>
            Upload a baseline and Month 6 TruAge report to see your biological age shift.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.numbersRow}>
            <View style={styles.numberCell}>
              <Text style={styles.numberLabel}>Baseline</Text>
              <Text style={styles.bigNumber}>{baseline?.toFixed(1)}</Text>
              <Text style={styles.numberUnit}>years</Text>
            </View>
            <View style={styles.iconContainer}>
              <Icon color="#fff" size={28} />
            </View>
            <View style={styles.numberCell}>
              <Text style={styles.numberLabel}>Month 6</Text>
              <Text style={styles.bigNumber}>{current?.toFixed(1)}</Text>
              <Text style={styles.numberUnit}>years</Text>
            </View>
          </View>

          {deltaYears != null && (
            <View style={styles.deltaPill}>
              <Text style={styles.deltaText}>
                {deltaYears < 0 ? '−' : '+'}
                {Math.abs(deltaYears).toFixed(1)} years
              </Text>
              {targetDeltaYears != null && (
                <Text style={styles.targetText}>
                  target: −{Math.abs(targetDeltaYears).toFixed(1)} yrs
                </Text>
              )}
            </View>
          )}
        </>
      )}

      {organs.length > 0 && (
        <View style={styles.organsRow}>
          <Text style={styles.organsLabel}>Organ systems</Text>
          <View style={styles.organGrid}>
            {organs.map(o => {
              const OIcon =
                o.direction === 'improved' ? TrendingDown :
                o.direction === 'declined' ? TrendingUp : Minus;
              return (
                <View key={o.organ} style={styles.organChip}>
                  <Text style={styles.organName}>{o.organ}</Text>
                  <View style={styles.organDelta}>
                    <OIcon color="#fff" size={12} />
                    <Text style={styles.organDeltaText}>
                      {o.delta == null ? '—' : `${o.delta < 0 ? '' : '+'}${o.delta.toFixed(1)}`}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      )}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18, padding: 18, gap: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15, shadowRadius: 10, elevation: 5,
  },
  kicker: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.7)', letterSpacing: 1.2 },
  missingContainer: { alignItems: 'center', padding: 20, gap: 6 },
  missingTitle: { fontSize: 16, fontWeight: '700', color: '#fff' },
  missingBody: { fontSize: 12, color: 'rgba(255,255,255,0.8)', textAlign: 'center', lineHeight: 16 },
  numbersRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  numberCell: { flex: 1, alignItems: 'center' },
  numberLabel: { fontSize: 11, color: 'rgba(255,255,255,0.75)', textTransform: 'uppercase' },
  bigNumber: { fontSize: 42, fontWeight: '800', color: '#fff', letterSpacing: -1, marginTop: 4 },
  numberUnit: { fontSize: 11, color: 'rgba(255,255,255,0.75)' },
  iconContainer: { paddingHorizontal: 8 },
  deltaPill: {
    alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
  },
  deltaText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  targetText: { fontSize: 11, color: 'rgba(255,255,255,0.75)' },
  organsRow: { gap: 6, marginTop: 6 },
  organsLabel: { fontSize: 11, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase' },
  organGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  organChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10,
  },
  organName: { fontSize: 12, fontWeight: '600', color: '#fff', textTransform: 'capitalize' },
  organDelta: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  organDeltaText: { fontSize: 11, color: '#fff', fontWeight: '600' },
});
