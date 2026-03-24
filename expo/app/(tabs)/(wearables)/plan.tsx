import { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import {
  Dumbbell,
  Utensils,
  Moon,
  Droplets,
  AlertTriangle,
  CheckCircle,
  Clock,
  Sun,
  Pill,
  Wind,
  Coffee,
  Sparkles,
  Shield,
  Heart,
  Thermometer,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useWearables } from '@/providers/WearablesProvider';
import { RecoveryStatus } from '@/types/wearables';

const statusColors: Record<RecoveryStatus, { bg: string; text: string; border: string; gradient: [string, string] }> = {
  green: { bg: '#ECFDF5', text: '#059669', border: '#059669', gradient: ['#059669', '#10B981'] },
  yellow: { bg: '#FFFBEB', text: '#D97706', border: '#D97706', gradient: ['#D97706', '#F59E0B'] },
  red: { bg: '#FEF2F2', text: '#DC2626', border: '#DC2626', gradient: ['#DC2626', '#EF4444'] },
};

export default function PlanScreen() {
  const { recommendation, aiInsight, isGeneratingAI, generateAIInsight, practitionerFlags, dataCompleteness } = useWearables();
  const rec = recommendation;

  const handleGenerateAI = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    generateAIInsight();
  }, [generateAIInsight]);

  if (!rec) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>Loading your personalized plan...</Text>
      </View>
    );
  }

  const status = statusColors[rec.recoveryStatus];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <LinearGradient
        colors={status.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.statusBanner}
      >
        <View style={styles.statusBannerContent}>
          <View>
            <Text style={styles.statusScoreLabel}>Recovery</Text>
            <Text style={styles.statusScore}>{rec.recoveryScore}</Text>
          </View>
          <View style={styles.statusBannerRight}>
            <Text style={styles.statusBadgeText}>{rec.scores.recovery.label}</Text>
            {dataCompleteness && (
              <Text style={styles.statusConfidence}>Data: {dataCompleteness.score}%</Text>
            )}
          </View>
        </View>
        <Text style={styles.statusSummary}>{rec.oneSentenceSummary}</Text>
      </LinearGradient>

      {aiInsight && (
        <View style={styles.aiCard}>
          <View style={styles.aiCardHeader}>
            <Sparkles size={16} color={Colors.primary} />
            <Text style={styles.aiCardTitle}>AI Guidance</Text>
          </View>
          {aiInsight.trainingGuidance ? (
            <View style={styles.aiGuidanceRow}>
              <Dumbbell size={14} color="#2563EB" />
              <Text style={styles.aiGuidanceText}>{aiInsight.trainingGuidance}</Text>
            </View>
          ) : null}
          {aiInsight.nutritionGuidance ? (
            <View style={styles.aiGuidanceRow}>
              <Utensils size={14} color="#059669" />
              <Text style={styles.aiGuidanceText}>{aiInsight.nutritionGuidance}</Text>
            </View>
          ) : null}
          {aiInsight.sleepGuidance ? (
            <View style={styles.aiGuidanceRow}>
              <Moon size={14} color="#7C3AED" />
              <Text style={styles.aiGuidanceText}>{aiInsight.sleepGuidance}</Text>
            </View>
          ) : null}
          {aiInsight.stressGuidance ? (
            <View style={styles.aiGuidanceRow}>
              <Wind size={14} color="#0D9488" />
              <Text style={styles.aiGuidanceText}>{aiInsight.stressGuidance}</Text>
            </View>
          ) : null}
        </View>
      )}

      {!aiInsight && (
        <TouchableOpacity
          style={styles.generateAIBtn}
          onPress={handleGenerateAI}
          disabled={isGeneratingAI}
          activeOpacity={0.8}
        >
          {isGeneratingAI ? (
            <ActivityIndicator size="small" color={Colors.primary} />
          ) : (
            <Sparkles size={16} color={Colors.primary} />
          )}
          <Text style={styles.generateAIText}>
            {isGeneratingAI ? 'Generating AI plan...' : 'Generate AI-Powered Plan'}
          </Text>
        </TouchableOpacity>
      )}

      <SectionCard
        title="Training"
        icon={<Dumbbell size={20} color="#2563EB" />}
        color="#2563EB"
      >
        <Text style={styles.guidanceTitle}>{rec.trainingGuidance.label}</Text>
        <Text style={styles.guidanceBody}>{rec.trainingGuidance.explanation}</Text>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Suggested workout:</Text>
          <Text style={styles.detailValue}>{rec.trainingGuidance.suggestedWorkout}</Text>
        </View>
        <View style={styles.intensityBar}>
          <View style={[styles.intensityFill, { width: `${rec.trainingGuidance.intensityLevel * 10}%`, backgroundColor: '#2563EB' }]} />
        </View>
        <Text style={styles.intensityText}>Target intensity: {rec.trainingGuidance.intensityLevel}/10</Text>
      </SectionCard>

      <SectionCard
        title="Nutrition"
        icon={<Utensils size={20} color="#059669" />}
        color="#059669"
      >
        {rec.nutritionGuidance.suggestions.map((s, i) => (
          <View key={i} style={styles.bulletRow}>
            <CheckCircle size={14} color="#059669" />
            <Text style={styles.bulletText}>{s}</Text>
          </View>
        ))}
        <View style={styles.divider} />
        <View style={styles.detailRow}>
          <Clock size={14} color={Colors.textTertiary} />
          <Text style={styles.detailValue}>{rec.nutritionGuidance.mealTimingAdvice}</Text>
        </View>
        <View style={styles.targetRow}>
          <View style={styles.targetItem}>
            <Droplets size={16} color="#2563EB" />
            <Text style={styles.targetValue}>{(rec.nutritionGuidance.hydrationTargetMl / 1000).toFixed(1)}L</Text>
            <Text style={styles.targetLabel}>Hydration</Text>
          </View>
          <View style={styles.targetItem}>
            <Utensils size={16} color="#059669" />
            <Text style={styles.targetValue}>{rec.nutritionGuidance.proteinTargetG}g</Text>
            <Text style={styles.targetLabel}>Protein</Text>
          </View>
        </View>
        {rec.nutritionGuidance.notes ? (
          <Text style={styles.noteText}>{rec.nutritionGuidance.notes}</Text>
        ) : null}
      </SectionCard>

      <SectionCard
        title="Supplements"
        icon={<Pill size={20} color="#D97706" />}
        color="#D97706"
      >
        {rec.supplementGuidance.priorities.map((s, i) => (
          <View key={i} style={styles.supplementRow}>
            <View style={styles.supplementLeft}>
              <View style={[styles.priorityDot, {
                backgroundColor: s.priority === 'high' ? '#DC2626' : s.priority === 'medium' ? '#D97706' : '#6B7280'
              }]} />
              <View>
                <Text style={styles.supplementName}>{s.name}</Text>
                <Text style={styles.supplementTiming}>{s.timing}</Text>
              </View>
            </View>
            <Text style={styles.supplementReason} numberOfLines={2}>{s.reason}</Text>
          </View>
        ))}
        <Text style={styles.noteText}>{rec.supplementGuidance.notes}</Text>
      </SectionCard>

      <SectionCard
        title="Sleep"
        icon={<Moon size={20} color="#7C3AED" />}
        color="#7C3AED"
      >
        <View style={styles.sleepTargets}>
          <View style={styles.sleepTargetItem}>
            <Moon size={16} color="#7C3AED" />
            <Text style={styles.sleepTargetLabel}>Target bedtime</Text>
            <Text style={styles.sleepTargetValue}>{rec.sleepGuidance.targetBedtime}</Text>
          </View>
          <View style={styles.sleepTargetItem}>
            <Utensils size={16} color="#059669" />
            <Text style={styles.sleepTargetLabel}>Meal cutoff</Text>
            <Text style={styles.sleepTargetValue}>{rec.sleepGuidance.mealCutoff}</Text>
          </View>
          <View style={styles.sleepTargetItem}>
            <Coffee size={16} color="#92400E" />
            <Text style={styles.sleepTargetLabel}>Caffeine cutoff</Text>
            <Text style={styles.sleepTargetValue}>{rec.sleepGuidance.caffeineCutoff}</Text>
          </View>
        </View>
        <View style={styles.divider} />
        <Text style={styles.subSectionLabel}>Wind-down routine:</Text>
        {rec.sleepGuidance.windDownSuggestions.map((s, i) => (
          <View key={i} style={styles.bulletRow}>
            <CheckCircle size={14} color="#7C3AED" />
            <Text style={styles.bulletText}>{s}</Text>
          </View>
        ))}
        {rec.sleepGuidance.notes ? (
          <Text style={styles.noteText}>{rec.sleepGuidance.notes}</Text>
        ) : null}
      </SectionCard>

      <SectionCard
        title="Stress Regulation"
        icon={<Wind size={20} color="#0D9488" />}
        color="#0D9488"
      >
        {rec.stressGuidance.suggestions.map((s, i) => (
          <View key={i} style={styles.bulletRow}>
            <Sun size={14} color="#0D9488" />
            <Text style={styles.bulletText}>{s}</Text>
          </View>
        ))}
        {rec.stressGuidance.avoidItems.length > 0 && (
          <>
            <View style={styles.divider} />
            <Text style={styles.subSectionLabel}>Avoid today:</Text>
            {rec.stressGuidance.avoidItems.map((s, i) => (
              <View key={i} style={styles.bulletRow}>
                <AlertTriangle size={14} color="#DC2626" />
                <Text style={[styles.bulletText, { color: '#7F1D1D' }]}>{s}</Text>
              </View>
            ))}
          </>
        )}
        {rec.stressGuidance.notes ? (
          <Text style={styles.noteText}>{rec.stressGuidance.notes}</Text>
        ) : null}
      </SectionCard>

      <SectionCard
        title="Recovery Tools"
        icon={<Heart size={20} color="#EC4899" />}
        color="#EC4899"
      >
        <View style={styles.recoveryToolsGrid}>
          <RecoveryTool
            icon={<Thermometer size={18} color="#EC4899" />}
            label="Sauna"
            available={rec.scores.recovery.score >= 65}
            note={rec.scores.recovery.score >= 65 ? '15-20 min session' : 'Skip today — recovery too low'}
          />
          <RecoveryTool
            icon={<Droplets size={18} color="#3B82F6" />}
            label="Cold Plunge"
            available={rec.scores.recovery.score >= 55 && rec.scores.stressLoad.score >= 60}
            note={rec.scores.recovery.score >= 55 ? '2-3 min cold exposure' : 'Skip — HRV suppressed'}
          />
          <RecoveryTool
            icon={<Wind size={18} color="#0D9488" />}
            label="NSDR"
            available={true}
            note="10-20 min non-sleep deep rest"
          />
          <RecoveryTool
            icon={<Shield size={18} color="#7C3AED" />}
            label="Mobility"
            available={true}
            note="15-20 min gentle stretching"
          />
        </View>
      </SectionCard>

      {(rec.escalationFlags.length > 0 || practitionerFlags.length > 0) && (
        <SectionCard
          title="Practitioner Review"
          icon={<AlertTriangle size={20} color="#DC2626" />}
          color="#DC2626"
        >
          {rec.escalationFlags.map(flag => (
            <View key={flag.id} style={styles.escalationItem}>
              <Text style={styles.escalationMessage}>{flag.message}</Text>
              <Text style={styles.escalationRec}>{flag.recommendation}</Text>
              <Text style={styles.escalationDays}>Persisting: {flag.daysPersisting} days</Text>
            </View>
          ))}
          {practitionerFlags.filter(f => !rec.escalationFlags.some(e => e.id === f.id)).slice(0, 2).map(flag => (
            <View key={flag.id} style={styles.escalationItem}>
              <Text style={styles.escalationMessage}>{flag.summary}</Text>
              <Text style={styles.escalationDays}>{flag.severity} · {flag.daysPersisting} days</Text>
            </View>
          ))}
        </SectionCard>
      )}

      <View style={styles.disclaimer}>
        <Text style={styles.disclaimerText}>
          This plan is generated for wellness optimization and is not medical advice. Always consult your healthcare practitioner before making significant changes to your health routine.
        </Text>
      </View>
    </ScrollView>
  );
}

