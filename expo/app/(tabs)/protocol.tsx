import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  Modal,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Pill,
  Clock,
  Dumbbell,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Flame,
  Snowflake,
  Footprints,
  Sun,
  Brain,
  ClipboardList,
  Syringe,
  Calculator,
  BookOpen,
  AlertTriangle,
  CheckCircle,
  Shield,
  FileText,
  Plus,
  X,
  Info,
  Activity,
} from 'lucide-react-native';

import Colors from '@/constants/colors';
import { useProtocol } from '@/providers/ProtocolProvider';
import { useUser } from '@/providers/UserProvider';
import SupplementsRecommendations from '@/components/SupplementsRecommendations';
import {
  Supplement,
  LifestyleTask,
  PeptideData,
  PeptideGoal,
  DosingGuidance,
  PeptideEvidence,
  PeptideProtocolTemplate,
} from '@/types';
import { PEPTIDE_DISCLAIMER } from '@/mocks/peptides';

const taskIconMap: Record<string, any> = {
  sauna: Flame,
  cold_plunge: Snowflake,
  steps: Footprints,
  workout: Dumbbell,
  sunlight: Sun,
  meditation: Brain,
  custom: Dumbbell,
  sleep_routine: Clock,
};

const FULLSCRIPT_URL = 'https://us.fullscript.com/welcome/drbright/signup';

const GOAL_LABELS: Record<PeptideGoal, string> = {
  fat_loss: 'Fat Loss',
  sleep: 'Sleep',
  recovery: 'Recovery',
  injury_rehab: 'Injury Rehab',
  cognition: 'Cognition',
  longevity: 'Longevity',
  libido: 'Libido',
  metabolic_health: 'Metabolic Health',
  muscle_growth: 'Muscle Growth',
  skin_health: 'Skin Health',
  immune_support: 'Immune Support',
};

type PeptideSubTab = 'recommendations' | 'dosing' | 'research' | 'protocols';

