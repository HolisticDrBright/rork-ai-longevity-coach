import { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
} from 'react-native';
import {
  Syringe,
  ChevronRight,
  ChevronDown,
  Shield,
  AlertTriangle,
  Zap,
  Flame,
  Heart,
  Activity,
  Sparkles,
  Info,
  X,
  CheckCircle,
  HelpCircle,
  BookOpen,
  Leaf,
} from 'lucide-react-native';

import Colors from '@/constants/colors';
import { useProtocol } from '@/providers/ProtocolProvider';
import { useUser } from '@/providers/UserProvider';
import { useLabs } from '@/providers/LabsProvider';
import { PeptideData } from '@/types';

type HealthGoal = 
  | 'weight_loss'
  | 'blood_sugar'
  | 'energy'
  | 'immune'
  | 'inflammation'
  | 'longevity';

interface GoalEducation {
  id: HealthGoal;
  title: string;
  icon: any;
  color: string;
  description: string;
  peptides: string[];
  labCorrelations: string[];
  symptomCorrelations: string[];
  differentiatingQuestions: DifferentiatingQuestion[];
}

interface DifferentiatingQuestion {
  id: string;
  question: string;
  options: string[];
  purpose: string;
}

const GOAL_EDUCATION: GoalEducation[] = [
  {
    id: 'weight_loss',
    title: 'Weight Loss & Metabolic Support',
    icon: Flame,
    color: '#EF4444',
    description: 'Peptides commonly discussed in research for their role in appetite signaling, metabolic efficiency, and body composition.',
    peptides: ['retatrutide', 'semaglutide', 'cjc1295_ipamorelin', 'mots_c'],
    labCorrelations: ['Fasting Insulin', 'HbA1c', 'Fasting Glucose', 'Leptin', 'Adiponectin'],
    symptomCorrelations: ['Cravings', 'Stubborn weight', 'Post-meal fatigue', 'Hunger between meals'],
    differentiatingQuestions: [
      {
        id: 'wl_1',
        question: 'Do you experience intense cravings, especially for carbohydrates?',
        options: ['Never', 'Sometimes', 'Often', 'Always'],
        purpose: 'Helps identify insulin/blood sugar dysregulation patterns',
      },
      {
        id: 'wl_2',
        question: 'Do your symptoms worsen after eating?',
        options: ['No', 'Sometimes', 'Yes, significantly'],
        purpose: 'Indicates potential metabolic dysfunction',
      },
    ],
  },
  {
    id: 'blood_sugar',
    title: 'Blood Sugar & Insulin Regulation',
    icon: Activity,
    color: '#F59E0B',
    description: 'Research discusses these peptides in relation to insulin sensitivity, glucose metabolism, and metabolic homeostasis.',
    peptides: ['semaglutide', 'retatrutide', 'mots_c'],
    labCorrelations: ['Fasting Glucose', 'HbA1c', 'Fasting Insulin', 'HOMA-IR', 'C-Peptide'],
    symptomCorrelations: ['Energy crashes', 'Post-meal drowsiness', 'Frequent hunger', 'Brain fog after meals'],
    differentiatingQuestions: [
      {
        id: 'bs_1',
        question: 'When do you notice energy dips during the day?',
        options: ['Morning', 'After meals', '2-3 hours after eating', 'Late afternoon'],
        purpose: 'Helps identify blood sugar patterns',
      },
      {
        id: 'bs_2',
        question: 'Do you feel shaky or irritable if you skip a meal?',
        options: ['Never', 'Sometimes', 'Often'],
        purpose: 'Indicates potential reactive hypoglycemia',
      },
    ],
  },
  {
    id: 'energy',
    title: 'Energy & Mitochondrial Support',
    icon: Zap,
    color: '#8B5CF6',
    description: 'These peptides are studied for their role in mitochondrial function, cellular energy production, and combating fatigue.',
    peptides: ['ss31', 'mots_c', 'humanin', 'nad_plus'],
    labCorrelations: ['Organic Acids', 'CoQ10', 'Carnitine', 'B Vitamins', 'Iron Panel'],
    symptomCorrelations: ['Persistent fatigue', 'Poor stamina', 'Brain fog', 'Slow recovery'],
    differentiatingQuestions: [
      {
        id: 'en_1',
        question: 'Is your fatigue more physical or mental?',
        options: ['Mostly physical', 'Mostly mental', 'Both equally'],
        purpose: 'Helps differentiate mitochondrial vs neurotransmitter issues',
      },
      {
        id: 'en_2',
        question: 'Does rest/sleep improve your energy?',
        options: ['Yes, significantly', 'Somewhat', 'Not really'],
        purpose: 'Indicates whether fatigue is recoverable or chronic',
      },
    ],
  },
  {
    id: 'immune',
    title: 'Immune Health & Resilience',
    icon: Shield,
    color: '#10B981',
    description: 'Research explores these peptides for immune signaling balance, innate and adaptive immune response support.',
    peptides: ['thymosin_alpha1'],
    labCorrelations: ['White Blood Cells', 'Lymphocytes', 'NK Cell Activity', 'Immunoglobulins'],
    symptomCorrelations: ['Frequent illness', 'Slow recovery', 'Chronic infections', 'Fatigue'],
    differentiatingQuestions: [
      {
        id: 'im_1',
        question: 'How often do you get sick (colds, infections)?',
        options: ['Rarely', '2-3 times/year', '4+ times/year', 'Chronic/ongoing'],
        purpose: 'Assesses immune resilience',
      },
      {
        id: 'im_2',
        question: 'Do you have known chronic viral infections (EBV, CMV)?',
        options: ['No', 'Yes, in past', 'Yes, currently active', 'Unknown'],
        purpose: 'Identifies potential viral reactivation',
      },
    ],
  },
  {
    id: 'inflammation',
    title: 'Inflammation & Tissue Repair',
    icon: Heart,
    color: '#EC4899',
    description: 'These peptides are discussed in research for tissue repair signaling, inflammatory modulation, and healing support.',
    peptides: ['bpc157', 'tb500'],
    labCorrelations: ['CRP', 'ESR', 'IL-6', 'TNF-alpha', 'Fibrinogen'],
    symptomCorrelations: ['Chronic pain', 'Joint issues', 'Slow healing', 'Muscle soreness'],
    differentiatingQuestions: [
      {
        id: 'in_1',
        question: 'Is your pain/inflammation localized or systemic?',
        options: ['Specific area', 'Multiple areas', 'Whole body'],
        purpose: 'Helps determine targeted vs systemic approach',
      },
      {
        id: 'in_2',
        question: 'How long have you had these symptoms?',
        options: ['< 2 weeks (acute)', '2-12 weeks', '> 3 months (chronic)'],
        purpose: 'Differentiates acute vs chronic inflammation',
      },
    ],
  },
  {
    id: 'longevity',
    title: 'Longevity & Healthy Aging',
    icon: Sparkles,
    color: '#6366F1',
    description: 'Research discusses these peptides in relation to cellular signaling, repair vs degeneration balance, and healthy aging pathways.',
    peptides: ['epitalon', 'ghk_cu', 'bioregulators', 'humanin', 'nad_plus'],
    labCorrelations: ['Telomere Length', 'Oxidative Stress Markers', 'IGF-1', 'DHEA-S'],
    symptomCorrelations: ['Accelerated aging signs', 'Poor sleep quality', 'Cognitive decline', 'Skin changes'],
    differentiatingQuestions: [
      {
        id: 'lo_1',
        question: 'What is your primary longevity concern?',
        options: ['Cognitive health', 'Physical function', 'Appearance/skin', 'Overall vitality'],
        purpose: 'Helps focus educational content',
      },
      {
        id: 'lo_2',
        question: 'Do you have a family history of age-related conditions?',
        options: ['No', 'Yes - cardiovascular', 'Yes - cognitive', 'Yes - cancer'],
        purpose: 'Identifies areas for preventive focus',
      },
    ],
  },
];

