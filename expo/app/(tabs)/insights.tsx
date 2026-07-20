import { useMemo, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Brain,
  AlertTriangle,
  CheckCircle,
  ChevronRight,
  ChevronDown,
  Thermometer,
  Zap,
  Activity,
  Stethoscope,
  Droplet,
  TrendingUp,
  Shield,
  Bug,
  Target,
  CloudRain,
  Atom,
  Citrus,
  Dna,
  Wifi,
  AlertCircle,
  ExternalLink,
  FlaskConical,
  MessageCircle,
  Send,
  Sparkles,
  X,
} from 'lucide-react-native';
import { router } from 'expo-router';

import Colors from '@/constants/colors';
import { useUser } from '@/providers/UserProvider';
import { useLabs } from '@/providers/LabsProvider';
import { useProtocol } from '@/providers/ProtocolProvider';
import { useRorkAgent } from '@rork-ai/toolkit-sdk';
import PeptideEducation from '@/components/PeptideEducation';
import { CategoryScore } from '@/types';
import {
  recommendLabs,
  scoreSubmission,
  SCREENING_DISCLAIMER,
  type LabRecommendation as RegistryLabRecommendation,
} from '@/registry';

const categoryIcons: Record<string, any> = {
  thyroid: Thermometer,
  adrenal: Zap,
  hormones: Activity,
  gut_digestive: Stethoscope,
  gallbladder: Droplet,
  blood_sugar: TrendingUp,
  autoimmune: Shield,
  parasites: Bug,
  lyme: Target,
  mold: CloudRain,
  heavy_metals: Atom,
  viral: Citrus,
  methylation: Dna,
  emf: Wifi,
  leaky_gut: AlertCircle,
};

const categoryColors: Record<string, string> = {
  thyroid: '#8B5CF6',
  adrenal: '#F59E0B',
  hormones: '#EC4899',
  gut_digestive: '#10B981',
  gallbladder: '#06B6D4',
  blood_sugar: '#EF4444',
  autoimmune: '#6366F1',
  parasites: '#84CC16',
  lyme: '#F97316',
  mold: '#14B8A6',
  heavy_metals: '#78716C',
  viral: '#A855F7',
  methylation: '#3B82F6',
  emf: '#FBBF24',
  leaky_gut: '#E11D48',
};

const disorderDescriptions: Record<string, string> = {
  thyroid: 'Thyroid dysfunction can cause fatigue, weight changes, temperature sensitivity, and metabolic issues.',
  adrenal: 'Adrenal fatigue/HPA axis dysfunction affects energy, stress response, and recovery.',
  hormones: 'Hormonal imbalances impact mood, energy, weight, libido, and reproductive health.',
  gut_digestive: 'Digestive issues like SIBO, dysbiosis, IBS, or Crohn\'s affect nutrient absorption and overall health.',
  gallbladder: 'Gallbladder/bile congestion impairs fat digestion and toxin elimination.',
  blood_sugar: 'Blood sugar dysregulation and insulin resistance affect energy, weight, and metabolic health.',
  autoimmune: 'Autoimmune conditions involve immune system attacking healthy tissue.',
  parasites: 'Parasitic infections can cause digestive issues, nutrient deficiencies, and systemic symptoms.',
  lyme: 'Lyme disease and co-infections cause multi-system chronic illness.',
  mold: 'Mold/mycotoxin exposure causes chronic inflammatory response syndrome (CIRS).',
  heavy_metals: 'Heavy metal toxicity affects neurological function, energy, and detoxification.',
  viral: 'Chronic viral reactivation (EBV, CMV) causes fatigue, immune dysfunction, and inflammation.',
  methylation: 'Methylation issues affect detox, neurotransmitters, and cellular repair.',
  emf: 'EMF sensitivity can cause headaches, fatigue, and neurological symptoms.',
  leaky_gut: 'Intestinal permeability allows toxins into bloodstream, triggering inflammation.',
};

export type ScreeningBand = 'insufficient_data' | 'below-threshold' | 'moderate' | 'elevated';

export interface ScreeningPattern {
  id: string;
  name: string;
  description: string;
  /** Symptom-pattern screening score — NOT a disease risk or diagnosis. */
  score: number | null;
  band: ScreeningBand;
  completeness: number;
  recommendedLabs: { id: string; name: string; why: string; priority: 'primary' | 'conditional' }[];
}

