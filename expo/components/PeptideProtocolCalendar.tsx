import { useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react-native';
import Colors from '@/constants/colors';
import type { PhaseType } from '@/types';

interface ProtocolPhase {
  id: string;
  phaseName: string;
  phaseOrder: number;
  phaseType: PhaseType;
  startDate?: string;
  endDate?: string;
  durationDays?: number;
}

interface ScheduleEntry {
  protocolPeptideId: string;
  peptideName: string;
  phaseName?: string;
  doseAmount: number;
  doseUnit: string;
  isActivePhase: boolean;
  durationDays: number;
}

const PHASE_COLORS: Record<PhaseType, string> = {
  loading: '#8B5CF6',
  active: Colors.success,
  maintenance: Colors.primary,
  taper: Colors.warning,
  off: Colors.textTertiary,
};

const PHASE_LABELS: Record<PhaseType, string> = {
  loading: 'Loading',
  active: 'Active',
  maintenance: 'Maintenance',
  taper: 'Taper',
  off: 'Off',
};

interface Props {
  phases: ProtocolPhase[];
  scheduleEntries?: ScheduleEntry[];
  protocolStartDate?: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function PeptideProtocolCalendar({ phases, protocolStartDate, scheduleEntries: _ }: Props) {
  const startDate = protocolStartDate ? new Date(protocolStartDate) : new Date();
  const [viewMonth, setViewMonth] = useState(startDate.getMonth());
  const [viewYear, setViewYear] = useState(startDate.getFullYear());

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
  const monthName = new Date(viewYear, viewMonth).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // Build a map of date -> phase for the visible month
  const datePhaseMap = useMemo(() => {
    const map: Record<number, PhaseType> = {};
    let currentDay = 0;
    for (const phase of phases.sort((a, b) => a.phaseOrder - b.phaseOrder)) {
      const pStart = phase.startDate ? new Date(phase.startDate) : new Date(startDate.getTime() + currentDay * 86400000);
      const dur = phase.durationDays ?? 30;
      for (let d = 0; d < dur; d++) {
        const date = new Date(pStart.getTime() + d * 86400000);
        if (date.getMonth() === viewMonth && date.getFullYear() === viewYear) {
          map[date.getDate()] = phase.phaseType;
        }
      }
      currentDay += dur;
    }
    return map;
  }, [phases, viewMonth, viewYear, startDate]);

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  };

  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  };

  const days = [];
  for (let i = 0; i < firstDayOfWeek; i++) days.push(null);
  for (let d = 1; d <= daysInMonth; d++) days.push(d);

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Calendar color={Colors.primary} size={20} />
        <Text style={styles.headerTitle}>Protocol Calendar</Text>
      </View>

      {/* Month Navigation */}
      <View style={styles.monthNav}>
        <TouchableOpacity onPress={prevMonth}><ChevronLeft color={Colors.text} size={22} /></TouchableOpacity>
        <Text style={styles.monthText}>{monthName}</Text>
        <TouchableOpacity onPress={nextMonth}><ChevronRight color={Colors.text} size={22} /></TouchableOpacity>
      </View>

      {/* Day Headers */}
      <View style={styles.weekRow}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <Text key={i} style={styles.weekDay}>{d}</Text>
        ))}
      </View>

      {/* Calendar Grid */}
      <View style={styles.calendarGrid}>
        {days.map((day, i) => {
          const phase = day ? datePhaseMap[day] : undefined;
          const phaseColor = phase ? PHASE_COLORS[phase] : undefined;
          const isToday = day === new Date().getDate() &&
            viewMonth === new Date().getMonth() &&
            viewYear === new Date().getFullYear();

          return (
            <View key={i} style={styles.dayCell}>
              {day ? (
                <View style={[
                  styles.dayCircle,
                  phaseColor ? { backgroundColor: phaseColor + '20' } : undefined,
                  isToday && styles.todayCircle,
                ]}>
                  <Text style={[
                    styles.dayText,
                    phaseColor ? { color: phaseColor } : undefined,
                    isToday && styles.todayText,
                  ]}>
                    {day}
                  </Text>
                  {phase === 'off' && <View style={styles.offDot} />}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>

      {/* Phase Legend */}
      <View style={styles.legendContainer}>
        {Object.entries(PHASE_LABELS).map(([type, label]) => (
          <View key={type} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: PHASE_COLORS[type as PhaseType] }]} />
            <Text style={styles.legendText}>{label}</Text>
          </View>
        ))}
      </View>

      {/* Phase Timeline */}
      {phases.length > 0 && (
        <View style={styles.timelineContainer}>
          <Text style={styles.timelineTitle}>Protocol Phases</Text>
          {phases.sort((a, b) => a.phaseOrder - b.phaseOrder).map((phase) => (
            <View key={phase.id} style={styles.timelineItem}>
              <View style={[styles.timelineDot, { backgroundColor: PHASE_COLORS[phase.phaseType] }]} />
              <View style={styles.timelineContent}>
                <Text style={styles.timelineName}>{phase.phaseName}</Text>
                <Text style={styles.timelineDetails}>
                  {PHASE_LABELS[phase.phaseType]} · {phase.durationDays ?? '—'} days
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 16 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
  monthNav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
  },
  monthText: { fontSize: 17, fontWeight: '600', color: Colors.text },
  weekRow: { flexDirection: 'row', paddingHorizontal: 8 },
  weekDay: { flex: 1, textAlign: 'center', fontSize: 13, fontWeight: '600', color: Colors.textTertiary, paddingVertical: 6 },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8 },
  dayCell: { width: '14.28%', aspectRatio: 1, justifyContent: 'center', alignItems: 'center', padding: 2 },
  dayCircle: {
    width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center',
  },
  dayText: { fontSize: 14, color: Colors.text },
  todayCircle: { borderWidth: 2, borderColor: Colors.primary },
  todayText: { fontWeight: '700', color: Colors.primary },
  offDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: Colors.textTertiary, position: 'absolute', bottom: 3 },
  legendContainer: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, paddingTop: 16, gap: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 12, color: Colors.textSecondary },
  timelineContainer: { padding: 16, gap: 10, marginTop: 8 },
  timelineTitle: { fontSize: 16, fontWeight: '700', color: Colors.text },
  timelineItem: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  timelineDot: { width: 12, height: 12, borderRadius: 6 },
  timelineContent: { flex: 1, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  timelineName: { fontSize: 14, fontWeight: '600', color: Colors.text },
  timelineDetails: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
});