const PEPTIDE_EDUCATION_CONTENT: Record<string, {
  modernExplanation: string;
  tcmConnection?: string;
  keyMechanism: string;
  researchContext: string;
}> = {
  retatrutide: {
    modernExplanation: 'Retatrutide is a triple agonist targeting GLP-1, GIP, and glucagon receptors simultaneously. This multi-pathway approach may address appetite from multiple angles while also promoting energy expenditure.',
    keyMechanism: 'By activating three different receptors involved in metabolism, it aims to reduce appetite, enhance insulin sensitivity, and increase fat burning through the glucagon pathway.',
    researchContext: 'Phase 2 trials showed significant weight reduction, with ongoing Phase 3 studies. This represents a newer class of multi-agonist peptides.',
  },
  semaglutide: {
    modernExplanation: 'Semaglutide mimics GLP-1, a hormone that signals satiety to the brain and regulates blood sugar by enhancing insulin release.',
    keyMechanism: 'Works on the GLP-1 receptor to slow gastric emptying, reduce appetite signals, and improve insulin secretion in response to food.',
    researchContext: 'FDA-approved for weight management and diabetes. Extensive clinical trial data supports efficacy and safety.',
  },
  mots_c: {
    modernExplanation: 'MOTS-c is a mitochondria-derived peptide that acts as an "exercise mimetic" - it activates similar cellular pathways as physical exercise.',
    tcmConnection: 'In TCM terms, this may relate to strengthening Kidney Yang and Spleen Qi - the foundational energies that support metabolism and vitality.',
    keyMechanism: 'Activates AMPK (the cellular energy sensor), improving glucose uptake, insulin sensitivity, and metabolic efficiency.',
    researchContext: 'Emerging research shows promise for metabolic health. Human trials are ongoing with encouraging early results.',
  },
  ss31: {
    modernExplanation: 'SS-31 (Elamipretide) is a mitochondria-targeted peptide that helps stabilize the inner mitochondrial membrane.',
    tcmConnection: 'May support what TCM describes as Kidney Essence (Jing) - the fundamental energy reserve that declines with age.',
    keyMechanism: 'Stabilizes cardiolipin in mitochondrial membranes, reducing oxidative damage and improving ATP production.',
    researchContext: 'In clinical trials for mitochondrial diseases. Shows potential for age-related mitochondrial dysfunction.',
  },
  humanin: {
    modernExplanation: 'Humanin is a natural mitochondria-derived peptide with cytoprotective properties, meaning it helps protect cells from damage and death.',
    tcmConnection: 'Aligns with TCM concepts of nourishing Yin and protecting the body\'s vital essence from depletion.',
    keyMechanism: 'Inhibits apoptosis (programmed cell death), reduces oxidative stress, and has neuroprotective effects.',
    researchContext: 'Preclinical research shows neuroprotection against amyloid-beta toxicity. Human applications still investigational.',
  },
  nad_plus: {
    modernExplanation: 'NAD+ is a fundamental coenzyme required for hundreds of cellular reactions, including energy production and DNA repair.',
    tcmConnection: 'Supports what TCM calls the body\'s "vital Qi" - the essential energy needed for all physiological functions.',
    keyMechanism: 'Required for sirtuin activation (longevity genes), mitochondrial function, and cellular repair mechanisms.',
    researchContext: 'NAD+ levels decline with age. Supplementation strategies are actively researched for healthy aging.',
  },
  thymosin_alpha1: {
    modernExplanation: 'Thymosin Alpha-1 is an immune-modulating peptide that helps coordinate the immune response, supporting both innate and adaptive immunity.',
    tcmConnection: 'In TCM, relates to strengthening Wei Qi (defensive energy) and supporting the body\'s resistance to external pathogens.',
    keyMechanism: 'Enhances T-cell function, promotes dendritic cell maturation, and helps balance Th1/Th2 immune responses.',
    researchContext: 'Approved in 35+ countries for hepatitis and immune support. Extensive clinical history outside the US.',
  },
  bpc157: {
    modernExplanation: 'BPC-157 is a body protection compound derived from gastric juice that has shown remarkable healing properties in research.',
    tcmConnection: 'May support what TCM describes as promoting the smooth flow of Qi and Blood, essential for tissue repair.',
    keyMechanism: 'Promotes angiogenesis (new blood vessel formation), modulates nitric oxide, and supports collagen synthesis.',
    researchContext: 'Extensive preclinical data on tissue healing. Human trials limited but anecdotal reports are numerous.',
  },
  tb500: {
    modernExplanation: 'TB-500 (Thymosin Beta-4) is naturally present in most tissues and plays a key role in tissue repair and regeneration.',
    tcmConnection: 'Aligns with TCM principles of promoting Blood circulation and resolving stasis to support healing.',
    keyMechanism: 'Promotes cell migration, new blood vessel formation, and regulates actin for tissue repair.',
    researchContext: 'Research primarily in wound healing and cardiac repair. Used extensively in veterinary medicine.',
  },
  epitalon: {
    modernExplanation: 'Epitalon is a synthetic peptide that may activate telomerase, the enzyme responsible for maintaining telomere length.',
    tcmConnection: 'May relate to preserving Kidney Essence (Jing), which TCM associates with aging and longevity.',
    keyMechanism: 'Theorized to activate telomerase and support pineal gland function for circadian rhythm regulation.',
    researchContext: 'Developed in Russia with decades of research. Limited Western clinical data but intriguing preclinical findings.',
  },
  ghk_cu: {
    modernExplanation: 'GHK-Cu is a copper-binding peptide naturally found in plasma that declines with age. Known for skin and tissue support.',
    tcmConnection: 'Supports what TCM describes as nourishing Blood and Yin, which are essential for skin and tissue vitality.',
    keyMechanism: 'Promotes collagen synthesis, wound healing, anti-inflammatory effects, and antioxidant gene expression.',
    researchContext: 'Well-studied for skin health. Injectable forms extend benefits beyond topical application.',
  },
  bioregulators: {
    modernExplanation: 'Bioregulators are short-chain peptides derived from organ-specific tissues, theorized to support tissue-specific function.',
    tcmConnection: 'Reflects TCM\'s organ-specific approach to supporting individual organ systems for overall harmony.',
    keyMechanism: 'Believed to regulate gene expression in target tissues, supporting tissue-specific repair and function.',
    researchContext: 'Developed in Russia with extensive research history. Available as oral supplements.',
  },
  cjc1295_ipamorelin: {
    modernExplanation: 'This combination stimulates natural growth hormone release without the side effects of direct GH administration.',
    keyMechanism: 'CJC-1295 extends GH release duration while Ipamorelin provides pulsatile stimulation without affecting cortisol.',
    researchContext: 'Widely used in clinical settings for anti-aging and body composition. Good safety profile in studies.',
  },
};

