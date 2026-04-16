import { View, Text, StyleSheet, ScrollView } from 'react-native';
import Colors from '@/constants/colors';
import { HALLMARKS } from '@/types';
import type { HallmarkId, ProtocolMonth } from '@/types';

interface Props {
  months: ProtocolMonth[];
}

export default function HallmarksCoverage({ months }: Props) {
  // Count how many months address each hallmark
  const coverage: Record<HallmarkId, number> = {
    1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0,
  };
  for (const month of months) {
    for (const h of month.hallmarksTargeted) {
      coverage[h]++;
    }
  }

  const maxCoverage = 6; // max possible coverage across 6 months

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Text style={styles.title}>12 Hallmarks of Aging Coverage</Text>
        <Text style={styles.subtitle}>
          This protocol addresses all 12 hallmarks of aging. Bar length shows how many months actively target each hallmark.
        </Text>
      </View>

      <View style={styles.hallmarksList}>
        {HALLMARKS.map((hm) => {
          const count = coverage[hm.id];
          const percent = (count / maxCoverage) * 100;
          const intensity = count >= 4 ? 'heavy' : count >= 2 ? 'moderate' : 'light';
          const barColor = intensity === 'heavy' ? Colors.success : intensity === 'moderate' ? Colors.accent : Colors.primaryLight;

          return (
            <View key={hm.id} style={styles.hallmarkCard}>
              <View style={styles.hallmarkHeader}>
                <View style={styles.hallmarkNumber}>
                  <Text style={styles.hallmarkNumberText}>{hm.id}</Text>
                </View>
                <View style={styles.hallmarkInfo}>
                  <Text style={styles.hallmarkName}>{hm.name}</Text>
                  <Text style={styles.hallmarkDesc}>{hm.description}</Text>
                </View>
                <View style={[styles.coverageBadge, { backgroundColor: barColor + '20' }]}>
                  <Text style={[styles.coverageText, { color: barColor }]}>
                    {count}/{maxCoverage}
                  </Text>
                </View>
              </View>

              <View style={styles.barContainer}>
                <View style={[styles.bar, { width: `${percent}%`, backgroundColor: barColor }]} />
              </View>

              <View style={styles.monthsTargeted}>
                {[1, 2, 3, 4, 5, 6].map(m => {
                  const isTargeted = months.find(mo => mo.month === m)?.hallmarksTargeted.includes(hm.id);
                  return (
                    <View
                      key={m}
                      style={[
                        styles.monthDot,
                        isTargeted && { backgroundColor: barColor, borderColor: barColor },
                      ]}
                    >
                      <Text style={[styles.monthDotText, isTargeted && { color: '#fff' }]}>M{m}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { padding: 16, gap: 6 },
  title: { fontSize: 18, fontWeight: '800', color: Colors.text },
  subtitle: { fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  hallmarksList: { padding: 12, gap: 10 },
  hallmarkCard: {
    backgroundColor: Colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
    padding: 14, gap: 10,
  },
  hallmarkHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  hallmarkNumber: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: Colors.primary + '15',
    justifyContent: 'center', alignItems: 'center',
  },
  hallmarkNumberText: { fontSize: 14, fontWeight: '800', color: Colors.primary },
  hallmarkInfo: { flex: 1 },
  hallmarkName: { fontSize: 14, fontWeight: '700', color: Colors.text },
  hallmarkDesc: { fontSize: 11, color: Colors.textSecondary, marginTop: 2, lineHeight: 15 },
  coverageBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  coverageText: { fontSize: 12, fontWeight: '800' },
  barContainer: { height: 6, backgroundColor: Colors.borderLight, borderRadius: 3, overflow: 'hidden' },
  bar: { height: 6, borderRadius: 3 },
  monthsTargeted: { flexDirection: 'row', gap: 6 },
  monthDot: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
    backgroundColor: Colors.surfaceSecondary,
    borderWidth: 1, borderColor: Colors.borderLight,
  },
  monthDotText: { fontSize: 10, fontWeight: '700', color: Colors.textTertiary },
});