export default function ProtocolScreen() {
  const { 
    activeProtocol, 
    isLoading,
    peptideDatabase,
    peptideAcknowledged,
    getPeptideRecommendations,
    getDosingForPeptide,
    getEvidenceForPeptide,
    getProtocolsForPeptide,
    userPeptidePlans,
    addPeptideToPlan,
    acknowledgePeptideDisclaimer,
  } = useProtocol();
  
  const { userProfile, contraindications } = useUser();
  
  const [expandedSections, setExpandedSections] = useState<string[]>([
    'supplements',
    'peptides',
  ]);
  const [peptideSubTab, setPeptideSubTab] = useState<PeptideSubTab>('recommendations');
  const [selectedPeptide, setSelectedPeptide] = useState<PeptideData | null>(null);
  const [showCalculator, setShowCalculator] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [disclaimerChecked, setDisclaimerChecked] = useState(false);

  const userGoals: PeptideGoal[] = userProfile?.goals?.map((g: string) => {
    const goalMap: Record<string, PeptideGoal> = {
      'weight_loss': 'fat_loss',
      'better_sleep': 'sleep',
      'muscle_gain': 'muscle_growth',
      'energy': 'metabolic_health',
      'longevity': 'longevity',
      'cognitive': 'cognition',
      'recovery': 'recovery',
    };
    return goalMap[g] || g as PeptideGoal;
  }).filter(Boolean) || ['recovery', 'longevity'];

  const userContraindications = [
    ...(contraindications?.conditions || []),
    ...(contraindications?.pregnant ? ['Pregnancy'] : []),
    ...(contraindications?.nursing ? ['Lactation'] : []),
  ];

  const recommendations = getPeptideRecommendations(userGoals, userContraindications);

  const toggleSection = (section: string) => {
    setExpandedSections(prev =>
      prev.includes(section)
        ? prev.filter(s => s !== section)
        : [...prev, section]
    );
  };

  const openLink = useCallback((url: string) => {
    Linking.openURL(url).catch(err => console.log('Error opening link:', err));
  }, []);

  const handlePeptideSelect = (peptide: PeptideData) => {
    if (!peptideAcknowledged) {
      setSelectedPeptide(peptide);
      setShowDisclaimer(true);
    } else {
      setSelectedPeptide(peptide);
    }
  };

  const handleDisclaimerAccept = () => {
    if (disclaimerChecked) {
      acknowledgePeptideDisclaimer();
      setShowDisclaimer(false);
    }
  };

  const handleAddToProtocol = (peptide: PeptideData) => {
    if (peptide.clinicianOnly) {
      Alert.alert(
        'Clinician Review Required',
        'This peptide requires consultation with a healthcare provider before use.',
        [{ text: 'OK' }]
      );
      return;
    }
    
    addPeptideToPlan({
      peptideId: peptide.id,
      startDate: new Date().toISOString(),
      currentPhase: 0,
      notes: '',
      adherenceLogs: [],
      acknowledged: true,
      acknowledgedAt: new Date().toISOString(),
    });
    
    Alert.alert('Added', `${peptide.name} has been added to your protocol.`);
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
        colors={['#1a5f4a', '#2d8a6e']}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={['top']}>
          <View style={styles.header}>
            <ClipboardList color="#fff" size={24} />
            <Text style={styles.headerTitle}>My Protocol</Text>
            <Text style={styles.headerSubtitle}>
              Your personalized health plan
            </Text>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {activeProtocol && (
          <>
            <View style={styles.activeProtocolHeader}>
              <Text style={styles.activeProtocolName}>{activeProtocol.name}</Text>
              <View style={styles.statusBadge}>
                <Text style={styles.statusText}>Active</Text>
              </View>
            </View>
            <Text style={styles.activeProtocolDesc}>{activeProtocol.description}</Text>

            <TouchableOpacity
              style={styles.sectionCard}
              onPress={() => toggleSection('supplements')}
              activeOpacity={0.8}
            >
              <View style={styles.sectionCardHeader}>
                <View style={styles.sectionIconContainer}>
                  <Pill color="#2d8a6e" size={20} />
                </View>
                <View style={styles.sectionTitleContainer}>
                  <Text style={styles.sectionTitle}>Supplements</Text>
                  <Text style={styles.sectionCount}>
                    {activeProtocol.supplements.length} items
                  </Text>
                </View>
                {expandedSections.includes('supplements') ? (
                  <ChevronUp color={Colors.textTertiary} size={20} />
                ) : (
                  <ChevronDown color={Colors.textTertiary} size={20} />
                )}
              </View>

              {expandedSections.includes('supplements') && (
                <View style={styles.sectionContent}>
                  {activeProtocol.supplements.map((supplement) => (
                    <SupplementCard key={supplement.id} supplement={supplement} />
                  ))}
                </View>
              )}
            </TouchableOpacity>

            {activeProtocol.lifestyleTasks.length > 0 && (
              <TouchableOpacity
                style={styles.sectionCard}
                onPress={() => toggleSection('tasks')}
                activeOpacity={0.8}
              >
                <View style={styles.sectionCardHeader}>
                  <View style={[styles.sectionIconContainer, { backgroundColor: '#e8f5e9' }]}>
                    <Dumbbell color="#4caf50" size={20} />
                  </View>
                  <View style={styles.sectionTitleContainer}>
                    <Text style={styles.sectionTitle}>Lifestyle Tasks</Text>
                    <Text style={styles.sectionCount}>
                      {activeProtocol.lifestyleTasks.length} items
                    </Text>
                  </View>
                  {expandedSections.includes('tasks') ? (
                    <ChevronUp color={Colors.textTertiary} size={20} />
                  ) : (
                    <ChevronDown color={Colors.textTertiary} size={20} />
                  )}
                </View>

                {expandedSections.includes('tasks') && (
                  <View style={styles.sectionContent}>
                    {activeProtocol.lifestyleTasks.map((task) => (
                      <TaskCard key={task.id} task={task} />
                    ))}
                  </View>
                )}
              </TouchableOpacity>
            )}
          </>
        )}

        <SupplementsRecommendations patientId={userProfile?.id} />

        <View style={styles.peptideSectionCard}>
          <TouchableOpacity
            style={styles.peptideHeader}
            onPress={() => toggleSection('peptides')}
            activeOpacity={0.8}
          >
            <View style={styles.peptideHeaderLeft}>
              <View style={[styles.sectionIconContainer, { backgroundColor: '#fef3e2' }]}>
                <Syringe color="#e67e22" size={20} />
              </View>
              <View style={styles.sectionTitleContainer}>
                <Text style={styles.sectionTitle}>Peptides</Text>
                <Text style={styles.sectionCount}>
                  {userPeptidePlans.length} in your plan
                </Text>
              </View>
            </View>
            <View style={styles.peptideHeaderRight}>
              <TouchableOpacity
                style={styles.calculatorButton}
                onPress={() => setShowCalculator(true)}
              >
                <Calculator color="#e67e22" size={18} />
              </TouchableOpacity>
              {expandedSections.includes('peptides') ? (
                <ChevronUp color={Colors.textTertiary} size={20} />
              ) : (
                <ChevronDown color={Colors.textTertiary} size={20} />
              )}
            </View>
          </TouchableOpacity>

          {expandedSections.includes('peptides') && (
            <View style={styles.peptideContent}>
              <View style={styles.subTabContainer}>
                {(['recommendations', 'dosing', 'research', 'protocols'] as PeptideSubTab[]).map((tab) => (
                  <TouchableOpacity
                    key={tab}
                    style={[
                      styles.subTab,
                      peptideSubTab === tab && styles.subTabActive,
                    ]}
                    onPress={() => setPeptideSubTab(tab)}
                  >
                    <Text style={[
                      styles.subTabText,
                      peptideSubTab === tab && styles.subTabTextActive,
                    ]}>
                      {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {peptideSubTab === 'recommendations' && (
                <PeptideRecommendationsTab
                  recommendations={recommendations}
                  onSelect={handlePeptideSelect}
                  onAdd={handleAddToProtocol}
                  selectedPeptide={selectedPeptide}
                />
              )}

              {peptideSubTab === 'dosing' && (
                <PeptideDosingTab
                  peptideDatabase={peptideDatabase}
                  getDosingForPeptide={getDosingForPeptide}
                  peptideAcknowledged={peptideAcknowledged}
                  onRequestAcknowledge={() => setShowDisclaimer(true)}
                />
              )}

              {peptideSubTab === 'research' && (
                <PeptideResearchTab
                  peptideDatabase={peptideDatabase}
                  getEvidenceForPeptide={getEvidenceForPeptide}
                />
              )}

              {peptideSubTab === 'protocols' && (
                <PeptideProtocolsTab
                  peptideDatabase={peptideDatabase}
                  getProtocolsForPeptide={getProtocolsForPeptide}
                />
              )}
            </View>
          )}
        </View>

        <View style={styles.fullscriptBanner}>
          <View style={styles.fullscriptContent}>
            <Text style={styles.fullscriptTitle}>Shop Supplements</Text>
            <Text style={styles.fullscriptText}>
              Get practitioner pricing on Fullscript
            </Text>
          </View>
          <TouchableOpacity 
            style={styles.fullscriptButton}
            onPress={() => openLink(FULLSCRIPT_URL)}
          >
            <Text style={styles.fullscriptButtonText}>Shop</Text>
            <ExternalLink size={14} color="#fff" />
          </TouchableOpacity>
        </View>
      </ScrollView>

      <PeptideCalculatorModal
        visible={showCalculator}
        onClose={() => setShowCalculator(false)}
        peptideDatabase={peptideDatabase}
        getDosingForPeptide={getDosingForPeptide}
      />

      <DisclaimerModal
        visible={showDisclaimer}
        checked={disclaimerChecked}
        onCheckChange={setDisclaimerChecked}
        onAccept={handleDisclaimerAccept}
        onClose={() => setShowDisclaimer(false)}
      />
    </View>
  );
}

function PeptideRecommendationsTab({
  recommendations,
  onSelect,
  onAdd,
  selectedPeptide,
}: {
  recommendations: ReturnType<ReturnType<typeof useProtocol>['getPeptideRecommendations']>;
  onSelect: (p: PeptideData) => void;
  onAdd: (p: PeptideData) => void;
  selectedPeptide: PeptideData | null;
}) {
  if (recommendations.length === 0) {
    return (
      <View style={styles.emptyTab}>
        <Info color={Colors.textTertiary} size={32} />
        <Text style={styles.emptyTabText}>
          Complete your profile to get personalized peptide recommendations.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.tabContent}>
      <Text style={styles.tabDescription}>
        Top matches based on your goals
      </Text>
      {recommendations.slice(0, 5).map((rec) => (
        <TouchableOpacity
          key={rec.peptide.id}
          style={[
            styles.recommendationCard,
            selectedPeptide?.id === rec.peptide.id && styles.recommendationCardSelected,
            rec.hasContraindications && styles.recommendationCardWarning,
          ]}
          onPress={() => onSelect(rec.peptide)}
        >
          <View style={styles.recCardHeader}>
            <Text style={styles.recPeptideName}>{rec.peptide.name}</Text>
            <View style={styles.recMatchBadge}>
              <Text style={styles.recMatchText}>
                {Math.round(rec.matchScore * 100)}% match
              </Text>
            </View>
          </View>
          
          <Text style={styles.recMechanism} numberOfLines={2}>
            {rec.peptide.mechanism}
          </Text>
          
          <View style={styles.recGoalsRow}>
            {rec.matchedGoals.slice(0, 3).map((goal) => (
              <View key={goal} style={styles.goalChip}>
                <Text style={styles.goalChipText}>{GOAL_LABELS[goal]}</Text>
              </View>
            ))}
          </View>

          {rec.hasContraindications && (
            <View style={styles.warningBanner}>
              <AlertTriangle color="#d32f2f" size={14} />
              <Text style={styles.warningText}>
                Potential contraindication: {rec.contraindicationNotes}
              </Text>
            </View>
          )}

          {rec.peptide.clinicianOnly && (
            <View style={styles.clinicianBanner}>
              <Shield color="#1976d2" size={14} />
              <Text style={styles.clinicianText}>Requires clinician review</Text>
            </View>
          )}

          <TouchableOpacity
            style={[
              styles.addButton,
              rec.hasContraindications && styles.addButtonDisabled,
            ]}
            onPress={() => !rec.hasContraindications && onAdd(rec.peptide)}
            disabled={rec.hasContraindications}
          >
            <Plus color="#fff" size={16} />
            <Text style={styles.addButtonText}>Add to Protocol</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function PeptideDosingTab({
  peptideDatabase,
  getDosingForPeptide,
  peptideAcknowledged,
  onRequestAcknowledge,
}: {
  peptideDatabase: PeptideData[];
  getDosingForPeptide: (id: string) => DosingGuidance[];
  peptideAcknowledged: boolean;
  onRequestAcknowledge: () => void;
}) {
  const [expandedPeptide, setExpandedPeptide] = useState<string | null>(null);

  if (!peptideAcknowledged) {
    return (
      <View style={styles.lockedTab}>
        <Shield color={Colors.textTertiary} size={40} />
        <Text style={styles.lockedTitle}>Acknowledgment Required</Text>
        <Text style={styles.lockedText}>
          Please review and accept the medical disclaimer to view dosing guidance.
        </Text>
        <TouchableOpacity style={styles.acknowledgeButton} onPress={onRequestAcknowledge}>
          <Text style={styles.acknowledgeButtonText}>Review Disclaimer</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.tabContent}>
      <View style={styles.dosingWarning}>
        <AlertTriangle color="#e67e22" size={16} />
        <Text style={styles.dosingWarningText}>
          Educational only. Consult healthcare provider before use.
        </Text>
      </View>

      {peptideDatabase.map((peptide) => {
        const dosing = getDosingForPeptide(peptide.id);
        if (dosing.length === 0) return null;

        return (
          <View key={peptide.id} style={styles.dosingCard}>
            <TouchableOpacity
              style={styles.dosingCardHeader}
              onPress={() => setExpandedPeptide(
                expandedPeptide === peptide.id ? null : peptide.id
              )}
            >
              <Text style={styles.dosingPeptideName}>{peptide.name}</Text>
              {expandedPeptide === peptide.id ? (
                <ChevronUp color={Colors.textTertiary} size={18} />
              ) : (
                <ChevronDown color={Colors.textTertiary} size={18} />
              )}
            </TouchableOpacity>

            {expandedPeptide === peptide.id && (
              <View style={styles.dosingDetails}>
                {dosing.map((d) => (
                  <View key={d.id} style={styles.dosingRouteCard}>
                    <View style={styles.dosingRouteHeader}>
                      <Text style={styles.dosingRoute}>
                        {d.route.charAt(0).toUpperCase() + d.route.slice(1)}
                      </Text>
                      {d.clinicianOnly && (
                        <View style={styles.clinicianBadge}>
                          <Shield color="#1976d2" size={12} />
                          <Text style={styles.clinicianBadgeText}>Rx</Text>
                        </View>
                      )}
                    </View>

                    <View style={styles.dosingTable}>
                      <View style={styles.dosingRow}>
                        <Text style={styles.dosingLabel}>Dose Range:</Text>
                        <Text style={styles.dosingValue}>
                          {d.doseMin} - {d.doseMax} {d.unit}
                        </Text>
                      </View>
                      <View style={styles.dosingRow}>
                        <Text style={styles.dosingLabel}>Frequency:</Text>
                        <Text style={styles.dosingValue}>
                          {d.frequencyOptions.join(' or ')}
                        </Text>
                      </View>
                      <View style={styles.dosingRow}>
                        <Text style={styles.dosingLabel}>Duration:</Text>
                        <Text style={styles.dosingValue}>
                          {d.durationWeeksMin} - {d.durationWeeksMax} weeks
                        </Text>
                      </View>
                    </View>

                    {d.notes && (
                      <Text style={styles.dosingNotes}>{d.notes}</Text>
                    )}

                    <Text style={styles.lastReviewed}>
                      Last reviewed: {d.lastReviewed}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

function PeptideResearchTab({
  peptideDatabase,
  getEvidenceForPeptide,
}: {
  peptideDatabase: PeptideData[];
  getEvidenceForPeptide: (id: string) => PeptideEvidence[];
}) {
  const [expandedPeptide, setExpandedPeptide] = useState<string | null>(null);

  const gradeColors: Record<string, string> = {
    A: '#4caf50',
    B: '#8bc34a',
    C: '#ffc107',
    D: '#ff9800',
  };

  return (
    <View style={styles.tabContent}>
      <Text style={styles.tabDescription}>
        Research summaries with evidence grades
      </Text>

      {peptideDatabase.map((peptide) => {
        const evidence = getEvidenceForPeptide(peptide.id);
        if (evidence.length === 0) return null;

        return (
          <View key={peptide.id} style={styles.researchCard}>
            <TouchableOpacity
              style={styles.researchCardHeader}
              onPress={() => setExpandedPeptide(
                expandedPeptide === peptide.id ? null : peptide.id
              )}
            >
              <View style={styles.researchHeaderLeft}>
                <BookOpen color="#2d8a6e" size={18} />
                <Text style={styles.researchPeptideName}>{peptide.name}</Text>
              </View>
              <View style={styles.researchHeaderRight}>
                <Text style={styles.evidenceCount}>
                  {evidence.length} studies
                </Text>
                {expandedPeptide === peptide.id ? (
                  <ChevronUp color={Colors.textTertiary} size={18} />
                ) : (
                  <ChevronDown color={Colors.textTertiary} size={18} />
                )}
              </View>
            </TouchableOpacity>

            {expandedPeptide === peptide.id && (
              <View style={styles.evidenceList}>
                {evidence.map((e) => (
                  <View key={e.id} style={styles.evidenceCard}>
                    <View style={styles.evidenceHeader}>
                      <View style={[
                        styles.gradeBadge,
                        { backgroundColor: gradeColors[e.strengthGrade] + '20' },
                      ]}>
                        <Text style={[
                          styles.gradeText,
                          { color: gradeColors[e.strengthGrade] },
                        ]}>
                          Grade {e.strengthGrade}
                        </Text>
                      </View>
                      <Text style={styles.studyType}>{e.studyType.replace('_', ' ')}</Text>
                    </View>

                    <Text style={styles.evidenceClaim}>{e.claim}</Text>
                    <Text style={styles.evidenceSummary}>{e.summary}</Text>
                    <Text style={styles.evidencePopulation}>
                      Population: {e.population}
                    </Text>

                    {(e.pmid || e.doi) && (
                      <View style={styles.citationRow}>
                        <FileText color={Colors.textTertiary} size={14} />
                        <Text style={styles.citationText}>
                          {e.pmid && `PMID: ${e.pmid}`}
                          {e.pmid && e.doi && ' | '}
                          {e.doi && `DOI: ${e.doi}`}
                        </Text>
                      </View>
                    )}

                    <Text style={styles.lastReviewed}>
                      Reviewed: {e.lastReviewed}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

function PeptideProtocolsTab({
  peptideDatabase,
  getProtocolsForPeptide,
}: {
  peptideDatabase: PeptideData[];
  getProtocolsForPeptide: (id: string) => PeptideProtocolTemplate[];
}) {
  const allProtocols = peptideDatabase.flatMap(p => getProtocolsForPeptide(p.id));
  const uniqueProtocols = allProtocols.filter(
    (p, i, arr) => arr.findIndex(x => x.id === p.id) === i
  );

  return (
    <View style={styles.tabContent}>
      <Text style={styles.tabDescription}>
        Structured protocols with phases and monitoring
      </Text>

      {uniqueProtocols.map((protocol) => (
        <View key={protocol.id} style={styles.protocolCard}>
          <View style={styles.protocolHeader}>
            <Text style={styles.protocolName}>{protocol.name}</Text>
            {protocol.clinicianOnly && (
              <View style={styles.clinicianBadge}>
                <Shield color="#1976d2" size={12} />
                <Text style={styles.clinicianBadgeText}>Rx</Text>
              </View>
            )}
          </View>

          <Text style={styles.protocolDesc}>{protocol.description}</Text>

          <View style={styles.protocolMeta}>
            <View style={styles.metaItem}>
              <Clock color={Colors.textTertiary} size={14} />
              <Text style={styles.metaText}>{protocol.totalWeeks} weeks</Text>
            </View>
            <View style={styles.metaItem}>
              <Activity color={Colors.textTertiary} size={14} />
              <Text style={styles.metaText}>{protocol.phases.length} phases</Text>
            </View>
          </View>

          <Text style={styles.phasesTitle}>Protocol Phases</Text>
          {protocol.phases.map((phase, idx) => (
            <View key={phase.id} style={styles.phaseCard}>
              <View style={styles.phaseHeader}>
                <View style={styles.phaseNumber}>
                  <Text style={styles.phaseNumberText}>{idx + 1}</Text>
                </View>
                <View style={styles.phaseInfo}>
                  <Text style={styles.phaseName}>{phase.name}</Text>
                  <Text style={styles.phaseWeeks}>
                    Week {phase.weekStart} - {phase.weekEnd}
                  </Text>
                </View>
              </View>
              <Text style={styles.phaseDose}>{phase.dose}</Text>
              <Text style={styles.phaseFreq}>{phase.frequency}</Text>
              {phase.notes && (
                <Text style={styles.phaseNotes}>{phase.notes}</Text>
              )}
            </View>
          ))}

          <Text style={styles.monitoringTitle}>Monitoring Checklist</Text>
          {protocol.monitoringChecklist.map((item, idx) => (
            <View key={idx} style={styles.checklistItem}>
              <CheckCircle color="#4caf50" size={16} />
              <Text style={styles.checklistText}>{item}</Text>
            </View>
          ))}

          {protocol.labsToMonitor.length > 0 && (
            <>
              <Text style={styles.labsTitle}>Labs to Monitor</Text>
              <View style={styles.labsRow}>
                {protocol.labsToMonitor.map((lab, idx) => (
                  <View key={idx} style={styles.labChip}>
                    <Text style={styles.labChipText}>{lab}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          <Text style={styles.stopTitle}>Stop Criteria</Text>
          {protocol.stopCriteria.map((item, idx) => (
            <View key={idx} style={styles.stopItem}>
              <AlertTriangle color="#d32f2f" size={14} />
              <Text style={styles.stopText}>{item}</Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function PeptideCalculatorModal({
  visible,
  onClose,
  peptideDatabase,
  getDosingForPeptide,
}: {
  visible: boolean;
  onClose: () => void;
  peptideDatabase: PeptideData[];
  getDosingForPeptide: (id: string) => DosingGuidance[];
}) {
  const [selectedPeptideId, setSelectedPeptideId] = useState<string>('');
  const [vialMg, setVialMg] = useState('5');
  const [waterMl, setWaterMl] = useState('2');
  const [desiredDose, setDesiredDose] = useState('250');
  const [doseUnit, setDoseUnit] = useState<'mcg' | 'mg'>('mcg');
  const [syringeUnits, setSyringeUnits] = useState('100');

  const calculateDose = () => {
    const vial = parseFloat(vialMg) || 0;
    const water = parseFloat(waterMl) || 0;
    const dose = parseFloat(desiredDose) || 0;
    const syringe = parseFloat(syringeUnits) || 100;

    if (vial === 0 || water === 0) {
      return { drawMl: 0, syringeUnits: 0, warning: null };
    }

    const concentrationMcgPerMl = (vial * 1000) / water;
    const doseInMcg = doseUnit === 'mg' ? dose * 1000 : dose;
    const drawMl = doseInMcg / concentrationMcgPerMl;
    const drawUnits = (drawMl / 1) * syringe;

    let warning = null;
    if (selectedPeptideId) {
      const dosing = getDosingForPeptide(selectedPeptideId);
      const guidance = dosing.find(d => d.unit === doseUnit || 
        (d.unit === 'mcg' && doseUnit === 'mcg') ||
        (d.unit === 'mg' && doseUnit === 'mg')
      );
      if (guidance) {
        const compareValue = doseUnit === 'mcg' ? dose : dose * 1000;
        const minCompare = guidance.unit === 'mcg' ? guidance.doseMin : guidance.doseMin * 1000;
        const maxCompare = guidance.unit === 'mcg' ? guidance.doseMax : guidance.doseMax * 1000;
        
        if (compareValue < minCompare) {
          warning = 'Dose is below typical range';
        } else if (compareValue > maxCompare) {
          warning = 'Dose exceeds typical range - verify with provider';
        }
      }
    }

    return { drawMl, syringeUnits: drawUnits, warning };
  };

  const result = calculateDose();

  const reset = () => {
    setSelectedPeptideId('');
    setVialMg('5');
    setWaterMl('2');
    setDesiredDose('250');
    setDoseUnit('mcg');
    setSyringeUnits('100');
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.calculatorModal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Peptide Calculator</Text>
            <TouchableOpacity onPress={onClose}>
              <X color={Colors.text} size={24} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.calculatorContent}>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Peptide (optional)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.peptideChips}>
                  <TouchableOpacity
                    style={[
                      styles.peptideChip,
                      !selectedPeptideId && styles.peptideChipActive,
                    ]}
                    onPress={() => setSelectedPeptideId('')}
                  >
                    <Text style={[
                      styles.peptideChipText,
                      !selectedPeptideId && styles.peptideChipTextActive,
                    ]}>None</Text>
                  </TouchableOpacity>
                  {peptideDatabase.slice(0, 5).map((p) => (
                    <TouchableOpacity
                      key={p.id}
                      style={[
                        styles.peptideChip,
                        selectedPeptideId === p.id && styles.peptideChipActive,
                      ]}
                      onPress={() => setSelectedPeptideId(p.id)}
                    >
                      <Text style={[
                        styles.peptideChipText,
                        selectedPeptideId === p.id && styles.peptideChipTextActive,
                      ]}>{p.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>

            <View style={styles.inputRow}>
              <View style={styles.inputHalf}>
                <Text style={styles.inputLabel}>Vial (mg)</Text>
                <View style={styles.inputField}>
                  <TouchableOpacity
                    style={styles.inputButton}
                    onPress={() => setVialMg(String(Math.max(0, parseFloat(vialMg) - 1)))}
                  >
                    <Text style={styles.inputButtonText}>-</Text>
                  </TouchableOpacity>
                  <Text style={styles.inputValue}>{vialMg}</Text>
                  <TouchableOpacity
                    style={styles.inputButton}
                    onPress={() => setVialMg(String(parseFloat(vialMg) + 1))}
                  >
                    <Text style={styles.inputButtonText}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <View style={styles.inputHalf}>
                <Text style={styles.inputLabel}>BAC Water (mL)</Text>
                <View style={styles.inputField}>
                  <TouchableOpacity
                    style={styles.inputButton}
                    onPress={() => setWaterMl(String(Math.max(0.5, parseFloat(waterMl) - 0.5)))}
                  >
                    <Text style={styles.inputButtonText}>-</Text>
                  </TouchableOpacity>
                  <Text style={styles.inputValue}>{waterMl}</Text>
                  <TouchableOpacity
                    style={styles.inputButton}
                    onPress={() => setWaterMl(String(parseFloat(waterMl) + 0.5))}
                  >
                    <Text style={styles.inputButtonText}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            <View style={styles.inputRow}>
              <View style={styles.inputHalf}>
                <Text style={styles.inputLabel}>Desired Dose</Text>
                <View style={styles.inputField}>
                  <TouchableOpacity
                    style={styles.inputButton}
                    onPress={() => setDesiredDose(String(Math.max(0, parseFloat(desiredDose) - (doseUnit === 'mcg' ? 50 : 0.5))))}
                  >
                    <Text style={styles.inputButtonText}>-</Text>
                  </TouchableOpacity>
                  <Text style={styles.inputValue}>{desiredDose}</Text>
                  <TouchableOpacity
                    style={styles.inputButton}
                    onPress={() => setDesiredDose(String(parseFloat(desiredDose) + (doseUnit === 'mcg' ? 50 : 0.5)))}
                  >
                    <Text style={styles.inputButtonText}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <View style={styles.inputHalf}>
                <Text style={styles.inputLabel}>Unit</Text>
                <View style={styles.unitToggle}>
                  <TouchableOpacity
                    style={[styles.unitOption, doseUnit === 'mcg' && styles.unitOptionActive]}
                    onPress={() => setDoseUnit('mcg')}
                  >
                    <Text style={[styles.unitText, doseUnit === 'mcg' && styles.unitTextActive]}>mcg</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.unitOption, doseUnit === 'mg' && styles.unitOptionActive]}
                    onPress={() => setDoseUnit('mg')}
                  >
                    <Text style={[styles.unitText, doseUnit === 'mg' && styles.unitTextActive]}>mg</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Syringe Total Units</Text>
              <View style={styles.syringeOptions}>
                {['30', '50', '100'].map((val) => (
                  <TouchableOpacity
                    key={val}
                    style={[
                      styles.syringeOption,
                      syringeUnits === val && styles.syringeOptionActive,
                    ]}
                    onPress={() => setSyringeUnits(val)}
                  >
                    <Text style={[
                      styles.syringeText,
                      syringeUnits === val && styles.syringeTextActive,
                    ]}>{val} IU</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.resultCard}>
              <Text style={styles.resultTitle}>Draw Amount</Text>
              <View style={styles.resultRow}>
                <View style={styles.resultItem}>
                  <Text style={styles.resultValue}>
                    {result.drawMl.toFixed(3)}
                  </Text>
                  <Text style={styles.resultUnit}>mL</Text>
                </View>
                <View style={styles.resultDivider} />
                <View style={styles.resultItem}>
                  <Text style={styles.resultValue}>
                    {result.syringeUnits.toFixed(1)}
                  </Text>
                  <Text style={styles.resultUnit}>units</Text>
                </View>
              </View>
              
              {result.warning && (
                <View style={styles.resultWarning}>
                  <AlertTriangle color="#e67e22" size={16} />
                  <Text style={styles.resultWarningText}>{result.warning}</Text>
                </View>
              )}
            </View>

            <View style={styles.conversionCard}>
              <Text style={styles.conversionTitle}>Quick Conversions</Text>
              <Text style={styles.conversionText}>
                1 mg = 1,000 mcg
              </Text>
              <Text style={styles.conversionText}>
                Concentration: {((parseFloat(vialMg) || 0) * 1000 / (parseFloat(waterMl) || 1)).toFixed(0)} mcg/mL
              </Text>
            </View>

            <TouchableOpacity style={styles.resetButton} onPress={reset}>
              <Text style={styles.resetButtonText}>Reset</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function DisclaimerModal({
  visible,
  checked,
  onCheckChange,
  onAccept,
  onClose,
}: {
  visible: boolean;
  checked: boolean;
  onCheckChange: (v: boolean) => void;
  onAccept: () => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.disclaimerModal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Medical Disclaimer</Text>
            <TouchableOpacity onPress={onClose}>
              <X color={Colors.text} size={24} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.disclaimerContent}>
            <View style={styles.disclaimerIcon}>
              <AlertTriangle color="#e67e22" size={48} />
            </View>
            <Text style={styles.disclaimerText}>{PEPTIDE_DISCLAIMER}</Text>
          </ScrollView>

          <View style={styles.disclaimerFooter}>
            <TouchableOpacity
              style={styles.checkboxRow}
              onPress={() => onCheckChange(!checked)}
            >
              <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                {checked && <CheckCircle color="#fff" size={16} />}
              </View>
              <Text style={styles.checkboxLabel}>
                I understand and acknowledge this disclaimer
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.acceptButton, !checked && styles.acceptButtonDisabled]}
              onPress={onAccept}
              disabled={!checked}
            >
              <Text style={styles.acceptButtonText}>Continue</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function SupplementCard({ supplement }: { supplement: Supplement }) {
  return (
    <View style={styles.itemCard}>
      <View style={styles.itemHeader}>
        <Text style={styles.itemName}>{supplement.name}</Text>
        {supplement.orderingLink && (
          <TouchableOpacity onPress={() => Linking.openURL(supplement.orderingLink!)}>
            <ExternalLink color="#2d8a6e" size={16} />
          </TouchableOpacity>
        )}
      </View>
      {supplement.brand && (
        <Text style={styles.itemBrand}>{supplement.brand}</Text>
      )}
      <View style={styles.itemDetails}>
        <View style={styles.detailChip}>
          <Text style={styles.detailChipText}>{supplement.dose}</Text>
        </View>
        <View style={styles.detailChip}>
          <Text style={styles.detailChipText}>{supplement.frequency}</Text>
        </View>
        <View style={[styles.detailChip, styles.timingChip]}>
          <Text style={styles.timingText}>{supplement.timing.replace('_', ' ')}</Text>
        </View>
      </View>
      {supplement.notes && (
        <Text style={styles.itemNotes}>{supplement.notes}</Text>
      )}
    </View>
  );
}

function TaskCard({ task }: { task: LifestyleTask }) {
  const TaskIcon = taskIconMap[task.type] || Dumbbell;

  return (
    <View style={styles.itemCard}>
      <View style={styles.taskHeader}>
        <TaskIcon color="#4caf50" size={18} />
        <Text style={styles.itemName}>{task.name}</Text>
      </View>
      <View style={styles.itemDetails}>
        {task.target && (
          <View style={styles.detailChip}>
            <Text style={styles.detailChipText}>
              {task.target} {task.unit}
            </Text>
          </View>
        )}
        <View style={styles.detailChip}>
          <Text style={styles.detailChipText}>{task.frequency}</Text>
        </View>
        {task.timing && (
          <View style={[styles.detailChip, styles.timingChip]}>
            <Text style={styles.timingText}>{task.timing}</Text>
          </View>
        )}
      </View>
      {task.notes && (
        <Text style={styles.itemNotes}>{task.notes}</Text>
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
    color: 'rgba(255,255,255,0.85)',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 120,
  },
  activeProtocolHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  activeProtocolName: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  statusBadge: {
    backgroundColor: '#4caf50',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: '#fff',
  },
  activeProtocolDesc: {
    fontSize: 15,
    color: Colors.textSecondary,
    marginBottom: 24,
    lineHeight: 22,
  },
  sectionCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    marginBottom: 16,
    overflow: 'hidden',
  },
  sectionCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 18,
  },
  sectionIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#e8f5f1',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  sectionTitleContainer: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  sectionCount: {
    fontSize: 13,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  sectionContent: {
    paddingHorizontal: 18,
    paddingBottom: 18,
  },
  itemCard: {
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemName: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 4,
  },
  itemBrand: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 10,
  },
  itemDetails: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  detailChip: {
    backgroundColor: Colors.surface,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  detailChipText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500' as const,
  },
  timingChip: {
    backgroundColor: '#e8f5f1',
  },
  timingText: {
    fontSize: 12,
    color: '#2d8a6e',
    fontWeight: '500' as const,
    textTransform: 'capitalize' as const,
  },
  itemNotes: {
    fontSize: 13,
    color: Colors.textTertiary,
    marginTop: 12,
    fontStyle: 'italic' as const,
    lineHeight: 18,
  },
  taskHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  peptideSectionCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    marginBottom: 16,
    overflow: 'hidden',
  },
  peptideHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 18,
  },
  peptideHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  peptideHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  calculatorButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#fef3e2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  peptideContent: {
    paddingBottom: 18,
  },
  subTabContainer: {
    flexDirection: 'row',
    paddingHorizontal: 18,
    marginBottom: 16,
    gap: 8,
  },
  subTab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.surfaceSecondary,
  },
  subTabActive: {
    backgroundColor: '#e67e22',
  },
  subTabText: {
    fontSize: 13,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
  },
  subTabTextActive: {
    color: '#fff',
  },
  tabContent: {
    paddingHorizontal: 18,
  },
  tabDescription: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 16,
  },
  emptyTab: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  emptyTabText: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 12,
  },
  recommendationCard: {
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  recommendationCardSelected: {
    borderColor: '#e67e22',
  },
  recommendationCardWarning: {
    borderColor: '#ffcdd2',
    backgroundColor: '#fff8f8',
  },
  recCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  recPeptideName: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  recMatchBadge: {
    backgroundColor: '#e8f5e9',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  recMatchText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: '#4caf50',
  },
  recMechanism: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 19,
    marginBottom: 12,
  },
  recGoalsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  goalChip: {
    backgroundColor: '#fef3e2',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  goalChipText: {
    fontSize: 11,
    fontWeight: '500' as const,
    color: '#e67e22',
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ffebee',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  warningText: {
    fontSize: 12,
    color: '#d32f2f',
    flex: 1,
  },
  clinicianBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#e3f2fd',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  clinicianText: {
    fontSize: 12,
    color: '#1976d2',
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#e67e22',
    paddingVertical: 10,
    borderRadius: 10,
  },
  addButtonDisabled: {
    backgroundColor: Colors.textTertiary,
  },
  addButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#fff',
  },
  lockedTab: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  lockedTitle: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: Colors.text,
    marginTop: 16,
    marginBottom: 8,
  },
  lockedText: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: 20,
  },
  acknowledgeButton: {
    backgroundColor: '#e67e22',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  acknowledgeButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#fff',
  },
  dosingWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fef3e2',
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
  },
  dosingWarningText: {
    fontSize: 13,
    color: '#e67e22',
    flex: 1,
  },
  dosingCard: {
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 12,
    marginBottom: 12,
    overflow: 'hidden',
  },
  dosingCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
  },
  dosingPeptideName: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  dosingDetails: {
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  dosingRouteCard: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
  },
  dosingRouteHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  dosingRoute: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#2d8a6e',
  },
  clinicianBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#e3f2fd',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  clinicianBadgeText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: '#1976d2',
  },
  dosingTable: {
    gap: 8,
  },
  dosingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  dosingLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  dosingValue: {
    fontSize: 13,
    fontWeight: '500' as const,
    color: Colors.text,
    textAlign: 'right',
    flex: 1,
    marginLeft: 12,
  },
  dosingNotes: {
    fontSize: 12,
    color: Colors.textTertiary,
    fontStyle: 'italic' as const,
    marginTop: 12,
    lineHeight: 18,
  },
  lastReviewed: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 10,
  },
  researchCard: {
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 12,
    marginBottom: 12,
    overflow: 'hidden',
  },
  researchCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
  },
  researchHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  researchPeptideName: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  researchHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  evidenceCount: {
    fontSize: 12,
    color: Colors.textTertiary,
  },
  evidenceList: {
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  evidenceCard: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
  },
  evidenceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  gradeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  gradeText: {
    fontSize: 12,
    fontWeight: '600' as const,
  },
  studyType: {
    fontSize: 12,
    color: Colors.textSecondary,
    textTransform: 'capitalize' as const,
  },
  evidenceClaim: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 6,
  },
  evidenceSummary: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 19,
    marginBottom: 8,
  },
  evidencePopulation: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginBottom: 8,
  },
  citationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  citationText: {
    fontSize: 11,
    color: Colors.textTertiary,
  },
  protocolCard: {
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  protocolHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  protocolName: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
    flex: 1,
  },
  protocolDesc: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 19,
    marginBottom: 12,
  },
  protocolMeta: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 16,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaText: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  phasesTitle: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 12,
  },
  phaseCard: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
  },
  phaseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  phaseNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#e67e22',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  phaseNumberText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#fff',
  },
  phaseInfo: {
    flex: 1,
  },
  phaseName: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  phaseWeeks: {
    fontSize: 12,
    color: Colors.textTertiary,
  },
  phaseDose: {
    fontSize: 13,
    color: Colors.text,
    marginBottom: 4,
  },
  phaseFreq: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  phaseNotes: {
    fontSize: 12,
    color: Colors.textTertiary,
    fontStyle: 'italic' as const,
    marginTop: 8,
  },
  monitoringTitle: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
    marginTop: 16,
    marginBottom: 10,
  },
  checklistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  checklistText: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  labsTitle: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
    marginTop: 16,
    marginBottom: 10,
  },
  labsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  labChip: {
    backgroundColor: '#e3f2fd',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  labChipText: {
    fontSize: 12,
    color: '#1976d2',
    fontWeight: '500' as const,
  },
  stopTitle: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
    marginTop: 16,
    marginBottom: 10,
  },
  stopItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  stopText: {
    fontSize: 13,
    color: '#d32f2f',
  },
  fullscriptBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a5f4a',
    borderRadius: 16,
    padding: 18,
    marginTop: 8,
  },
  fullscriptContent: {
    flex: 1,
  },
  fullscriptTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: '#fff',
    marginBottom: 4,
  },
  fullscriptText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.8)',
  },
  fullscriptButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  fullscriptButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#fff',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  calculatorModal: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  calculatorContent: {
    padding: 20,
  },
  inputGroup: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
    marginBottom: 10,
  },
  peptideChips: {
    flexDirection: 'row',
    gap: 8,
  },
  peptideChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  peptideChipActive: {
    backgroundColor: '#e67e22',
    borderColor: '#e67e22',
  },
  peptideChipText: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  peptideChipTextActive: {
    color: '#fff',
  },
  inputRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 20,
  },
  inputHalf: {
    flex: 1,
  },
  inputField: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    overflow: 'hidden',
  },
  inputButton: {
    width: 44,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceSecondary,
  },
  inputButtonText: {
    fontSize: 20,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  inputValue: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  unitToggle: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    overflow: 'hidden',
  },
  unitOption: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
  },
  unitOptionActive: {
    backgroundColor: '#e67e22',
  },
  unitText: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
  },
  unitTextActive: {
    color: '#fff',
  },
  syringeOptions: {
    flexDirection: 'row',
    gap: 12,
  },
  syringeOption: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  syringeOptionActive: {
    backgroundColor: '#e67e22',
    borderColor: '#e67e22',
  },
  syringeText: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
  },
  syringeTextActive: {
    color: '#fff',
  },
  resultCard: {
    backgroundColor: '#fef3e2',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    alignItems: 'center',
  },
  resultTitle: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: '#e67e22',
    marginBottom: 16,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  resultItem: {
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  resultValue: {
    fontSize: 32,
    fontWeight: '700' as const,
    color: '#d35400',
  },
  resultUnit: {
    fontSize: 14,
    color: '#e67e22',
    marginTop: 4,
  },
  resultDivider: {
    width: 1,
    height: 40,
    backgroundColor: '#e67e22',
    opacity: 0.3,
  },
  resultWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(230,126,34,0.2)',
  },
  resultWarningText: {
    fontSize: 13,
    color: '#e67e22',
  },
  conversionCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  conversionTitle: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 10,
  },
  conversionText: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  resetButton: {
    alignItems: 'center',
    paddingVertical: 14,
    marginBottom: 20,
  },
  resetButtonText: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.textTertiary,
  },
  disclaimerModal: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
  },
  disclaimerContent: {
    padding: 20,
  },
  disclaimerIcon: {
    alignItems: 'center',
    marginBottom: 20,
  },
  disclaimerText: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 22,
  },
  disclaimerFooter: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.textTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: '#4caf50',
    borderColor: '#4caf50',
  },
  checkboxLabel: {
    fontSize: 14,
    color: Colors.text,
    flex: 1,
  },
  acceptButton: {
    backgroundColor: '#e67e22',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  acceptButtonDisabled: {
    backgroundColor: Colors.textTertiary,
  },
  acceptButtonText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: '#fff',
  },
});
