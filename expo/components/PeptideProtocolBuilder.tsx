import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import {
  Syringe,
  ChevronRight,
  Shield,
  AlertTriangle,
  Zap,
  Target,
  Moon,
  Heart,
  Brain,
  Sparkles,
  Flame,
  Dumbbell,
  Droplets,
  Bug,
  CheckCircle,
  RefreshCw,
  Info,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import type { PeptideGoal, InteractionSeverity } from '@/types';

interface GoalOption {
  id: PeptideGoal;
  label: string;
  icon: any;
  color: string;
  description: string;
}

const GOALS: GoalOption[] = [
  { id: 'fat_loss', label: 'Fat Loss', icon: Flame, color: '#EF4444', description: 'Optimize body composition and metabolism' },
  { id: 'muscle_growth', label: 'Muscle Growth', icon: Dumbbell, color: '#8B5CF6', description: 'Enhance lean mass and recovery' },
  { id: 'sleep', label: 'Sleep', icon: Moon, color: '#6366F1', description: 'Improve sleep architecture and quality' },
  { id: 'recovery', label: 'Recovery', icon: Heart, color: '#EC4899', description: 'Accelerate tissue repair and healing' },
  { id: 'injury_rehab', label: 'Injury Rehab', icon: Target, color: '#F97316', description: 'Targeted injury recovery protocols' },
  { id: 'cognition', label: 'Cognitive', icon: Brain, color: '#14B8A6', description: 'Enhance focus, memory, and neuroprotection' },
  { id: 'longevity', label: 'Longevity', icon: Sparkles, color: '#A855F7', description: 'Anti-aging and cellular repair' },
  { id: 'immune_support', label: 'Immune', icon: Shield, color: '#22C55E', description: 'Strengthen immune defense' },
  { id: 'metabolic_health', label: 'Metabolic', icon: Zap, color: '#EAB308', description: 'Optimize glucose and mitochondria' },
  { id: 'libido', label: 'Libido', icon: Droplets, color: '#E11D48', description: 'Support sexual health and hormones' },
  { id: 'skin_health', label: 'Skin', icon: Sparkles, color: '#F472B6', description: 'Rejuvenation and collagen support' },
];

const SEVERITY_COLORS: Record<string, string> = {
  info: Colors.success,
  caution: '#EAB308',
  warning: Colors.warning,
  critical: Colors.danger,
};

interface ProtocolRecommendation {
  goal: string;
  peptides: {
    slug: string;
    name: string;
    doseAmount: number;
    doseUnit: string;
    frequency: string;
    timing: string;
    durationWeeks: number;
    rationale: string;
  }[];
  reasoning: string;
  warnings: { severity: string; message: string }[];
  suggestedRetestTimeline: string;
}

interface Props {
  onGenerateProtocol?: (goal: PeptideGoal) => Promise<ProtocolRecommendation>;
  onSaveProtocol?: (recommendation: ProtocolRecommendation) => Promise<void>;
  isLoading?: boolean;
}

export default function PeptideProtocolBuilder({ onGenerateProtocol, onSaveProtocol, isLoading }: Props) {
  const [selectedGoal, setSelectedGoal] = useState<PeptideGoal | null>(null);
  const [recommendation, setRecommendation] = useState<ProtocolRecommendation | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleGoalSelect = useCallback(async (goal: PeptideGoal) => {
    setSelectedGoal(goal);
    if (onGenerateProtocol) {
      setGenerating(true);
      try {
        const result = await onGenerateProtocol(goal);
        setRecommendation(result);
      } catch (e) {
        Alert.alert('Error', 'Failed to generate protocol. Please try again.');
      } finally {
        setGenerating(false);
      }
    }
  }, [onGenerateProtocol]);

  const handleSave = useCallback(async () => {
    if (!recommendation || !onSaveProtocol) return;
    setSaving(true);
    try {
      await onSaveProtocol(recommendation);
      Alert.alert('Success', 'Protocol saved and activated!');
    } catch (e) {
      Alert.alert('Error', 'Failed to save protocol.');
    } finally {
      setSaving(false);
    }
  }, [recommendation, onSaveProtocol]);

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Syringe color={Colors.primary} size={24} />
        <Text style={styles.headerTitle}>AI Protocol Builder</Text>
      </View>
      <Text style={styles.headerSubtitle}>
        Select your primary health goal. The AI will analyze your labs and wearable data to build a personalized peptide protocol.
      </Text>

      {/* Goal Selection Grid */}
      <View style={styles.goalGrid}>
        {GOALS.map((goal) => {
          const Icon = goal.icon;
          const isSelected = selectedGoal === goal.id;
          return (
            <TouchableOpacity
              key={goal.id}
              style={[styles.goalCard, isSelected && { borderColor: goal.color, borderWidth: 2 }]}
              onPress={() => handleGoalSelect(goal.id)}
              disabled={generating}
            >
              <View style={[styles.goalIconContainer, { backgroundColor: goal.color + '20' }]}>
                <Icon color={goal.color} size={22} />
              </View>
              <Text style={styles.goalLabel}>{goal.label}</Text>
              <Text style={styles.goalDescription}>{goal.description}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Loading State */}
      {generating && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Analyzing your health data and generating protocol...</Text>
        </View>
      )}

      {/* Recommendation Result */}
      {recommendation && !generating && (
        <View style={styles.recommendationContainer}>
          <View style={styles.sectionHeader}>
            <CheckCircle color={Colors.success} size={20} />
            <Text style={styles.sectionTitle}>Recommended Protocol</Text>
          </View>
          <Text style={styles.reasoningText}>{recommendation.reasoning}</Text>

          {/* Warnings */}
          {recommendation.warnings.length > 0 && (
            <View style={styles.warningsContainer}>
              {recommendation.warnings.map((warning, i) => (
                <View key={i} style={[styles.warningCard, { borderLeftColor: SEVERITY_COLORS[warning.severity] ?? Colors.warning }]}>
                  <AlertTriangle color={SEVERITY_COLORS[warning.severity] ?? Colors.warning} size={16} />
                  <Text style={styles.warningText}>{warning.message}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Peptide List */}
          {recommendation.peptides.map((pep, i) => (
            <View key={i} style={styles.peptideCard}>
              <View style={styles.peptideHeader}>
                <Syringe color={Colors.primary} size={18} />
                <Text style={styles.peptideName}>{pep.name}</Text>
                <View style={styles.doseBadge}>
                  <Text style={styles.doseText}>{pep.doseAmount} {pep.doseUnit}</Text>
                </View>
              </View>
              <View style={styles.peptideDetails}>
                <Text style={styles.detailLabel}>Frequency: <Text style={styles.detailValue}>{pep.frequency}</Text></Text>
                <Text style={styles.detailLabel}>Timing: <Text style={styles.detailValue}>{pep.timing}</Text></Text>
                <Text style={styles.detailLabel}>Duration: <Text style={styles.detailValue}>{pep.durationWeeks} weeks</Text></Text>
              </View>
              <Text style={styles.rationaleText}>{pep.rationale}</Text>
            </View>
          ))}

          {/* Retest Timeline */}
          <View style={styles.retestCard}>
            <Info color={Colors.primary} size={16} />
            <Text style={styles.retestText}>{recommendation.suggestedRetestTimeline}</Text>
          </View>

          {/* Action Buttons */}
          <View style={styles.actionButtons}>
            <TouchableOpacity style={styles.regenerateButton} onPress={() => selectedGoal && handleGoalSelect(selectedGoal)}>
              <RefreshCw color={Colors.primary} size={18} />
              <Text style={styles.regenerateText}>Regenerate</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveButton} onPress={handleSave} disabled={saving}>
              {saving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <CheckCircle color="#fff" size={18} />
                  <Text style={styles.saveText}>Save & Activate</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 20 },
  headerTitle: { fontSize: 22, fontWeight: '700', color: Colors.text },
  headerSubtitle: { fontSize: 14, color: Colors.textSecondary, paddingHorizontal: 16, marginTop: 8, lineHeight: 20 },
  goalGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 8 },
  goalCard: {
    width: '48%', backgroundColor: Colors.surface, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: Colors.border, flexGrow: 1, flexBasis: '45%',
  },
  goalIconContainer: { width: 40, height: 40, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  goalLabel: { fontSize: 15, fontWeight: '600', color: Colors.text },
  goalDescription: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  loadingContainer: { alignItems: 'center', padding: 40, gap: 16 },
  loadingText: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center' },
  recommendationContainer: { padding: 16, gap: 12 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
  reasoningText: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20, fontStyle: 'italic' },
  warningsContainer: { gap: 8 },
  warningCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12,
    backgroundColor: '#FEF3C7', borderRadius: 8, borderLeftWidth: 4,
  },
  warningText: { fontSize: 13, color: Colors.text, flex: 1 },
  peptideCard: {
    backgroundColor: Colors.surface, borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: Colors.border, gap: 8,
  },
  peptideHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  peptideName: { fontSize: 16, fontWeight: '700', color: Colors.text, flex: 1 },
  doseBadge: { backgroundColor: Colors.primary + '15', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  doseText: { fontSize: 13, fontWeight: '600', color: Colors.primary },
  peptideDetails: { gap: 2 },
  detailLabel: { fontSize: 13, color: Colors.textSecondary },
  detailValue: { fontWeight: '600', color: Colors.text },
  rationaleText: { fontSize: 12, color: Colors.textTertiary, lineHeight: 18, marginTop: 4 },
  retestCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14,
    backgroundColor: Colors.primary + '10', borderRadius: 10,
  },
  retestText: { fontSize: 13, color: Colors.primary, flex: 1, fontWeight: '500' },
  actionButtons: { flexDirection: 'row', gap: 12, marginTop: 8 },
  regenerateButton: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 10, borderWidth: 1, borderColor: Colors.primary,
  },
  regenerateText: { fontSize: 15, fontWeight: '600', color: Colors.primary },
  saveButton: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 10, backgroundColor: Colors.primary,
  },
  saveText: { fontSize: 15, fontWeight: '600', color: '#fff' },
});