/**
 * Registry-backed screening view. Scores come from the versioned scoring
 * engine (scoring.v2 — answered-question denominator, insufficient-data
 * floor); lab candidates come ONLY from the versioned category→lab rules.
 * Everything shown here is a screening draft for practitioner review.
 */
const getScreeningPatterns = (
  responses: { questionId: string; severity: number }[],
): ScreeningPattern[] => {
  const screening = scoreSubmission(
    responses.map(r => ({ questionId: r.questionId, value: r.severity as 0 | 1 | 2 | 3 | 4 })),
  );
  const labs = recommendLabs(screening);
  const labsByCategory = new Map<string, RegistryLabRecommendation[]>();
  for (const rec of labs.recommendations) {
    for (const categoryId of rec.sourceCategoryIds) {
      const list = labsByCategory.get(categoryId) ?? [];
      list.push(rec);
      labsByCategory.set(categoryId, list);
    }
  }
  const bandRank: Record<ScreeningBand, number> = {
    elevated: 0, moderate: 1, 'below-threshold': 2, insufficient_data: 3,
  };
  return screening.categories
    .map(c => ({
      id: c.categoryId,
      name: c.categoryName,
      description: disorderDescriptions[c.categoryId] || '',
      score: c.rounded,
      band: c.band as ScreeningBand,
      completeness: c.completeness,
      recommendedLabs: (labsByCategory.get(c.categoryId) ?? []).map(l => ({
        id: l.labId, name: l.panelName, why: l.why, priority: l.priority,
      })),
    }))
    .sort((a, b) => bandRank[a.band] - bandRank[b.band] || (b.score ?? 0) - (a.score ?? 0));
};

