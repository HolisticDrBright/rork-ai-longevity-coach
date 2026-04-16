import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import {
  ChevronDown,
  ChevronUp,
  Pill,
  Syringe,
  Utensils,
  Clock,
  Dumbbell,
  Flame,
  CheckCircle,
  Beaker,
  Sparkles,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { HALLMARKS } from '@/types';
import type { ProtocolMonth, HallmarkId } from '@/types';

const SECTION_CONFIG = [
  { key: 'supplements', label: 'Supplements', icon: Pill, color: '#3B82F6' },
  { key: 'peptides', label: 'Peptides', icon: Syringe, color: '#8B5CF6' },
  { key: 'diet', label: 'Diet', icon: Utensils, color: '#F97316' },
  { key: 'fasting', label: 'Fasting', icon: Clock, color: '#EC4899' },
  { key: 'exercise', label: 'Exercise', icon: Dumbbell, color: '#EAB308' },
  { key: 'modalities', label: 'Modalities', icon: Flame, color: '#14B8A6' },
  { key: 'lifestyle', label: 'Lifestyle', icon: Sparkles, color: '#10B981' },
  { key: 'labs', label: 'Labs to Order', icon: Beaker, color: '#6366F1' },
] as const;

interface Props {
  month: ProtocolMonth;
  onLogItem?: (itemKey: string, category: string, taken: boolean) => void;
}

export default function MonthDetailView({ month, onLogItem }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['supplements', 'peptides']));

  const toggle = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const hallmarksStr = month.hallmarksTargeted
    .map(h => HALLMARKS.find(hm => hm.id === h)?.name)
    .filter(Boolean)
    .join(' · ');

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Text style={styles.themeTitle}>{month.theme}</Text>
        <Text style={styles.hallmarksText}>Targets: {hallmarksStr}</Text>
        {month.checkInNotes && (
          <View style={styles.checkInBox}>
            <Text style={styles.checkInTitle}>Check-in Notes</Text>
            <Text style={styles.checkInText}>{month.checkInNotes}</Text>
          </View>
        )}
      </View>

      {SECTION_CONFIG.map((section) => {
        const Icon = section.icon;
        const isOpen = expanded.has(section.key);
        let count = 0;
        if (section.key === 'supplements') count = month.supplements.length;
        else if (section.key === 'peptides') count = month.peptides.length;
        else if (section.key === 'modalities') count = month.modalities.length;
        else if (section.key === 'lifestyle') count = month.lifestyle.length;
        else if (section.key === 'labs') count = month.labsToOrder.length;
        else count = 1;

        if (count === 0) return null;

        return (
          <View key={section.key} style={styles.sectionCard}>
            <TouchableOpacity
              style={styles.sectionHeader}
              onPress={() => toggle(section.key)}
              activeOpacity={0.8}
            >
              <View style={[styles.sectionIcon, { backgroundColor: section.color + '20' }]}>
                <Icon color={section.color} size={18} />
              </View>
              <View style={styles.sectionTitleContainer}>
                <Text style={styles.sectionTitle}>{section.label}</Text>
                <Text style={styles.sectionCount}>{count} item{count !== 1 ? 's' : ''}</Text>
              </View>
              {isOpen ? <ChevronUp color={Colors.textTertiary} size={20} /> : <ChevronDown color={Colors.textTertiary} size={20} />}
            </TouchableOpacity>

            {isOpen && (
              <View style={styles.sectionBody}>
                {section.key === 'supplements' && month.supplements.map((s, i) => (
                  <ItemRow
                    key={i}
                    title={s.name}
                    subtitle={`${s.dose} · ${s.timing}${s.brand ? ` · ${s.brand}` : ''}`}
                    meta={s.purpose}
                    hallmark={s.hallmark}
                    duration={s.duration}
                    color={section.color}
                    onLog={onLogItem ? () => onLogItem(s.name, 'supplement', true) : undefined}
                  />
                ))}

                {section.key === 'peptides' && month.peptides.map((p, i) => (
                  <ItemRow
                    key={i}
                    title={p.name}
                    subtitle={`${p.dose} · ${p.route} · ${p.cycle}`}
                    meta={p.purpose}
                    hallmark={p.hallmark}
                    color={section.color}
                    onLog={onLogItem ? () => onLogItem(p.name, 'peptide', true) : undefined}
                  />
                ))}

                {section.key === 'diet' && (
                  <View style={styles.dietBlock}>
                    <Text style={styles.dietType}>{month.diet.type.toUpperCase()}</Text>
                    {month.diet.macros && (
                      <Text style={styles.dietMacros}>
                        {month.diet.macros.protein ? `Protein: ${month.diet.macros.protein}` : ''}
                        {month.diet.macros.carbs ? ` · Carbs: ${month.diet.macros.carbs}` : ''}
                        {month.diet.macros.fat ? ` · Fat: ${month.diet.macros.fat}` : ''}
                      </Text>
                    )}
                    <Text style={styles.dietNotes}>{month.diet.notes}</Text>
                  </View>
                )}

                {section.key === 'fasting' && (
                  <View style={styles.dietBlock}>
                    <Text style={styles.dietType}>{month.fasting.protocol}</Text>
                    <Text style={styles.dietMacros}>Frequency: {month.fasting.frequency}</Text>
                    {month.fasting.cycleSyncNotes && (
                      <View style={styles.cycleSyncBox}>
                        <Text style={styles.cycleSyncText}>{month.fasting.cycleSyncNotes}</Text>
                      </View>
                    )}
                  </View>
                )}

                {section.key === 'exercise' && (
                  <View style={styles.dietBlock}>
                    <Text style={styles.exerciseRow}>💪 Strength: <Text style={styles.exerciseVal}>{month.exercise.strength}</Text></Text>
                    <Text style={styles.exerciseRow}>🏃 Cardio: <Text style={styles.exerciseVal}>{month.exercise.cardio}</Text></Text>
                    <Text style={styles.exerciseRow}>⚡ HIIT: <Text style={styles.exerciseVal}>{month.exercise.hiit}</Text></Text>
                    <Text style={styles.exerciseRow}>📅 Frequency: <Text style={styles.exerciseVal}>{month.exercise.frequency}</Text></Text>
                    <Text style={styles.exerciseRow}>🔥 Intensity: <Text style={styles.exerciseVal}>{month.exercise.intensity}</Text></Text>
                  </View>
                )}

                {section.key === 'modalities' && month.modalities.map((m, i) => (
                  <ItemRow
                    key={i}
                    title={m.modality}
                    subtitle={`${m.frequency} · ${m.duration}`}
                    meta={m.purpose}
                    color={section.color}
                  />
                ))}

                {section.key === 'lifestyle' && month.lifestyle.map((l, i) => (
                  <View key={i} style={styles.bulletRow}>
                    <CheckCircle color={section.color} size={14} />
                    <Text style={styles.bulletText}>{l}</Text>
                  </View>
                ))}

                {section.key === 'labs' && month.labsToOrder.map((lab, i) => (
                  <View key={i} style={styles.bulletRow}>
                    <Beaker color={section.color} size={14} />
                    <Text style={styles.bulletText}>{lab}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

function ItemRow({ title, subtitle, meta, hallmark, duration, color, onLog }: {
  title: string;
  subtitle: string;
  meta?: string;
  hallmark?: HallmarkId;
  duration?: string;
  color: string;
  onLog?: () => void;
}) {
  return (
    <View style={styles.itemRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.itemTitle}>{title}</Text>
        <Text style={styles.itemSubtitle}>{subtitle}</Text>
        {meta && <Text style={styles.itemMeta}>{meta}</Text>}
        <View style={styles.itemFooter}>
          {hallmark != null && (
            <View style={[styles.itemBadge, { backgroundColor: color + '15' }]}>
              <Text style={[styles.itemBadgeText, { color }]}>Hallmark {hallmark}</Text>
            </View>
          )}
          {duration && <Text style={styles.itemDuration}>{duration}</Text>}
        </View>
      </View>
      {onLog && (
        <TouchableOpacity style={[styles.logBtn, { backgroundColor: color }]} onPress={onLog}>
          <CheckCircle color="#fff" size={18} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { padding: 16, gap: 8 },
  themeTitle: { fontSize: 20, fontWeight: '800', color: Colors.text },
  hallmarksText: { fontSize: 12, color: Colors.textSecondary, lineHeight: 18 },
  checkInBox: {
    marginTop: 8, padding: 12,
    backgroundColor: Colors.primary + '10', borderRadius: 10,
  },
  checkInTitle: { fontSize: 12, fontWeight: '700', color: Colors.primary, marginBottom: 4 },
  checkInText: { fontSize: 13, color: Colors.text, lineHeight: 18 },
  sectionCard: {
    marginHorizontal: 16, marginBottom: 10,
    backgroundColor: Colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14,
  },
  sectionIcon: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  sectionTitleContainer: { flex: 1 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
  sectionCount: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  sectionBody: {
    paddingHorizontal: 14, paddingBottom: 14, gap: 10,
    borderTopWidth: 1, borderTopColor: Colors.borderLight, paddingTop: 12,
  },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  itemTitle: { fontSize: 14, fontWeight: '600', color: Colors.text },
  itemSubtitle: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  itemMeta: { fontSize: 11, color: Colors.textTertiary, marginTop: 4, lineHeight: 16 },
  itemFooter: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  itemBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  itemBadgeText: { fontSize: 10, fontWeight: '700' },
  itemDuration: { fontSize: 10, color: Colors.textTertiary, fontStyle: 'italic' },
  logBtn: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  dietBlock: { gap: 6 },
  dietType: { fontSize: 14, fontWeight: '700', color: Colors.text },
  dietMacros: { fontSize: 12, color: Colors.textSecondary },
  dietNotes: { fontSize: 13, color: Colors.text, lineHeight: 18, marginTop: 4 },
  cycleSyncBox: {
    marginTop: 8, padding: 10,
    backgroundColor: '#EC4899' + '10', borderRadius: 8,
    borderLeftWidth: 3, borderLeftColor: '#EC4899',
  },
  cycleSyncText: { fontSize: 12, color: Colors.text, lineHeight: 18 },
  exerciseRow: { fontSize: 13, color: Colors.text, lineHeight: 22 },
  exerciseVal: { color: Colors.textSecondary },
  bulletRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bulletText: { fontSize: 13, color: Colors.text, flex: 1 },
});
