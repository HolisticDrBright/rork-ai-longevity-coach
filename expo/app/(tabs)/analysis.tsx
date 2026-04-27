import { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Stethoscope,
  Leaf,
  Activity,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  CheckCircle,
  Sparkles,
  FileText,
  Heart,
  Thermometer,
  Droplets,
  Wind,
  Sun,
  Moon,
  Brain,
  Utensils,
  Plus,
} from 'lucide-react-native';

import Colors from '@/constants/colors';
import { useUser } from '@/providers/UserProvider';
import ChiefComplaintIntake from '@/components/ChiefComplaintIntake';
import ClinicalAIAssistant from '@/components/ClinicalAIAssistant';
import {
  TCM_PATTERNS,
  FUNCTIONAL_SYSTEMS,
  SYMPTOM_TO_PATTERN_MAP,
} from '@/constants/clinicalPatterns';
import { TCMPattern, FunctionalSystem, ChiefComplaint, AssociatedSymptom } from '@/types';

const TCM_PATTERN_ICONS: Partial<Record<TCMPattern, any>> = {
  qi_deficiency: Activity,
  qi_stagnation: Wind,
  blood_deficiency: Heart,
  blood_stasis: Droplets,
  yin_deficiency: Moon,
  yang_deficiency: Sun,
  dampness: Droplets,
  heat: Thermometer,
  cold: Thermometer,
};

const FUNCTIONAL_SYSTEM_ICONS: Partial<Record<FunctionalSystem, any>> = {
  blood_sugar: Activity,
  inflammation: AlertCircle,
  gut_function: Stethoscope,
  detoxification: Leaf,
  hormone_signaling: Activity,
  mitochondrial: Sparkles,
  nervous_system: Brain,
  immune_activation: AlertCircle,
};

