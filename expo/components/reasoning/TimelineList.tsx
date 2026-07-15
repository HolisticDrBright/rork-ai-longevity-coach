import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  Activity,
  ClipboardList,
  Droplets,
  FlaskConical,
  Heart,
  Pill,
  TrendingUp,
  Utensils,
  Watch,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import type { TimelineEvent, TimelineEventKind } from '@/types/reasoning';
import { SourceBadge } from './SourceBadge';

const KIND_ICONS: Record<TimelineEventKind, React.ComponentType<{ size?: number; color?: string }>> = {
  lab_panel: FlaskConical,
  lab_marker: Droplets,
  symptom: Heart,
  protocol: ClipboardList,
  supplement: Pill,
  meal: Utensils,
  wearable_day: Watch,
  hormone: Activity,
  clinical_fact: TrendingUp,
  snapshot: TrendingUp,
};

function formatDay(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Grouped, provenance-labeled longitudinal timeline. */
export function TimelineList({ events }: { events: TimelineEvent[] }) {
  const groups = useMemo(() => {
    const byDay = new Map<string, TimelineEvent[]>();
    for (const e of events) {
      const day = e.observedAt.slice(0, 10);
      const list = byDay.get(day) ?? [];
      list.push(e);
      byDay.set(day, list);
    }
    return [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [events]);

  if (events.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>No timeline data yet</Text>
        <Text style={styles.emptyText}>
          Labs, symptoms, protocols, supplements, meals and wearable days will appear here as they are recorded.
        </Text>
      </View>
    );
  }

  return (
    <View testID="timeline-list">
      {groups.map(([day, dayEvents]) => (
        <View key={day} style={styles.dayGroup}>
          <Text style={styles.dayHeader}>{formatDay(dayEvents[0].observedAt)}</Text>
          {dayEvents.map((event) => {
            const Icon = KIND_ICONS[event.kind] ?? TrendingUp;
            const recordedLater =
              event.recordedAt && event.recordedAt.slice(0, 10) !== event.observedAt.slice(0, 10);
            return (
              <View key={event.id} style={styles.eventRow}>
                <View style={styles.iconColumn}>
                  <View style={styles.iconCircle}>
                    <Icon size={14} color={Colors.primary} />
                  </View>
                  <View style={styles.connector} />
                </View>
                <View style={styles.eventCard}>
                  <View style={styles.eventHeader}>
                    <Text style={styles.eventTitle} numberOfLines={2}>
                      {event.title}
                    </Text>
                    <Text style={styles.eventTime}>{formatTime(event.observedAt)}</Text>
                  </View>
                  {event.detail ? <Text style={styles.eventDetail}>{event.detail}</Text> : null}
                  <View style={styles.eventFooter}>
                    <SourceBadge sourceType={event.sourceType} />
                    {recordedLater && event.recordedAt ? (
                      <Text style={styles.recordedNote}>
                        recorded {formatDay(event.recordedAt)}
                      </Text>
                    ) : null}
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  dayGroup: {
    marginBottom: 16,
  },
  dayHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textSecondary,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  eventRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  iconColumn: {
    alignItems: 'center',
    width: 36,
  },
  iconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.surfaceSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connector: {
    flex: 1,
    width: 2,
    backgroundColor: Colors.borderLight,
    marginTop: 2,
  },
  eventCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    padding: 10,
    marginLeft: 6,
  },
  eventHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  eventTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
  },
  eventTime: {
    fontSize: 11,
    color: Colors.textTertiary,
  },
  eventDetail: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 3,
  },
  eventFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    gap: 8,
  },
  recordedNote: {
    fontSize: 10,
    color: Colors.textTertiary,
    fontStyle: 'italic',
  },
  empty: {
    padding: 24,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 6,
  },
  emptyText: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
  },
});
