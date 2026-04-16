import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import Colors from '@/constants/colors';
import { HALLMARKS } from '@/types';
import type { HallmarkId } from '@/types';

interface Month {
  month: 1 | 2 | 3 | 4 | 5 | 6;
  theme: string;
  hallmarksTargeted: HallmarkId[];
}

const MONTH_COLORS = ['#3B82F6', '#8B5CF6', '#F97316', '#EC4899', '#14B8A6', '#10B981'];

interface Props {
  months: Month[];
  selectedMonth: number;
  onSelectMonth: (month: number) => void;
}

export default function ProtocolTimeline({ months, selectedMonth, onSelectMonth }: Props) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
    >
      {months.map((m, i) => {
        const isActive = selectedMonth === m.month;
        const color = MONTH_COLORS[i];
        return (
          <TouchableOpacity
            key={m.month}
            style={[styles.monthCard, { borderColor: color }, isActive && { backgroundColor: color + '15' }]}
            onPress={() => onSelectMonth(m.month)}
            activeOpacity={0.85}
          >
            <View style={[styles.monthNumber, { backgroundColor: color }]}>
              <Text style={styles.monthNumberText}>{m.month}</Text>
            </View>
            <Text style={styles.monthTheme} numberOfLines={2}>{m.theme}</Text>
            <View style={styles.hallmarkRow}>
              {m.hallmarksTargeted.slice(0, 4).map((h) => {
                const info = HALLMARKS.find(hm => hm.id === h);
                return (
                  <View key={h} style={[styles.hallmarkChip, { backgroundColor: color + '15' }]}>
                    <Text style={[styles.hallmarkChipText, { color }]}>#{h}</Text>
                  </View>
                );
              })}
              {m.hallmarksTargeted.length > 4 && (
                <Text style={[styles.hallmarkMore, { color }]}>+{m.hallmarksTargeted.length - 4}</Text>
              )}
            </View>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  monthCard: {
    width: 170,
    padding: 14,
    borderRadius: 14,
    borderWidth: 2,
    backgroundColor: Colors.surface,
    gap: 10,
  },
  monthNumber: {
    width: 32, height: 32, borderRadius: 16,
    justifyContent: 'center', alignItems: 'center',
  },
  monthNumberText: { fontSize: 15, fontWeight: '800', color: '#fff' },
  monthTheme: { fontSize: 13, fontWeight: '600', color: Colors.text, minHeight: 36 },
  hallmarkRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  hallmarkChip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  hallmarkChipText: { fontSize: 10, fontWeight: '700' },
  hallmarkMore: { fontSize: 10, fontWeight: '700', alignSelf: 'center' },
});