export default function AnalysisScreen() {
  const {
    categoryScores,
    clinicalIntake,
    saveClinicalIntake,
    isLoading,
  } = useUser();

  const [showIntakeModal, setShowIntakeModal] = useState(false);
  const [showAIChat, setShowAIChat] = useState(false);
  const [expandedTCM, setExpandedTCM] = useState<string | null>(null);
  const [expandedFunctional, setExpandedFunctional] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'patterns' | 'tcm' | 'dietary'>('patterns');

  const detectedPatterns = useMemo(() => {
    const tcmPatterns: { pattern: TCMPattern; score: number; symptoms: string[] }[] = [];
    const functionalPatterns: { system: FunctionalSystem; score: number; symptoms: string[] }[] = [];

    const symptomMap: Record<string, number> = {};

    categoryScores.forEach(score => {
      if (score.percentage >= 25) {
        const categorySymptoms = getSymptomsByCategory(score.categoryId);
        categorySymptoms.forEach(s => {
          symptomMap[s] = Math.max(symptomMap[s] || 0, score.percentage);
        });
      }
    });

    if (clinicalIntake?.associatedSymptoms) {
      clinicalIntake.associatedSymptoms.forEach(s => {
        symptomMap[s.name.toLowerCase().replace(/\s+/g, '_')] = s.severity * 10;
      });
    }

    Object.entries(symptomMap).forEach(([symptom, severity]) => {
      const patterns = SYMPTOM_TO_PATTERN_MAP[symptom] || [];
      patterns.forEach(p => {
        const isTCM = TCM_PATTERNS.some(t => t.id === p);
        if (isTCM) {
          const existing = tcmPatterns.find(t => t.pattern === p as TCMPattern);
          if (existing) {
            existing.score += severity;
            if (!existing.symptoms.includes(symptom)) {
              existing.symptoms.push(symptom);
            }
          } else {
            tcmPatterns.push({ pattern: p as TCMPattern, score: severity, symptoms: [symptom] });
          }
        } else {
          const existing = functionalPatterns.find(f => f.system === p as FunctionalSystem);
          if (existing) {
            existing.score += severity;
            if (!existing.symptoms.includes(symptom)) {
              existing.symptoms.push(symptom);
            }
          } else {
            functionalPatterns.push({ system: p as FunctionalSystem, score: severity, symptoms: [symptom] });
          }
        }
      });
    });

    return {
      tcm: tcmPatterns.sort((a, b) => b.score - a.score),
      functional: functionalPatterns.sort((a, b) => b.score - a.score),
    };
  }, [categoryScores, clinicalIntake]);

  const dietaryRecommendations = useMemo(() => {
    const recommendations: { foods: string[]; avoid: string[]; source: string }[] = [];
    
    detectedPatterns.tcm.slice(0, 3).forEach(p => {
      const info = TCM_PATTERNS.find(t => t.id === p.pattern);
      if (info) {
        recommendations.push({
          foods: info.dietaryGuidance.foods,
          avoid: info.dietaryGuidance.avoid,
          source: info.name,
        });
      }
    });

    return recommendations;
  }, [detectedPatterns.tcm]);

  const handleIntakeComplete = useCallback((complaint: ChiefComplaint, symptoms: AssociatedSymptom[]) => {
    saveClinicalIntake(complaint, symptoms);
    setShowIntakeModal(false);
  }, [saveClinicalIntake]);

  const getScoreColor = (score: number) => {
    if (score >= 100) return Colors.danger;
    if (score >= 50) return Colors.warning;
    return Colors.success;
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#065F46', '#059669']}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={['top']}>
          <View style={styles.header}>
            <Stethoscope color="#fff" size={28} />
            <Text style={styles.headerTitle}>Clinical Analysis</Text>
            <Text style={styles.headerSubtitle}>
              Functional Medicine & TCM Framework
            </Text>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {clinicalIntake?.chiefComplaint ? (
          <View style={styles.chiefComplaintCard}>
            <View style={styles.chiefComplaintHeader}>
              <FileText color={Colors.primary} size={20} />
              <Text style={styles.chiefComplaintTitle}>Chief Complaint</Text>
              <TouchableOpacity
                style={styles.editButton}
                onPress={() => setShowIntakeModal(true)}
              >
                <Text style={styles.editButtonText}>Edit</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.chiefComplaintText}>
              {clinicalIntake.chiefComplaint.description}
            </Text>
            <View style={styles.chiefComplaintMeta}>
              <View style={styles.metaChip}>
                <Text style={styles.metaChipText}>
                  {clinicalIntake.chiefComplaint.onset === 'acute' ? 'Acute' : 'Chronic'}
                </Text>
              </View>
              <View style={styles.metaChip}>
                <Text style={styles.metaChipText}>
                  {clinicalIntake.chiefComplaint.duration}
                </Text>
              </View>
              <View style={[styles.metaChip, styles.severityChip]}>
                <Text style={styles.metaChipText}>
                  Severity: {clinicalIntake.chiefComplaint.severity}/10
                </Text>
              </View>
            </View>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.addIntakeCard}
            onPress={() => setShowIntakeModal(true)}
          >
            <View style={styles.addIntakeContent}>
              <View style={styles.addIntakeIcon}>
                <Plus color="#059669" size={24} />
              </View>
              <View style={styles.addIntakeText}>
                <Text style={styles.addIntakeTitle}>Add Chief Complaint</Text>
                <Text style={styles.addIntakeSubtitle}>
                  Document your primary health concern for better analysis
                </Text>
              </View>
            </View>
            <ChevronRight color={Colors.textSecondary} size={20} />
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={styles.aiAssistantCard}
          onPress={() => setShowAIChat(true)}
        >
          <LinearGradient
            colors={['#7C3AED', '#A855F7']}
            style={styles.aiAssistantGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            <View style={styles.aiAssistantIcon}>
              <Sparkles color="#fff" size={24} />
            </View>
            <View style={styles.aiAssistantContent}>
              <Text style={styles.aiAssistantTitle}>Clinical AI Assistant</Text>
              <Text style={styles.aiAssistantSubtitle}>
                Ask questions about your patterns & get personalized insights
              </Text>
            </View>
            <ChevronRight color="rgba(255,255,255,0.7)" size={20} />
          </LinearGradient>
        </TouchableOpacity>

        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'patterns' && styles.tabActive]}
            onPress={() => setActiveTab('patterns')}
          >
            <Activity color={activeTab === 'patterns' ? Colors.primary : Colors.textSecondary} size={18} />
            <Text style={[styles.tabText, activeTab === 'patterns' && styles.tabTextActive]}>
              Functional
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'tcm' && styles.tabActive]}
            onPress={() => setActiveTab('tcm')}
          >
            <Leaf color={activeTab === 'tcm' ? '#059669' : Colors.textSecondary} size={18} />
            <Text style={[styles.tabText, activeTab === 'tcm' && styles.tabTextActive]}>
              TCM Patterns
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'dietary' && styles.tabActive]}
            onPress={() => setActiveTab('dietary')}
          >
            <Utensils color={activeTab === 'dietary' ? '#F59E0B' : Colors.textSecondary} size={18} />
            <Text style={[styles.tabText, activeTab === 'dietary' && styles.tabTextActive]}>
              Dietary
            </Text>
          </TouchableOpacity>
        </View>

        {activeTab === 'patterns' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Functional Medicine Systems</Text>
            <Text style={styles.sectionSubtitle}>
              Analysis based on your questionnaire and symptoms
            </Text>

            {detectedPatterns.functional.length === 0 ? (
              <View style={styles.emptyState}>
                <Activity color={Colors.textTertiary} size={32} />
                <Text style={styles.emptyStateText}>
                  Complete the questionnaire to see functional patterns
                </Text>
              </View>
            ) : (
              detectedPatterns.functional.map(f => {
                const info = FUNCTIONAL_SYSTEMS.find(s => s.id === f.system);
                const isExpanded = expandedFunctional === f.system;
                const IconComponent = FUNCTIONAL_SYSTEM_ICONS[f.system] || Activity;
                const scoreColor = getScoreColor(f.score);

                return (
                  <TouchableOpacity
                    key={f.system}
                    style={styles.patternCard}
                    onPress={() => setExpandedFunctional(isExpanded ? null : f.system)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.patternHeader}>
                      <View style={[styles.patternIcon, { backgroundColor: `${scoreColor}15` }]}>
                        <IconComponent color={scoreColor} size={20} />
                      </View>
                      <View style={styles.patternInfo}>
                        <Text style={styles.patternName}>{info?.name || f.system}</Text>
                        <View style={styles.scoreBar}>
                          <View
                            style={[
                              styles.scoreBarFill,
                              { width: `${Math.min(f.score, 100)}%`, backgroundColor: scoreColor },
                            ]}
                          />
                        </View>
                      </View>
                      {isExpanded ? (
                        <ChevronUp color={Colors.textTertiary} size={20} />
                      ) : (
                        <ChevronDown color={Colors.textTertiary} size={20} />
                      )}
                    </View>

                    {isExpanded && info && (
                      <View style={styles.patternExpanded}>
                        <Text style={styles.patternDescription}>{info.description}</Text>

                        <Text style={styles.expandedLabel}>Key Symptoms</Text>
                        <View style={styles.chipRow}>
                          {info.keySymptoms.slice(0, 4).map((s, i) => (
                            <View key={i} style={styles.symptomChip}>
                              <Text style={styles.symptomChipText}>{s}</Text>
                            </View>
                          ))}
                        </View>

                        <Text style={styles.expandedLabel}>Root Causes to Consider</Text>
                        {info.rootCauses.slice(0, 3).map((cause, i) => (
                          <View key={i} style={styles.bulletItem}>
                            <View style={styles.bullet} />
                            <Text style={styles.bulletText}>{cause}</Text>
                          </View>
                        ))}

                        <Text style={styles.expandedLabel}>Support Strategies</Text>
                        {info.supportStrategies.slice(0, 3).map((strategy, i) => (
                          <View key={i} style={styles.bulletItem}>
                            <CheckCircle color={Colors.success} size={14} />
                            <Text style={styles.bulletText}>{strategy}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })
            )}
          </View>
        )}

        {activeTab === 'tcm' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>TCM Pattern Recognition</Text>
            <Text style={styles.sectionSubtitle}>
              Traditional patterns with modern interpretations
            </Text>

            {detectedPatterns.tcm.length === 0 ? (
              <View style={styles.emptyState}>
                <Leaf color={Colors.textTertiary} size={32} />
                <Text style={styles.emptyStateText}>
                  Complete the questionnaire to see TCM patterns
                </Text>
              </View>
            ) : (
              detectedPatterns.tcm.map(t => {
                const info = TCM_PATTERNS.find(p => p.id === t.pattern);
                const isExpanded = expandedTCM === t.pattern;
                const IconComponent = TCM_PATTERN_ICONS[t.pattern] || Leaf;

                return (
                  <TouchableOpacity
                    key={t.pattern}
                    style={styles.patternCard}
                    onPress={() => setExpandedTCM(isExpanded ? null : t.pattern)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.patternHeader}>
                      <View style={[styles.patternIcon, { backgroundColor: '#ECFDF5' }]}>
                        <IconComponent color="#059669" size={20} />
                      </View>
                      <View style={styles.patternInfo}>
                        <Text style={styles.patternName}>{info?.name || t.pattern}</Text>
                        <View style={styles.scoreBar}>
                          <View
                            style={[
                              styles.scoreBarFill,
                              { width: `${Math.min(t.score, 100)}%`, backgroundColor: '#059669' },
                            ]}
                          />
                        </View>
                      </View>
                      {isExpanded ? (
                        <ChevronUp color={Colors.textTertiary} size={20} />
                      ) : (
                        <ChevronDown color={Colors.textTertiary} size={20} />
                      )}
                    </View>

                    {isExpanded && info && (
                      <View style={styles.patternExpanded}>
                        <View style={styles.modernInterpretation}>
                          <Brain color="#7C3AED" size={16} />
                          <Text style={styles.modernInterpretationText}>
                            <Text style={styles.modernLabel}>Modern Interpretation: </Text>
                            {info.modernInterpretation}
                          </Text>
                        </View>

                        <Text style={styles.expandedLabel}>Common Symptoms</Text>
                        <View style={styles.chipRow}>
                          {info.commonSymptoms.slice(0, 4).map((s, i) => (
                            <View key={i} style={styles.tcmChip}>
                              <Text style={styles.tcmChipText}>{s}</Text>
                            </View>
                          ))}
                        </View>

                        <Text style={styles.expandedLabel}>Lifestyle Guidance</Text>
                        {info.lifestyleGuidance.slice(0, 3).map((guidance, i) => (
                          <View key={i} style={styles.bulletItem}>
                            <CheckCircle color="#059669" size={14} />
                            <Text style={styles.bulletText}>{guidance}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })
            )}
          </View>
        )}

        {activeTab === 'dietary' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Dietary Recommendations</Text>
            <Text style={styles.sectionSubtitle}>
              Based on your TCM patterns
            </Text>

            {dietaryRecommendations.length === 0 ? (
              <View style={styles.emptyState}>
                <Utensils color={Colors.textTertiary} size={32} />
                <Text style={styles.emptyStateText}>
                  Complete the questionnaire to see dietary guidance
                </Text>
              </View>
            ) : (
              dietaryRecommendations.map((rec, index) => (
                <View key={index} style={styles.dietaryCard}>
                  <View style={styles.dietaryHeader}>
                    <Leaf color="#059669" size={18} />
                    <Text style={styles.dietarySource}>For {rec.source}</Text>
                  </View>

                  <Text style={styles.dietaryLabel}>Foods to Include</Text>
                  <View style={styles.foodsGrid}>
                    {rec.foods.map((food, i) => (
                      <View key={i} style={styles.foodChip}>
                        <CheckCircle color={Colors.success} size={12} />
                        <Text style={styles.foodChipText}>{food}</Text>
                      </View>
                    ))}
                  </View>

                  <Text style={styles.dietaryLabel}>Foods to Minimize</Text>
                  <View style={styles.foodsGrid}>
                    {rec.avoid.map((food, i) => (
                      <View key={i} style={styles.avoidChip}>
                        <AlertCircle color={Colors.danger} size={12} />
                        <Text style={styles.avoidChipText}>{food}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        <View style={styles.disclaimer}>
          <AlertCircle color={Colors.warning} size={16} />
          <Text style={styles.disclaimerText}>
            This analysis is for educational purposes only and does not constitute medical advice. 
            Pattern recognition is based on symptom questionnaire data. Always consult a qualified 
            healthcare practitioner for diagnosis and treatment.
          </Text>
        </View>
      </ScrollView>

      <Modal
        visible={showIntakeModal}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        <SafeAreaView style={styles.modalContainer} edges={['top']}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowIntakeModal(false)}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Clinical Intake</Text>
            <View style={{ width: 60 }} />
          </View>
          <ChiefComplaintIntake
            onComplete={handleIntakeComplete}
            initialComplaint={clinicalIntake?.chiefComplaint}
            initialSymptoms={clinicalIntake?.associatedSymptoms}
          />
        </SafeAreaView>
      </Modal>

      <ClinicalAIAssistant
        isVisible={showAIChat}
        onClose={() => setShowAIChat(false)}
      />
    </View>
  );
}

function getSymptomsByCategory(categoryId: string): string[] {
  const symptomMap: Record<string, string[]> = {
    thyroid: ['fatigue', 'cold_intolerance', 'weight_gain', 'brain_fog'],
    adrenal: ['fatigue', 'anxiety', 'low_libido'],
    hormones: ['mood_swings', 'hot_flashes', 'low_libido'],
    gut_digestive: ['bloating', 'digestive_issues'],
    blood_sugar: ['fatigue', 'brain_fog', 'weight_gain'],
    autoimmune: ['joint_pain', 'fatigue', 'skin_issues'],
    lyme: ['fatigue', 'joint_pain', 'brain_fog'],
    mold: ['fatigue', 'brain_fog', 'digestive_issues'],
    heavy_metals: ['fatigue', 'brain_fog', 'mood_swings'],
    viral: ['fatigue', 'muscle_weakness'],
    methylation: ['fatigue', 'anxiety', 'brain_fog'],
    leaky_gut: ['bloating', 'skin_issues', 'joint_pain'],
  };
  return symptomMap[categoryId] || [];
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  loadingText: {
    fontSize: 16,
    color: Colors.textSecondary,
  },
  headerGradient: {
    paddingBottom: 20,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 16,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: '#fff',
    marginTop: 12,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 120,
  },
  chiefComplaintCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: Colors.primary,
  },
  chiefComplaintHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  chiefComplaintTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  editButton: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 8,
  },
  editButtonText: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '500' as const,
  },
  chiefComplaintText: {
    fontSize: 15,
    color: Colors.text,
    lineHeight: 22,
    marginBottom: 12,
  },
  chiefComplaintMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metaChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 8,
  },
  metaChipText: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  severityChip: {
    backgroundColor: '#FEF3C7',
  },
  addIntakeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: 'dashed',
  },
  addIntakeContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  addIntakeIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addIntakeText: {
    flex: 1,
  },
  addIntakeTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 2,
  },
  addIntakeSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  aiAssistantCard: {
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
  },
  aiAssistantGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 18,
    gap: 14,
  },
  aiAssistantIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiAssistantContent: {
    flex: 1,
  },
  aiAssistantTitle: {
    fontSize: 17,
    fontWeight: '600' as const,
    color: '#fff',
    marginBottom: 4,
  },
  aiAssistantSubtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.8)',
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  tabActive: {
    backgroundColor: Colors.surfaceSecondary,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
  },
  tabTextActive: {
    color: Colors.text,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 16,
  },
  emptyState: {
    alignItems: 'center',
    padding: 40,
    backgroundColor: Colors.surface,
    borderRadius: 16,
  },
  emptyStateText: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 12,
  },
  patternCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    marginBottom: 10,
    overflow: 'hidden',
  },
  patternHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  patternIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  patternInfo: {
    flex: 1,
  },
  patternName: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 6,
  },
  scoreBar: {
    height: 6,
    backgroundColor: Colors.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  scoreBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  patternExpanded: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  patternDescription: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 19,
    marginTop: 12,
    marginBottom: 16,
  },
  modernInterpretation: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    backgroundColor: '#F3E8FF',
    borderRadius: 10,
    marginTop: 12,
    marginBottom: 16,
  },
  modernInterpretationText: {
    flex: 1,
    fontSize: 13,
    color: Colors.text,
    lineHeight: 19,
  },
  modernLabel: {
    fontWeight: '600' as const,
    color: '#7C3AED',
  },
  expandedLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 8,
    marginTop: 12,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  symptomChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 10,
  },
  symptomChipText: {
    fontSize: 12,
    color: Colors.text,
  },
  tcmChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#ECFDF5',
    borderRadius: 10,
  },
  tcmChipText: {
    fontSize: 12,
    color: '#059669',
  },
  bulletItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 6,
  },
  bullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.textTertiary,
    marginTop: 6,
  },
  bulletText: {
    flex: 1,
    fontSize: 13,
    color: Colors.text,
    lineHeight: 19,
  },
  dietaryCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
  },
  dietaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  dietarySource: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: '#059669',
  },
  dietaryLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 10,
    marginTop: 8,
  },
  foodsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  foodChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#D1FAE5',
    borderRadius: 10,
  },
  foodChipText: {
    fontSize: 12,
    color: '#065F46',
  },
  avoidChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#FEE2E2',
    borderRadius: 10,
  },
  avoidChipText: {
    fontSize: 12,
    color: '#991B1B',
  },
  disclaimer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
  },
  disclaimerText: {
    flex: 1,
    fontSize: 11,
    color: '#92400E',
    lineHeight: 16,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  modalCancel: {
    fontSize: 16,
    color: Colors.primary,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600' as const,
    color: Colors.text,
  },
});
