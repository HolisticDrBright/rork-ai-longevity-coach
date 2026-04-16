import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import {
  FlaskConical,
  Syringe,
  ChevronRight,
  AlertCircle,
  Sparkles,
  Target,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import type { LabType } from '@/types';

interface LabPeptideMapping {
  id: string;
  labType: LabType;
  findingPattern: string;
  findingDescription: string;
  recommendedPeptideSlugs: string[];
  recommendedPeptides?: { name: string; slug: string; category: string }[];
  priorityLevel: number;
  reasoning: string;
  prerequisiteNote?: string;
}

const LAB_TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  blood_panel: { label: 'Blood Panel', color: '#EF4444' },
  dutch: { label: 'DUTCH Testing', color: '#8B5CF6' },
  gi_map: { label: 'GI MAP', color: '#22C55E' },
  oat: { label: 'OAT Testing', color: '#F97316' },
  mycotoxin: { label: 'Mycotoxin Panel', color: '#EAB308' },
  heavy_metal: { label: 'Heavy Metals', color: '#6B7280' },
  viral: { label: 'Viral Panel', color: '#EC4899' },
  lyme: { label: 'Lyme Testing', color: '#14B8A6' },
  sibo: { label: 'SIBO Testing', color: '#3B82F6' },
  gut_zoomer: { label: 'Gut Zoomer', color: '#10B981' },
};

function SuggestionCard({ mapping, onStartProtocol }: {
  mapping: LabPeptideMapping;
  onStartProtocol?: (mapping: LabPeptideMapping) => void;
}) {
  const labConfig = LAB_TYPE_CONFIG[mapping.labType] ?? { label: mapping.labType, color: Colors.primary };
  const priorityStars = '★'.repeat(mapping.priorityLevel) + '☆'.repeat(5 - mapping.priorityLevel);

  return (
    <View style={styles.suggestionCard}>
      <View style={styles.cardHeader}>
        <View style={[styles.labBadge, { backgroundColor: labConfig.color + '15' }]}>
          <FlaskConical color={labConfig.color} size={14} />
          <Text style={[styles.labBadgeText, { color: labConfig.color }]}>{labConfig.label}</Text>
        </View>
        <Text style={styles.priorityText}>{priorityStars}</Text>
      </View>

      <Text style={styles.findingText}>{mapping.findingDescription}</Text>

      <View style={styles.peptideList}>
        {(mapping.recommendedPeptides ?? []).map((pep, i) => (
          <View key={i} style={styles.peptideChip}>
            <Syringe color={Colors.primary} size={12} />
            <Text style={styles.peptideChipText}>{pep.name}</Text>
          </View>
        ))}
        {mapping.recommendedPeptides?.length === 0 && mapping.recommendedPeptideSlugs.map((slug, i) => (
          <View key={i} style={styles.peptideChip}>
            <Syringe color={Colors.primary} size={12} />
            <Text style={styles.peptideChipText}>{slug}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.reasoningText}>{mapping.reasoning}</Text>

      {mapping.prerequisiteNote && (
        <View style={styles.prerequisiteContainer}>
          <AlertCircle color={Colors.warning} size={14} />
          <Text style={styles.prerequisiteText}>{mapping.prerequisiteNote}</Text>
        </View>
      )}

      {onStartProtocol && (
        <TouchableOpacity
          style={styles.startButton}
          onPress={() => onStartProtocol(mapping)}
        >
          <Target color="#fff" size={16} />
          <Text style={styles.startButtonText}>Start This Protocol</Text>
          <ChevronRight color="#fff" size={16} />
        </TouchableOpacity>
      )}
    </View>
  );
}

interface Props {
  suggestions: LabPeptideMapping[];
  onStartProtocol?: (mapping: LabPeptideMapping) => void;
  selectedLabType?: LabType;
  onLabTypeSelect?: (type: LabType) => void;
}

export default function PeptideLabOptimization({
  suggestions,
  onStartProtocol,
  selectedLabType,
  onLabTypeSelect,
}: Props) {
  const labTypes = Object.entries(LAB_TYPE_CONFIG);
  const filteredSuggestions = selectedLabType
    ? suggestions.filter(s => s.labType === selectedLabType)
    : suggestions;

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Sparkles color={Colors.primary} size={22} />
        <Text style={styles.headerTitle}>AI Optimization Suggestions</Text>
      </View>
      <Text style={styles.headerSubtitle}>
        Based on your functional medicine lab results, these peptide protocols may support your health goals.
      </Text>

      {/* Lab Type Filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
        <View style={styles.filterRow}>
          <TouchableOpacity
            style={[styles.filterChip, !selectedLabType && styles.filterChipActive]}
            onPress={() => onLabTypeSelect?.(undefined as any)}
          >
            <Text style={[styles.filterChipText, !selectedLabType && styles.filterChipTextActive]}>All</Text>
          </TouchableOpacity>
          {labTypes.map(([key, config]) => (
            <TouchableOpacity
              key={key}
              style={[styles.filterChip, selectedLabType === key && { backgroundColor: config.color + '15', borderColor: config.color }]}
              onPress={() => onLabTypeSelect?.(key as LabType)}
            >
              <Text style={[styles.filterChipText, selectedLabType === key && { color: config.color }]}>{config.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Suggestions */}
      <View style={styles.suggestionsContainer}>
        {filteredSuggestions.map((suggestion) => (
          <SuggestionCard
            key={suggestion.id}
            mapping={suggestion}
            onStartProtocol={onStartProtocol}
          />
        ))}
        {filteredSuggestions.length === 0 && (
          <View style={styles.emptyState}>
            <FlaskConical color={Colors.textTertiary} size={36} />
            <Text style={styles.emptyTitle}>No Suggestions</Text>
            <Text style={styles.emptySubtitle}>Upload lab results to receive personalized peptide recommendations.</Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 20 },
  headerTitle: { fontSize: 20, fontWeight: '700', color: Colors.text },
  headerSubtitle: { fontSize: 14, color: Colors.textSecondary, paddingHorizontal: 16, marginTop: 6, lineHeight: 20 },
  filterScroll: { marginTop: 16 },
  filterRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 8 },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface,
  },
  filterChipActive: { backgroundColor: Colors.primary + '15', borderColor: Colors.primary },
  filterChipText: { fontSize: 13, fontWeight: '500', color: Colors.textSecondary },
  filterChipTextActive: { color: Colors.primary },
  suggestionsContainer: { padding: 16, gap: 12 },
  suggestionCard: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: Colors.border, gap: 10,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  labBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  labBadgeText: { fontSize: 12, fontWeight: '600' },
  priorityText: { fontSize: 14, color: Colors.warning },
  findingText: { fontSize: 15, fontWeight: '600', color: Colors.text },
  peptideList: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  peptideChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primary + '10', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6,
  },
  peptideChipText: { fontSize: 12, fontWeight: '500', color: Colors.primary },
  reasoningText: { fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  prerequisiteContainer: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: Colors.warning + '10', padding: 10, borderRadius: 8,
  },
  prerequisiteText: { fontSize: 12, color: Colors.text, flex: 1, lineHeight: 16 },
  startButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 12, marginTop: 4,
  },
  startButtonText: { fontSize: 14, fontWeight: '600', color: '#fff' },
  emptyState: { alignItems: 'center', padding: 32, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: Colors.text },
  emptySubtitle: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center' },
});