export default function InsightsScreen() {
  const { questionnaireResponses, isLoading } = useUser();
  const { flaggedBiomarkers } = useLabs();
  const { todayAdherence } = useProtocol();
  const [expandedDisorder, setExpandedDisorder] = useState<string | null>(null);
  const [showAllDisorders, setShowAllDisorders] = useState(false);
  const [showAIChat, setShowAIChat] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const scrollViewRef = useRef<ScrollView>(null);

  const disorders = useMemo(() => getScreeningPatterns(questionnaireResponses), [questionnaireResponses]);

  const healthContext = useMemo(() => {
    const elevatedPatterns = disorders.filter(d => d.band === 'elevated').map(d => d.name);
    const moderatePatterns = disorders.filter(d => d.band === 'moderate').map(d => d.name);
    const flaggedLabs = flaggedBiomarkers.map(b => `${b.name}: ${b.value} ${b.unit} (${b.status})`);
    
    return `User Health Profile:
- Elevated screening patterns (NOT diagnoses): ${elevatedPatterns.join(', ') || 'None'}
- Moderate screening patterns (NOT diagnoses): ${moderatePatterns.join(', ') || 'None'}
- Flagged Lab Results: ${flaggedLabs.join(', ') || 'None available'}
- Today's Energy: ${todayAdherence?.symptoms?.energy || 'Not logged'}/10
- Today's Sleep: ${todayAdherence?.symptoms?.sleep || 'Not logged'}/10
- Today's Mood: ${todayAdherence?.symptoms?.mood || 'Not logged'}/10

You are a functional-medicine education assistant. You may EXPLAIN and rank only the deterministic screening results and lab candidates listed above — never add conditions, labs, products, doses, or diagnoses beyond them. Screening scores are symptom-pattern screening scores, not disease risks. Always remind the user that their practitioner reviews everything before any recommendation.`;
  }, [disorders, flaggedBiomarkers, todayAdherence]);

  const { messages, sendMessage } = useRorkAgent({
    tools: {},
  });

  const handleSendMessage = () => {
    if (!chatInput.trim()) return;
    const messageWithContext = `Context: ${healthContext}\n\nUser Question: ${chatInput}`;
    sendMessage(messageWithContext);
    setChatInput('');
    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const hasCompletedQuestionnaire = questionnaireResponses.length > 0;

  const elevatedCount = disorders.filter(d => d.band === 'elevated').length;
  const moderateCount = disorders.filter(d => d.band === 'moderate').length;
  const belowCount = disorders.filter(d => d.band === 'below-threshold' || d.band === 'insufficient_data').length;

  const displayedDisorders = showAllDisorders 
    ? disorders
    : disorders.filter(d => d.band === 'elevated' || d.band === 'moderate').slice(0, 8);

  const handleOpenLink = (url: string) => {
    if (url) {
      Linking.openURL(url);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  if (!hasCompletedQuestionnaire) {
    return (
      <View style={styles.container}>
        <SafeAreaView edges={['top']} style={styles.emptyContainer}>
          <Brain color={Colors.textTertiary} size={48} />
          <Text style={styles.emptyTitle}>Complete Your Assessment</Text>
          <Text style={styles.emptySubtitle}>
            Finish the health questionnaire to see your personalized health insights, risk assessments, and recommended lab tests.
          </Text>
          <TouchableOpacity
            style={styles.startButton}
            onPress={() => router.push('/onboarding' as any)}
          >
            <Text style={styles.startButtonText}>Start Assessment</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    );
  }

  const getBandColor = (band: ScreeningBand) => {
    switch (band) {
      case 'elevated': return Colors.danger;
      case 'moderate': return Colors.warning;
      case 'insufficient_data': return Colors.textTertiary;
      default: return Colors.success;
    }
  };

  const getBandBgColor = (band: ScreeningBand) => {
    switch (band) {
      case 'elevated': return '#FEE2E2';
      case 'moderate': return '#FEF3C7';
      case 'insufficient_data': return '#E5E7EB';
      default: return '#D1FAE5';
    }
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#1E3A5F', '#2D5A87']}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={['top']}>
          <View style={styles.header}>
            <Brain color={Colors.textInverse} size={28} />
            <Text style={styles.headerTitle}>Symptom-Pattern Screening</Text>
            <Text style={styles.headerSubtitle}>
              Screening scores from your questionnaire — not diagnoses. Your practitioner reviews everything.
            </Text>
          </View>

          <View style={styles.summaryRow}>
            <View style={[styles.summaryCard, { borderBottomColor: Colors.danger }]}>
              <AlertTriangle color={Colors.danger} size={20} />
              <Text style={styles.summaryValue}>{elevatedCount}</Text>
              <Text style={styles.summaryLabel}>Elevated</Text>
            </View>
            <View style={[styles.summaryCard, { borderBottomColor: Colors.warning }]}>
              <AlertTriangle color={Colors.warning} size={20} />
              <Text style={styles.summaryValue}>{moderateCount}</Text>
              <Text style={styles.summaryLabel}>Moderate</Text>
            </View>
            <View style={[styles.summaryCard, { borderBottomColor: Colors.success }]}>
              <CheckCircle color={Colors.success} size={20} />
              <Text style={styles.summaryValue}>{belowCount}</Text>
              <Text style={styles.summaryLabel}>Below threshold</Text>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pattern screening scores</Text>
          <Text style={styles.sectionSubtitle}>
            Tap a pattern to see the lab tests your practitioner may consider
          </Text>

          {displayedDisorders.map(disorder => {
            const isExpanded = expandedDisorder === disorder.id;
            const bandColor = getBandColor(disorder.band);
            const bandBgColor = getBandBgColor(disorder.band);
            const IconComponent = categoryIcons[disorder.id] || Brain;
            const iconColor = categoryColors[disorder.id] || Colors.primary;

            return (
              <TouchableOpacity
                key={disorder.id}
                style={styles.disorderCard}
                onPress={() => setExpandedDisorder(isExpanded ? null : disorder.id)}
                activeOpacity={0.7}
              >
                <View style={styles.disorderHeader}>
                  <View style={[styles.disorderIconContainer, { backgroundColor: `${iconColor}15` }]}>
                    <IconComponent color={iconColor} size={22} />
                  </View>
                  
                  <View style={styles.disorderContent}>
                    <View style={styles.disorderTitleRow}>
                      <Text style={styles.disorderName}>{disorder.name}</Text>
                      <View style={[styles.riskBadge, { backgroundColor: bandBgColor }]}>
                        <Text style={[styles.riskBadgeText, { color: bandColor }]}>
                          {disorder.band === 'insufficient_data' ? 'NEEDS MORE ANSWERS' : disorder.band.replace('-', ' ').toUpperCase()}
                        </Text>
                      </View>
                    </View>
                    
                    <View style={styles.percentageRow}>
                      <View style={styles.percentageBarBg}>
                        <View 
                          style={[
                            styles.percentageBarFill, 
                            { 
                              width: `${Math.max(disorder.score ?? 0, 3)}%`,
                              backgroundColor: bandColor,
                            }
                          ]} 
                        />
                      </View>
                      <Text style={[styles.percentageText, { color: bandColor }]}>
                        {disorder.score === null ? '—' : `${disorder.score}%`}
                      </Text>
                    </View>
                  </View>

                  {isExpanded ? (
                    <ChevronDown color={Colors.textTertiary} size={20} />
                  ) : (
                    <ChevronRight color={Colors.textTertiary} size={20} />
                  )}
                </View>

                {isExpanded && (
                  <View style={styles.expandedContent}>
                    <Text style={styles.disorderDescription}>
                      {disorder.description}
                    </Text>

                    {disorder.recommendedLabs.length > 0 && (
                      <View style={styles.labsSection}>
                        <View style={styles.labsHeader}>
                          <FlaskConical color={Colors.primary} size={16} />
                          <Text style={styles.labsTitle}>Lab candidates for practitioner review</Text>
                        </View>

                        {disorder.recommendedLabs.map(lab => (
                          <View
                            key={lab.id}
                            style={[
                              styles.labCard,
                              lab.priority === 'primary' && styles.labCardPrimary,
                            ]}
                          >
                            <View style={styles.labContent}>
                              <View style={styles.labTitleRow}>
                                <Text style={styles.labName}>{lab.name}</Text>
                                {lab.priority === 'primary' && (
                                  <View style={styles.primaryBadge}>
                                    <Text style={styles.primaryBadgeText}>PRIMARY</Text>
                                  </View>
                                )}
                              </View>
                              <Text style={styles.labDescription}>{lab.why}</Text>
                              <Text style={styles.labReviewNote}>
                                Draft candidate — your practitioner reviews and orders labs. Nothing is ordered from this screen.
                              </Text>
                            </View>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                )}
              </TouchableOpacity>
            );
          })}

          {!showAllDisorders && disorders.filter(d => d.band === 'below-threshold' || d.band === 'insufficient_data').length > 0 && (
            <TouchableOpacity
              style={styles.showAllButton}
              onPress={() => setShowAllDisorders(true)}
            >
              <Text style={styles.showAllText}>
                Show {disorders.filter(d => d.band === 'below-threshold' || d.band === 'insufficient_data').length} below-threshold patterns
              </Text>
              <ChevronDown color={Colors.primary} size={18} />
            </TouchableOpacity>
          )}

          {showAllDisorders && (
            <TouchableOpacity
              style={styles.showAllButton}
              onPress={() => setShowAllDisorders(false)}
            >
              <Text style={styles.showAllText}>Show Less</Text>
              <ChevronDown color={Colors.primary} size={18} style={{ transform: [{ rotate: '180deg' }] }} />
            </TouchableOpacity>
          )}
        </View>

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
              <Text style={styles.aiAssistantTitle}>AI Health Assistant</Text>
              <Text style={styles.aiAssistantSubtitle}>
                Get personalized advice based on your health data
              </Text>
            </View>
            <MessageCircle color="rgba(255,255,255,0.7)" size={20} />
          </LinearGradient>
        </TouchableOpacity>

        <PeptideEducation />

        <TouchableOpacity
          style={styles.labsPromptCard}
          onPress={() => router.push('/(tabs)/labs')}
        >
          <LinearGradient
            colors={[Colors.primary, Colors.primaryLight]}
            style={styles.labsPromptGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            <View style={styles.labsPromptContent}>
              <Text style={styles.labsPromptTitle}>Upload Your Lab Results</Text>
              <Text style={styles.labsPromptSubtitle}>
                Track your lab results and see trends over time
              </Text>
            </View>
            <ChevronRight color={Colors.textInverse} size={24} />
          </LinearGradient>
        </TouchableOpacity>

        <View style={styles.retakeCard}>
          <Text style={styles.retakeTitle}>Want to retake the assessment?</Text>
          <Text style={styles.retakeSubtitle}>
            Your symptoms may have changed since your last assessment
          </Text>
          <TouchableOpacity
            style={styles.retakeButton}
            onPress={() => router.push('/onboarding/questionnaire')}
          >
            <Text style={styles.retakeButtonText}>Retake Questionnaire</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.disclaimer}>
          <Text style={styles.disclaimerText}>
            These insights are for educational purposes only and do not constitute medical advice. 
            {SCREENING_DISCLAIMER} Scores reflect symptom frequency and severity only. Always consult with a 
            qualified healthcare practitioner before making health decisions or ordering lab tests.
          </Text>
        </View>
      </ScrollView>

      {showAIChat && (
        <View style={styles.chatOverlay}>
          <KeyboardAvoidingView 
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.chatContainer}
          >
            <View style={styles.chatHeader}>
              <View style={styles.chatHeaderLeft}>
                <Sparkles color="#7C3AED" size={20} />
                <Text style={styles.chatHeaderTitle}>AI Health Assistant</Text>
              </View>
              <TouchableOpacity onPress={() => setShowAIChat(false)}>
                <X color={Colors.text} size={24} />
              </TouchableOpacity>
            </View>

            <ScrollView 
              ref={scrollViewRef}
              style={styles.chatMessages}
              contentContainerStyle={styles.chatMessagesContent}
              showsVerticalScrollIndicator={false}
            >
              {messages.length === 0 && (
                <View style={styles.chatWelcome}>
                  <View style={styles.chatWelcomeIcon}>
                    <Sparkles color="#7C3AED" size={32} />
                  </View>
                  <Text style={styles.chatWelcomeTitle}>How can I help?</Text>
                  <Text style={styles.chatWelcomeText}>
                    Ask me about your health data, supplements, symptoms, or get personalized recommendations.
                  </Text>
                  <View style={styles.chatSuggestions}>
                    <TouchableOpacity 
                      style={styles.chatSuggestion}
                      onPress={() => sendMessage("What should I focus on based on my health data?")}
                    >
                      <Text style={styles.chatSuggestionText}>What should I focus on?</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={styles.chatSuggestion}
                      onPress={() => sendMessage("Can you explain my screening results?")}
                    >
                      <Text style={styles.chatSuggestionText}>Explain my screening results</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={styles.chatSuggestion}
                      onPress={() => sendMessage("What supplements might help me?")}
                    >
                      <Text style={styles.chatSuggestionText}>Supplement suggestions</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {messages.map((m) => (
                <View 
                  key={m.id} 
                  style={[
                    styles.chatBubble,
                    m.role === 'user' ? styles.chatBubbleUser : styles.chatBubbleAssistant
                  ]}
                >
                  {m.parts.map((part, i) => {
                    if (part.type === 'text') {
                      return (
                        <Text 
                          key={`${m.id}-${i}`} 
                          style={[
                            styles.chatBubbleText,
                            m.role === 'user' && styles.chatBubbleTextUser
                          ]}
                        >
                          {part.text}
                        </Text>
                      );
                    }
                    if (part.type === 'tool') {
                      return (
                        <View key={`${m.id}-${i}`} style={styles.chatTooling}>
                          <ActivityIndicator size="small" color="#7C3AED" />
                          <Text style={styles.chatToolingText}>Processing...</Text>
                        </View>
                      );
                    }
                    return null;
                  })}
                </View>
              ))}
            </ScrollView>

            <View style={styles.chatInputContainer}>
              <TextInput
                style={styles.chatInput}
                value={chatInput}
                onChangeText={setChatInput}
                placeholder="Ask about your health..."
                placeholderTextColor={Colors.textTertiary}
                multiline
                maxLength={500}
              />
              <TouchableOpacity 
                style={[styles.chatSendButton, !chatInput.trim() && styles.chatSendButtonDisabled]}
                onPress={handleSendMessage}
                disabled={!chatInput.trim()}
              >
                <Send color="#fff" size={18} />
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      )}
    </View>
  );
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
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '600' as const,
    color: Colors.text,
    marginTop: 20,
    marginBottom: 12,
  },
  emptySubtitle: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  startButton: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
  },
  startButtonText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.textInverse,
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
    color: Colors.textInverse,
    marginTop: 12,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
  },
  summaryRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginTop: 20,
    gap: 10,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    borderBottomWidth: 3,
  },
  summaryValue: {
    fontSize: 28,
    fontWeight: '700' as const,
    color: Colors.textInverse,
    marginTop: 6,
  },
  summaryLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 2,
    fontWeight: '500' as const,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 120,
  },
  section: {
    marginBottom: 20,
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
  disorderCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    marginBottom: 10,
    overflow: 'hidden',
  },
  disorderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
  },
  disorderIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  disorderContent: {
    flex: 1,
  },
  disorderTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  disorderName: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
    flex: 1,
  },
  riskBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginLeft: 8,
  },
  riskBadgeText: {
    fontSize: 10,
    fontWeight: '700' as const,
  },
  percentageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  percentageBarBg: {
    flex: 1,
    height: 6,
    backgroundColor: Colors.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  percentageBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  percentageText: {
    fontSize: 13,
    fontWeight: '600' as const,
    minWidth: 36,
    textAlign: 'right',
  },
  expandedContent: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  disorderDescription: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 19,
    marginTop: 12,
    marginBottom: 16,
  },
  labsSection: {
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 10,
    padding: 12,
  },
  labsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  labsTitle: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  labCard: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  labCardPrimary: {
    borderLeftWidth: 3,
    borderLeftColor: Colors.primary,
  },
  labContent: {
    flex: 1,
  },
  labTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  labName: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  primaryBadge: {
    backgroundColor: `${Colors.primary}15`,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  primaryBadgeText: {
    fontSize: 9,
    fontWeight: '700' as const,
    color: Colors.primary,
  },
  labDescription: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 17,
  },
  labReviewNote: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 6,
    fontStyle: 'italic' as const,
  },
  orderButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: `${Colors.primary}10`,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginLeft: 10,
  },
  orderButtonText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  showAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    marginTop: 4,
  },
  showAllText: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.primary,
  },
  labsPromptCard: {
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 16,
  },
  labsPromptGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 18,
  },
  labsPromptContent: {
    flex: 1,
  },
  labsPromptTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.textInverse,
    marginBottom: 4,
  },
  labsPromptSubtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.8)',
  },
  retakeCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 18,
    marginBottom: 16,
    alignItems: 'center',
  },
  retakeTitle: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 6,
  },
  retakeSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: 14,
  },
  retakeButton: {
    backgroundColor: Colors.surfaceSecondary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  retakeButtonText: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.primary,
  },
  disclaimer: {
    padding: 14,
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 10,
  },
  disclaimerText: {
    fontSize: 11,
    color: Colors.textTertiary,
    lineHeight: 16,
    textAlign: 'center',
  },
  aiAssistantCard: {
    borderRadius: 14,
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
  chatOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.background,
  },
  chatContainer: {
    flex: 1,
  },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    backgroundColor: Colors.surface,
  },
  chatHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  chatHeaderTitle: {
    fontSize: 17,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  chatMessages: {
    flex: 1,
  },
  chatMessagesContent: {
    padding: 16,
    paddingBottom: 24,
  },
  chatWelcome: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  chatWelcomeIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#F3E8FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  chatWelcomeTitle: {
    fontSize: 20,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 8,
  },
  chatWelcomeText: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  chatSuggestions: {
    gap: 10,
    width: '100%',
  },
  chatSuggestion: {
    backgroundColor: Colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  chatSuggestionText: {
    fontSize: 14,
    color: '#7C3AED',
    fontWeight: '500' as const,
    textAlign: 'center',
  },
  chatBubble: {
    maxWidth: '85%',
    padding: 14,
    borderRadius: 16,
    marginBottom: 12,
  },
  chatBubbleUser: {
    backgroundColor: '#7C3AED',
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  chatBubbleAssistant: {
    backgroundColor: Colors.surface,
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
  },
  chatBubbleText: {
    fontSize: 15,
    color: Colors.text,
    lineHeight: 22,
  },
  chatBubbleTextUser: {
    color: '#fff',
  },
  chatTooling: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chatToolingText: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  chatInputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    gap: 10,
  },
  chatInput: {
    flex: 1,
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: Colors.text,
    maxHeight: 100,
  },
  chatSendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#7C3AED',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatSendButtonDisabled: {
    opacity: 0.5,
  },
});
