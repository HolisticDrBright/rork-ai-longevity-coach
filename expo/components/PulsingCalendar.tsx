import { useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import Colors from '@/constants/colors';

interface CalendarEntry {
  item: string;
  category: string;
  schedule: string;
  days: number[];
  color: string;
}

const COLOR_MAP: Record<string, string> = {
  green: '#10B981',
  amber: '#F59E0B',
  red: '#EF4444',
  blue: '#3B82F6',
  purple: '#8B5CF6',
};

const CATEGORY_LABELS: Record<string, string> = {
  supplement: 'Supplements',
  peptide: 'Peptides',
  fasting: 'Fasting',
  exercise: 'Exercise',
  modality: 'Modalities',
};

interface Props {
  entries: CalendarEntry[];
  totalDays?: number;
}

export default function PulsingCalendar({ entries, totalDays = 180 }: Props) {
  const [filterCategory, setFilterCategory] = useState<string>('all');

  const filtered = useMemo(() => {
    if (filterCategory === 'all') return entries;
    return entries.filter(e => e.category === filterCategory);
  }, [entries, filterCategory]);

  const categories = useMemo(() => {
    const cats = new Set(entries.map(e => e.category));
    return ['all', ...Array.from(cats)];
  }, [entries]);

  // Build day-to-entries map
  const dayActivity = useMemo(() => {
    const map: Record<number, { count: number; colors: string[] }> = {};
    for (let d = 0; d < totalDays; d++) {
      map[d] = { count: 0, colors: [] };
    }
    for (const entry of filtered) {
      for (const day of entry.days) {
        if (day < totalDays) {
          map[day].count++;
          if (!map[day].colors.includes(entry.color)) {
            map[day].colors.push(entry.color);
          }
        }
      }
    }
    return map;
  }, [filtered, totalDays]);

  return (
    <View style={styles.container}>
      {/* Category filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {categories.map(cat => (
          <TouchableOpacity
            key={cat}
            style={[styles.filterChip, filterCategory === cat && styles.filterChipActive]}
            onPress={() => setFilterCategory(cat)}
          >
            <Text style={[styles.filterChipText, filterCategory === cat && styles.filterChipTextActive]}>
              {cat === 'all' ? 'All' : CATEGORY_LABELS[cat] ?? cat}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* 180-day calendar grid */}
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.monthsContainer}>
          {Array.from({ length: 6 }, (_, monthIdx) => (
            <View key={monthIdx} style={styles.monthBlock}>
              <Text style={styles.monthLabel}>Month {monthIdx + 1}</Text>
              <View style={styles.daysGrid}>
                {Array.from({ length: 30 }, (_, dayIdx) => {
                  const dayNum = monthIdx * 30 + dayIdx;
                  const activity = dayActivity[dayNum];
                  const primaryColor = activity.colors[0];

                  return (
                    <View
                      key={dayNum}
                      style={[
                        styles.dayCell,
                        primaryColor && { backgroundColor: (COLOR_MAP[primaryColor] ?? Colors.primary) + '30' },
                        primaryColor && { borderColor: COLOR_MAP[primaryColor] ?? Colors.primary },
                      ]}
                    >
                      <Text style={[
                        styles.dayText,
                        primaryColor && { color: COLOR_MAP[primaryColor] ?? Colors.primary },
                      ]}>
                        {dayIdx + 1}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          ))}
        </View>

        {/* Legend */}
        <View style={styles.legend}>
          <Text style={styles.legendTitle}>Legend</Text>
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: COLOR_MAP.green }]} />
            <Text style={styles.legendText}>Daily (supplements)</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: COLOR_MAP.amber }]} />
            <Text style={styles.legendText}>Cyclical (peptides)</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: COLOR_MAP.red }]} />
            <Text style={styles.legendText}>Extended fasts</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: COLOR_MAP.blue }]} />
            <Text style={styles.legendText}>Daily fasting (IF 16:8)</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: COLOR_MAP.purple }]} />
            <Text style={styles.legendText}>Peptide (continuous)</Text>
          </View>
        </View>

        {/* Active entries list */}
        <View style={styles.entriesContainer}>
          <Text style={styles.entriesTitle}>Active Pulses ({filtered.length})</Text>
          {filtered.slice(0, 30).map((e, i) => (
            <View key={i} style={styles.entryRow}>
              <View style={[styles.entryDot, { backgroundColor: COLOR_MAP[e.color] ?? Colors.primary }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.entryItem}>{e.item}</Text>
                <Text style={styles.entrySchedule}>{e.schedule}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  filterRow: { padding: 12, gap: 6 },
  filterChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
  },
  filterChipActive: { backgroundColor: Colors.primary + '15', borderColor: Colors.primary },
  filterChipText: { fontSize: 12, color: Colors.textSecondary },
  filterChipTextActive: { color: Colors.primary, fontWeight: '600' },
  monthsContainer: { padding: 12, gap: 14 },
  monthBlock: {
    backgroundColor: Colors.surface, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: Colors.border, gap: 8,
  },
  monthLabel: { fontSize: 13, fontWeight: '700', color: Colors.text },
  daysGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
  dayCell: {
    width: 28, height: 28, borderRadius: 6,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: Colors.borderLight,
    backgroundColor: Colors.surfaceSecondary,
  },
  dayText: { fontSize: 10, fontWeight: '600', color: Colors.textTertiary },
  legend: {
    margin: 12, padding: 12,
    backgroundColor: Colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border, gap: 6,
  },
  legendTitle: { fontSize: 13, fontWeight: '700', color: Colors.text, marginBottom: 2 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendDot: { width: 12, height: 12, borderRadius: 6 },
  legendText: { fontSize: 12, color: Colors.textSecondary },
  entriesContainer: { padding: 12, gap: 8 },
  entriesTitle: { fontSize: 14, fontWeight: '700', color: Colors.text, marginBottom: 6 },
  entryRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 10, backgroundColor: Colors.surface, borderRadius: 8,
    borderWidth: 1, borderColor: Colors.border,
  },
  entryDot: { width: 10, height: 10, borderRadius: 5 },
  entryItem: { fontSize: 13, fontWeight: '600', color: Colors.text },
  entrySchedule: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
});