function SectionCard({ title, icon, color, children }: {
  title: string;
  icon: React.ReactNode;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.sectionCard, { borderTopColor: color }]}>
      <View style={styles.sectionCardHeader}>
        {icon}
        <Text style={styles.sectionCardTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function RecoveryTool({ icon, label, available, note }: {
  icon: React.ReactNode;
  label: string;
  available: boolean;
  note: string;
}) {
  return (
    <View style={[styles.recoveryTool, !available && styles.recoveryToolDisabled]}>
      {icon}
      <Text style={[styles.recoveryToolLabel, !available && styles.recoveryToolLabelDisabled]}>{label}</Text>
      <Text style={styles.recoveryToolNote}>{note}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 40 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: 15, color: Colors.textSecondary },
  statusBanner: {
    borderRadius: 18,
    padding: 20,
    marginBottom: 16,
  },
  statusBannerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  statusScoreLabel: { fontSize: 11, fontWeight: '700' as const, color: 'rgba(255,255,255,0.7)', letterSpacing: 1, marginBottom: 2 },
  statusScore: { fontSize: 44, fontWeight: '800' as const, color: '#fff' },
  statusBannerRight: { alignItems: 'flex-end', gap: 4 },
  statusBadgeText: { fontSize: 14, fontWeight: '700' as const, color: '#fff', backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8, overflow: 'hidden' },
  statusConfidence: { fontSize: 11, color: 'rgba(255,255,255,0.7)' },
  statusSummary: { fontSize: 14, color: 'rgba(255,255,255,0.9)', lineHeight: 20 },
  aiCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.primary + '20',
  },
  aiCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  aiCardTitle: { fontSize: 15, fontWeight: '700' as const, color: Colors.primary },
  aiGuidanceRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  aiGuidanceText: { flex: 1, fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
  generateAIBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: Colors.primary + '30',
    borderStyle: 'dashed' as const,
  },
  generateAIText: { fontSize: 14, fontWeight: '600' as const, color: Colors.primary },
  sectionCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderTopWidth: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  sectionCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  sectionCardTitle: { fontSize: 17, fontWeight: '700' as const, color: Colors.text },
  guidanceTitle: { fontSize: 15, fontWeight: '600' as const, color: Colors.text, marginBottom: 6 },
  guidanceBody: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19, marginBottom: 12 },
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  detailLabel: { fontSize: 13, fontWeight: '600' as const, color: Colors.text },
  detailValue: { fontSize: 13, color: Colors.textSecondary, flex: 1, lineHeight: 19 },
  intensityBar: { height: 6, backgroundColor: Colors.borderLight, borderRadius: 3, marginBottom: 6, marginTop: 8, overflow: 'hidden' },
  intensityFill: { height: '100%' as any, borderRadius: 3 },
  intensityText: { fontSize: 12, color: Colors.textTertiary, fontWeight: '500' as const },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  bulletText: { fontSize: 13, color: Colors.textSecondary, flex: 1, lineHeight: 19 },
  divider: { height: 1, backgroundColor: Colors.borderLight, marginVertical: 12 },
  targetRow: { flexDirection: 'row', gap: 16, marginTop: 12 },
  targetItem: { flex: 1, alignItems: 'center', backgroundColor: Colors.surfaceSecondary, borderRadius: 12, padding: 12, gap: 4 },
  targetValue: { fontSize: 20, fontWeight: '800' as const, color: Colors.text },
  targetLabel: { fontSize: 11, color: Colors.textTertiary, fontWeight: '500' as const },
  noteText: { fontSize: 12, color: Colors.primary, fontStyle: 'italic' as const, marginTop: 8 },
  supplementRow: { marginBottom: 12 },
  supplementLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  priorityDot: { width: 8, height: 8, borderRadius: 4 },
  supplementName: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  supplementTiming: { fontSize: 12, color: Colors.textTertiary },
  supplementReason: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17, marginLeft: 16 },
  subSectionLabel: { fontSize: 13, fontWeight: '600' as const, color: Colors.text, marginBottom: 8 },
  sleepTargets: { gap: 10 },
  sleepTargetItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sleepTargetLabel: { flex: 1, fontSize: 13, color: Colors.textSecondary },
  sleepTargetValue: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  recoveryToolsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  recoveryTool: {
    flexBasis: '47%' as any,
    flexGrow: 1,
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    gap: 6,
  },
  recoveryToolDisabled: { opacity: 0.5 },
  recoveryToolLabel: { fontSize: 13, fontWeight: '600' as const, color: Colors.text },
  recoveryToolLabelDisabled: { color: Colors.textTertiary },
  recoveryToolNote: { fontSize: 11, color: Colors.textTertiary, textAlign: 'center', lineHeight: 15 },
  escalationItem: { marginBottom: 12 },
  escalationMessage: { fontSize: 13, color: '#7F1D1D', fontWeight: '500' as const, lineHeight: 19, marginBottom: 4 },
  escalationRec: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17, marginBottom: 2 },
  escalationDays: { fontSize: 11, color: Colors.textTertiary },
  disclaimer: { padding: 14, backgroundColor: Colors.surfaceSecondary, borderRadius: 10, marginBottom: 20, marginTop: 4 },
  disclaimerText: { fontSize: 11, color: Colors.textTertiary, lineHeight: 16, textAlign: 'center' },
});