const SAFETY_DISCLAIMER = `This information is educational and should be reviewed with a qualified healthcare provider familiar with peptide therapy. Peptides discussed here are not FDA-approved treatments and should not be used without proper medical supervision. Individual results may vary significantly.`;

interface PeptideEducationProps {
  onSelectGoal?: (goal: HealthGoal) => void;
}

export default function PeptideEducation({ onSelectGoal }: PeptideEducationProps) {
  const { peptideDatabase, peptideAcknowledged, acknowledgePeptideDisclaimer } = useProtocol();
  const { userProfile, categoryScores } = useUser();
  const { flaggedBiomarkers } = useLabs();
  
  const [selectedGoal, setSelectedGoal] = useState<HealthGoal | null>(null);
  const [expandedPeptide, setExpandedPeptide] = useState<string | null>(null);
  const [showQuestions, setShowQuestions] = useState(false);
  const [questionResponses, setQuestionResponses] = useState<Record<string, string>>({});
  const [showDisclaimer, setShowDisclaimer] = useState(false);

  const relevantGoals = useMemo(() => {
    const goals: HealthGoal[] = [];
    
    if (userProfile?.goals) {
      if (userProfile.goals.includes('weight_loss')) goals.push('weight_loss');
      if (userProfile.goals.includes('energy')) goals.push('energy');
      if (userProfile.goals.includes('longevity')) goals.push('longevity');
    }

    const highRiskCategories = categoryScores
      .filter(s => s.percentage >= 40)
      .map(s => s.categoryId);
    
    if (highRiskCategories.includes('blood_sugar')) goals.push('blood_sugar');
    if (highRiskCategories.includes('autoimmune') || highRiskCategories.includes('viral')) {
      goals.push('immune');
    }

    const hasInflammatoryMarkers = flaggedBiomarkers.some(
      b => ['CRP', 'ESR', 'Homocysteine'].includes(b.name) && b.status !== 'optimal'
    );
    if (hasInflammatoryMarkers) goals.push('inflammation');

    return [...new Set(goals)];
  }, [userProfile, categoryScores, flaggedBiomarkers]);

  const selectedGoalData = useMemo(() => {
    return GOAL_EDUCATION.find(g => g.id === selectedGoal);
  }, [selectedGoal]);

  const relevantPeptides = useMemo(() => {
    if (!selectedGoalData) return [];
    return selectedGoalData.peptides
      .map(id => peptideDatabase.find(p => p.id === id))
      .filter(Boolean) as PeptideData[];
  }, [selectedGoalData, peptideDatabase]);

  const labCorrelations = useMemo(() => {
    if (!selectedGoalData) return [];
    return flaggedBiomarkers.filter(
      b => selectedGoalData.labCorrelations.some(
        lab => b.name.toLowerCase().includes(lab.toLowerCase())
      )
    );
  }, [selectedGoalData, flaggedBiomarkers]);

  const handleSelectGoal = useCallback((goal: HealthGoal) => {
    if (!peptideAcknowledged) {
      setShowDisclaimer(true);
      return;
    }
    setSelectedGoal(goal);
    setExpandedPeptide(null);
    setShowQuestions(false);
    onSelectGoal?.(goal);
  }, [peptideAcknowledged, onSelectGoal]);

  const handleAcceptDisclaimer = useCallback(() => {
    acknowledgePeptideDisclaimer();
    setShowDisclaimer(false);
  }, [acknowledgePeptideDisclaimer]);

  const getPeptideEducation = (peptideId: string) => {
    return PEPTIDE_EDUCATION_CONTENT[peptideId];
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <BookOpen color="#6366F1" size={24} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>Peptide Education</Text>
          <Text style={styles.headerSubtitle}>
            Learn about peptides commonly discussed in research
          </Text>
        </View>
      </View>

      {!selectedGoal ? (
        <View style={styles.goalsContainer}>
          <Text style={styles.sectionTitle}>Select a Health Goal</Text>
          <Text style={styles.sectionDescription}>
            Choose a goal to see related peptide education
          </Text>

          {relevantGoals.length > 0 && (
            <View style={styles.suggestedSection}>
              <Text style={styles.suggestedLabel}>Based on your profile:</Text>
              <View style={styles.suggestedGoals}>
                {relevantGoals.slice(0, 3).map(goalId => {
                  const goal = GOAL_EDUCATION.find(g => g.id === goalId);
                  if (!goal) return null;
                  const Icon = goal.icon;
                  return (
                    <TouchableOpacity
                      key={goal.id}
                      style={[styles.suggestedGoalChip, { borderColor: goal.color }]}
                      onPress={() => handleSelectGoal(goal.id)}
                    >
                      <Icon color={goal.color} size={14} />
                      <Text style={[styles.suggestedGoalText, { color: goal.color }]}>
                        {goal.title.split(' ')[0]}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          <View style={styles.goalsList}>
            {GOAL_EDUCATION.map(goal => {
              const Icon = goal.icon;
              return (
                <TouchableOpacity
                  key={goal.id}
                  style={styles.goalCard}
                  onPress={() => handleSelectGoal(goal.id)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.goalIcon, { backgroundColor: `${goal.color}15` }]}>
                    <Icon color={goal.color} size={22} />
                  </View>
                  <View style={styles.goalContent}>
                    <Text style={styles.goalTitle}>{goal.title}</Text>
                    <Text style={styles.goalDescription} numberOfLines={2}>
                      {goal.description}
                    </Text>
                  </View>
                  <ChevronRight color={Colors.textTertiary} size={20} />
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ) : (
        <View style={styles.educationContainer}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => setSelectedGoal(null)}
          >
            <ChevronDown color={Colors.primary} size={18} style={{ transform: [{ rotate: '90deg' }] }} />
            <Text style={styles.backText}>All Goals</Text>
          </TouchableOpacity>

          {selectedGoalData && (
            <>
              <View style={[styles.goalHeader, { borderLeftColor: selectedGoalData.color }]}>
                <View style={[styles.goalHeaderIcon, { backgroundColor: `${selectedGoalData.color}15` }]}>
                  {(() => {
                    const Icon = selectedGoalData.icon;
                    return <Icon color={selectedGoalData.color} size={24} />;
                  })()}
                </View>
                <View style={styles.goalHeaderText}>
                  <Text style={styles.goalHeaderTitle}>{selectedGoalData.title}</Text>
                  <Text style={styles.goalHeaderDesc}>{selectedGoalData.description}</Text>
                </View>
              </View>

              {labCorrelations.length > 0 && (
                <View style={styles.correlationCard}>
                  <View style={styles.correlationHeader}>
                    <Activity color="#F59E0B" size={16} />
                    <Text style={styles.correlationTitle}>Your Lab Correlations</Text>
                  </View>
                  <Text style={styles.correlationText}>
                    Based on your labs, these markers may relate to this goal:
                  </Text>
                  <View style={styles.correlationMarkers}>
                    {labCorrelations.map(marker => (
                      <View key={marker.id} style={styles.markerChip}>
                        <Text style={styles.markerName}>{marker.name}</Text>
                        <Text style={[
                          styles.markerStatus,
                          { color: marker.status === 'optimal' ? Colors.success : Colors.warning }
                        ]}>
                          {marker.value} {marker.unit}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              <TouchableOpacity
                style={styles.questionsToggle}
                onPress={() => setShowQuestions(!showQuestions)}
              >
                <HelpCircle color="#6366F1" size={18} />
                <Text style={styles.questionsToggleText}>
                  Clarifying Questions
                </Text>
                <ChevronDown
                  color={Colors.textTertiary}
                  size={18}
                  style={{ transform: [{ rotate: showQuestions ? '180deg' : '0deg' }] }}
                />
              </TouchableOpacity>

              {showQuestions && selectedGoalData.differentiatingQuestions.length > 0 && (
                <View style={styles.questionsContainer}>
                  {selectedGoalData.differentiatingQuestions.map(q => (
                    <View key={q.id} style={styles.questionCard}>
                      <Text style={styles.questionText}>{q.question}</Text>
                      <Text style={styles.questionPurpose}>{q.purpose}</Text>
                      <View style={styles.questionOptions}>
                        {q.options.map(option => (
                          <TouchableOpacity
                            key={option}
                            style={[
                              styles.questionOption,
                              questionResponses[q.id] === option && styles.questionOptionSelected,
                            ]}
                            onPress={() => setQuestionResponses(prev => ({
                              ...prev,
                              [q.id]: option,
                            }))}
                          >
                            <Text style={[
                              styles.questionOptionText,
                              questionResponses[q.id] === option && styles.questionOptionTextSelected,
                            ]}>
                              {option}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  ))}
                </View>
              )}

              <Text style={styles.peptidesTitle}>Related Peptides</Text>
              <Text style={styles.peptidesSubtitle}>
                Tap to learn more about each peptide
              </Text>

              {relevantPeptides.map(peptide => {
                const education = getPeptideEducation(peptide.id);
                const isExpanded = expandedPeptide === peptide.id;

                return (
                  <View key={peptide.id} style={styles.peptideCard}>
                    <TouchableOpacity
                      style={styles.peptideHeader}
                      onPress={() => setExpandedPeptide(isExpanded ? null : peptide.id)}
                    >
                      <View style={styles.peptideHeaderLeft}>
                        <Syringe color={selectedGoalData.color} size={18} />
                        <Text style={styles.peptideName}>{peptide.name}</Text>
                        {peptide.clinicianOnly && (
                          <View style={styles.rxBadge}>
                            <Text style={styles.rxBadgeText}>Rx</Text>
                          </View>
                        )}
                      </View>
                      <ChevronDown
                        color={Colors.textTertiary}
                        size={18}
                        style={{ transform: [{ rotate: isExpanded ? '180deg' : '0deg' }] }}
                      />
                    </TouchableOpacity>

                    {isExpanded && education && (
                      <View style={styles.peptideContent}>
                        <View style={styles.educationSection}>
                          <Text style={styles.educationLabel}>How It Works</Text>
                          <Text style={styles.educationText}>
                            {education.modernExplanation}
                          </Text>
                        </View>

                        <View style={styles.educationSection}>
                          <Text style={styles.educationLabel}>Key Mechanism</Text>
                          <Text style={styles.educationText}>
                            {education.keyMechanism}
                          </Text>
                        </View>

                        {education.tcmConnection && (
                          <View style={[styles.educationSection, styles.tcmSection]}>
                            <View style={styles.tcmHeader}>
                              <Leaf color="#10B981" size={14} />
                              <Text style={styles.tcmLabel}>TCM Perspective</Text>
                            </View>
                            <Text style={styles.tcmText}>
                              {education.tcmConnection}
                            </Text>
                          </View>
                        )}

                        <View style={styles.educationSection}>
                          <Text style={styles.educationLabel}>Research Context</Text>
                          <Text style={styles.educationText}>
                            {education.researchContext}
                          </Text>
                        </View>

                        {peptide.contraindications.length > 0 && (
                          <View style={styles.warningSection}>
                            <AlertTriangle color="#EF4444" size={14} />
                            <Text style={styles.warningText}>
                              Contraindications: {peptide.contraindications.map(c => c.condition).join(', ')}
                            </Text>
                          </View>
                        )}
                      </View>
                    )}
                  </View>
                );
              })}

              <View style={styles.symptomCorrelations}>
                <Text style={styles.symptomTitle}>Common Symptom Patterns</Text>
                <Text style={styles.symptomSubtitle}>
                  These symptoms are often discussed in relation to this goal:
                </Text>
                <View style={styles.symptomList}>
                  {selectedGoalData.symptomCorrelations.map(symptom => (
                    <View key={symptom} style={styles.symptomChip}>
                      <CheckCircle color={selectedGoalData.color} size={12} />
                      <Text style={styles.symptomText}>{symptom}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </>
          )}
        </View>
      )}

      <View style={styles.disclaimerBanner}>
        <Info color={Colors.textTertiary} size={14} />
        <Text style={styles.disclaimerText}>{SAFETY_DISCLAIMER}</Text>
      </View>

      <Modal visible={showDisclaimer} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.disclaimerModal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Educational Disclaimer</Text>
              <TouchableOpacity onPress={() => setShowDisclaimer(false)}>
                <X color={Colors.text} size={24} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalContent}>
              <View style={styles.disclaimerIcon}>
                <AlertTriangle color="#F59E0B" size={48} />
              </View>
              <Text style={styles.disclaimerModalText}>
                {SAFETY_DISCLAIMER}
                {'\n\n'}
                The peptide information provided here is for educational purposes only and is not intended as medical advice, diagnosis, or treatment recommendations.
                {'\n\n'}
                • Many peptides discussed are research compounds
                {'\n'}
                • Not FDA-approved for the uses discussed
                {'\n'}
                • Individual results may vary significantly
                {'\n'}
                • Always consult a qualified healthcare provider
              </Text>
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.acceptButton}
                onPress={handleAcceptDisclaimer}
              >
                <Text style={styles.acceptButtonText}>I Understand</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    marginBottom: 16,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    gap: 12,
  },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#6366F115',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 2,
  },
  headerSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  goalsContainer: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 4,
  },
  sectionDescription: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 16,
  },
  suggestedSection: {
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  suggestedLabel: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginBottom: 8,
  },
  suggestedGoals: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  suggestedGoalChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    backgroundColor: Colors.surface,
  },
  suggestedGoalText: {
    fontSize: 12,
    fontWeight: '500' as const,
  },
  goalsList: {
    gap: 10,
  },
  goalCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 12,
    padding: 14,
    gap: 12,
  },
  goalIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goalContent: {
    flex: 1,
  },
  goalTitle: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 4,
  },
  goalDescription: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 16,
  },
  educationContainer: {
    padding: 16,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 16,
  },
  backText: {
    fontSize: 14,
    color: Colors.primary,
    fontWeight: '500' as const,
  },
  goalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 20,
    paddingLeft: 12,
    borderLeftWidth: 3,
  },
  goalHeaderIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goalHeaderText: {
    flex: 1,
  },
  goalHeaderTitle: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 6,
  },
  goalHeaderDesc: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  correlationCard: {
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  correlationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  correlationTitle: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#92400E',
  },
  correlationText: {
    fontSize: 12,
    color: '#92400E',
    marginBottom: 10,
  },
  correlationMarkers: {
    gap: 8,
  },
  markerChip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.6)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  markerName: {
    fontSize: 13,
    fontWeight: '500' as const,
    color: '#78350F',
  },
  markerStatus: {
    fontSize: 12,
    fontWeight: '600' as const,
  },
  questionsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: Colors.borderLight,
    marginBottom: 16,
  },
  questionsToggleText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500' as const,
    color: '#6366F1',
  },
  questionsContainer: {
    gap: 12,
    marginBottom: 16,
  },
  questionCard: {
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 12,
    padding: 14,
  },
  questionText: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.text,
    marginBottom: 4,
  },
  questionPurpose: {
    fontSize: 11,
    color: Colors.textTertiary,
    fontStyle: 'italic' as const,
    marginBottom: 12,
  },
  questionOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  questionOption: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  questionOptionSelected: {
    backgroundColor: '#6366F1',
    borderColor: '#6366F1',
  },
  questionOptionText: {
    fontSize: 12,
    color: Colors.text,
  },
  questionOptionTextSelected: {
    color: '#fff',
  },
  peptidesTitle: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 4,
  },
  peptidesSubtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginBottom: 12,
  },
  peptideCard: {
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 12,
    marginBottom: 10,
    overflow: 'hidden',
  },
  peptideHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
  },
  peptideHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  peptideName: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  rxBadge: {
    backgroundColor: '#6366F115',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  rxBadgeText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: '#6366F1',
  },
  peptideContent: {
    padding: 14,
    paddingTop: 0,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  educationSection: {
    marginTop: 12,
  },
  educationLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textTertiary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  educationText: {
    fontSize: 13,
    color: Colors.text,
    lineHeight: 19,
  },
  tcmSection: {
    backgroundColor: '#D1FAE5',
    marginHorizontal: -14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 12,
  },
  tcmHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  tcmLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: '#065F46',
  },
  tcmText: {
    fontSize: 13,
    color: '#065F46',
    lineHeight: 19,
    fontStyle: 'italic' as const,
  },
  warningSection: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 12,
    backgroundColor: '#FEE2E2',
    padding: 10,
    borderRadius: 8,
  },
  warningText: {
    flex: 1,
    fontSize: 12,
    color: '#991B1B',
    lineHeight: 16,
  },
  symptomCorrelations: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  symptomTitle: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 4,
  },
  symptomSubtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginBottom: 12,
  },
  symptomList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  symptomChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.surfaceSecondary,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
  },
  symptomText: {
    fontSize: 12,
    color: Colors.text,
  },
  disclaimerBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 14,
    backgroundColor: Colors.surfaceSecondary,
  },
  disclaimerText: {
    flex: 1,
    fontSize: 11,
    color: Colors.textTertiary,
    lineHeight: 15,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  disclaimerModal: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  modalContent: {
    padding: 20,
  },
  disclaimerIcon: {
    alignItems: 'center',
    marginBottom: 20,
  },
  disclaimerModalText: {
    fontSize: 14,
    color: Colors.text,
    lineHeight: 22,
  },
  modalFooter: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  acceptButton: {
    backgroundColor: '#6366F1',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  acceptButtonText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: '#fff',
  },
});
