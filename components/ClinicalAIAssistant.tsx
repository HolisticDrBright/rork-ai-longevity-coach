import { useState, useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import {
  Sparkles,
  Send,
  X,
  Leaf,
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Heart,
  Thermometer,
  Droplets,
  Wind,
  Sun,
  Moon,
} from 'lucide-react-native';

import Colors from '@/constants/colors';
import { useUser } from '@/providers/UserProvider';
import { useLabs } from '@/providers/LabsProvider';
import { useRorkAgent } from '@rork-ai/toolkit-sdk';
import {
  CLINICAL_AI_SYSTEM_PROMPT,
  TCM_PATTERNS,
  FUNCTIONAL_SYSTEMS,
  SYMPTOM_TO_PATTERN_MAP,
} from '@/constants/clinicalPatterns';
import { TCMPattern, FunctionalSystem } from '@/types';

interface ClinicalAIAssistantProps {
  onClose: () => void;
  isVisible: boolean;
}

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

export default function ClinicalAIAssistant({ onClose, isVisible }: ClinicalAIAssistantProps) {
  const {
    categoryScores,
    lifestyleProfile,
    clinicalIntake,
    contraindications,
  } = useUser();
  const { flaggedBiomarkers } = useLabs();
  
  const [chatInput, setChatInput] = useState('');
  const [showPatternInsights, setShowPatternInsights] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);

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
        symptomMap[s.name.toLowerCase()] = s.severity * 10;
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
            existing.symptoms.push(symptom);
          } else {
            tcmPatterns.push({ pattern: p as TCMPattern, score: severity, symptoms: [symptom] });
          }
        } else {
          const existing = functionalPatterns.find(f => f.system === p as FunctionalSystem);
          if (existing) {
            existing.score += severity;
            existing.symptoms.push(symptom);
          } else {
            functionalPatterns.push({ system: p as FunctionalSystem, score: severity, symptoms: [symptom] });
          }
        }
      });
    });

    return {
      tcm: tcmPatterns.sort((a, b) => b.score - a.score).slice(0, 5),
      functional: functionalPatterns.sort((a, b) => b.score - a.score).slice(0, 5),
    };
  }, [categoryScores, clinicalIntake]);

  const healthContext = useMemo(() => {
    const highRiskAreas = categoryScores.filter(s => s.percentage >= 50).map(s => s.categoryName);
    const medRiskAreas = categoryScores.filter(s => s.percentage >= 25 && s.percentage < 50).map(s => s.categoryName);
    const flaggedLabs = flaggedBiomarkers.map(b => `${b.name}: ${b.value} ${b.unit} (${b.status})`);
    
    const tcmPatternDescriptions = detectedPatterns.tcm.map(p => {
      const info = TCM_PATTERNS.find(t => t.id === p.pattern);
      return info ? `${info.name}: ${info.modernInterpretation}` : p.pattern;
    });

    const functionalDescriptions = detectedPatterns.functional.map(f => {
      const info = FUNCTIONAL_SYSTEMS.find(s => s.id === f.system);
      return info ? `${info.name}: ${info.description}` : f.system;
    });

    let chiefComplaintContext = '';
    if (clinicalIntake?.chiefComplaint) {
      const cc = clinicalIntake.chiefComplaint;
      chiefComplaintContext = `
Chief Complaint: ${cc.description}
- Onset: ${cc.onset}
- Duration: ${cc.duration}
- Severity: ${cc.severity}/10
- Better with: ${cc.betterWith.join(', ') || 'None specified'}
- Worse with: ${cc.worseWith.join(', ') || 'None specified'}
- Previous diagnoses: ${cc.previousDiagnoses.join(', ') || 'None'}
- Previous treatments: ${cc.previousTreatments.join(', ') || 'None'}`;
    }

    let associatedSymptomsContext = '';
    if (clinicalIntake?.associatedSymptoms?.length) {
      associatedSymptomsContext = `
Associated Symptoms:
${clinicalIntake.associatedSymptoms.map(s => 
  `- ${s.name} (${s.category}, ${s.timing.replace('_', ' ')}, severity: ${s.severity}/10)`
).join('\n')}`;
    }

    return `${CLINICAL_AI_SYSTEM_PROMPT}

CURRENT PATIENT DATA:

${chiefComplaintContext}
${associatedSymptomsContext}

Questionnaire Risk Areas:
- High Risk (≥50%): ${highRiskAreas.join(', ') || 'None'}
- Medium Risk (25-50%): ${medRiskAreas.join(', ') || 'None'}

Lab Findings:
${flaggedLabs.length > 0 ? flaggedLabs.join('\n') : 'No labs uploaded yet'}

Lifestyle Factors:
- Sleep: ${lifestyleProfile.sleepHours} hours, quality ${lifestyleProfile.sleepQuality}/10
- Stress: ${lifestyleProfile.stressLevel}/10
- Exercise: ${lifestyleProfile.exerciseFrequency}x per week
- Diet: ${lifestyleProfile.dietType}

Contraindications:
- Pregnant: ${contraindications.pregnant ? 'Yes' : 'No'}
- Nursing: ${contraindications.nursing ? 'Yes' : 'No'}
- Medications: ${contraindications.medications.join(', ') || 'None listed'}
- Allergies: ${contraindications.allergies.join(', ') || 'None listed'}
- Conditions: ${contraindications.conditions.join(', ') || 'None listed'}

PATTERN ANALYSIS:

TCM Patterns Detected:
${tcmPatternDescriptions.length > 0 ? tcmPatternDescriptions.join('\n') : 'Insufficient data for TCM pattern analysis'}

Functional Medicine Systems:
${functionalDescriptions.length > 0 ? functionalDescriptions.join('\n') : 'Insufficient data for functional analysis'}

Remember: Always anchor your analysis to the chief complaint. Explain correlations in patient-friendly language. Use "may," "could," and "suggests" rather than definitive statements. Recommend consulting a healthcare provider for diagnosis and treatment.`;
  }, [
    categoryScores, 
    flaggedBiomarkers, 
    lifestyleProfile, 
    clinicalIntake, 
    contraindications, 
    detectedPatterns
  ]);

  const { messages, sendMessage } = useRorkAgent({
    tools: {},
  });

  const handleSendMessage = useCallback((message?: string) => {
    const text = message || chatInput.trim();
    if (!text) return;
    
    const messageWithContext = messages.length === 0 
      ? `Context: ${healthContext}\n\nUser Question: ${text}`
      : text;
    
    sendMessage(messageWithContext);
    setChatInput('');
    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
  }, [chatInput, healthContext, messages.length, sendMessage]);

  const suggestedQuestions = useMemo(() => {
    const questions: string[] = [];
    
    if (clinicalIntake?.chiefComplaint) {
      questions.push(`What might be causing my ${clinicalIntake.chiefComplaint.description.toLowerCase().slice(0, 30)}...?`);
    }
    
    if (detectedPatterns.tcm.length > 0) {
      const topPattern = TCM_PATTERNS.find(t => t.id === detectedPatterns.tcm[0].pattern);
      if (topPattern) {
        questions.push(`Tell me about ${topPattern.name} and how it relates to my symptoms`);
        questions.push(`What foods should I eat for ${topPattern.name}?`);
      }
    }
    
    if (detectedPatterns.functional.length > 0) {
      const topSystem = FUNCTIONAL_SYSTEMS.find(s => s.id === detectedPatterns.functional[0].system);
      if (topSystem) {
        questions.push(`How can I support my ${topSystem.name.toLowerCase()}?`);
      }
    }
    
    const highRisk = categoryScores.filter(s => s.percentage >= 50);
    if (highRisk.length > 0) {
      questions.push(`What should I focus on first based on my risk areas?`);
    }
    
    questions.push('What patterns do you see in my health data?');
    questions.push('What labs would help clarify my situation?');
    
    return questions.slice(0, 4);
  }, [clinicalIntake, detectedPatterns, categoryScores]);

  if (!isVisible) return null;

  return (
    <View style={styles.overlay}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.headerIconContainer}>
              <Sparkles color="#7C3AED" size={20} />
            </View>
            <View>
              <Text style={styles.headerTitle}>Clinical AI Assistant</Text>
              <Text style={styles.headerSubtitle}>Functional Medicine & TCM Framework</Text>
            </View>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <X color={Colors.text} size={24} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.patternToggle}
          onPress={() => setShowPatternInsights(!showPatternInsights)}
        >
          <Leaf color="#059669" size={18} />
          <Text style={styles.patternToggleText}>
            {detectedPatterns.tcm.length + detectedPatterns.functional.length} patterns detected
          </Text>
          {showPatternInsights ? (
            <ChevronUp color={Colors.textSecondary} size={18} />
          ) : (
            <ChevronDown color={Colors.textSecondary} size={18} />
          )}
        </TouchableOpacity>

        {showPatternInsights && (
          <View style={styles.patternInsights}>
            {detectedPatterns.tcm.length > 0 && (
              <View style={styles.patternSection}>
                <Text style={styles.patternSectionTitle}>TCM Patterns</Text>
                {detectedPatterns.tcm.slice(0, 3).map(p => {
                  const info = TCM_PATTERNS.find(t => t.id === p.pattern);
                  const IconComponent = TCM_PATTERN_ICONS[p.pattern] || Leaf;
                  return (
                    <View key={p.pattern} style={styles.patternItem}>
                      <IconComponent color="#059669" size={16} />
                      <View style={styles.patternItemContent}>
                        <Text style={styles.patternItemName}>{info?.name || p.pattern}</Text>
                        <Text style={styles.patternItemDesc} numberOfLines={1}>
                          {info?.modernInterpretation}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
            
            {detectedPatterns.functional.length > 0 && (
              <View style={styles.patternSection}>
                <Text style={styles.patternSectionTitle}>Functional Systems</Text>
                {detectedPatterns.functional.slice(0, 3).map(f => {
                  const info = FUNCTIONAL_SYSTEMS.find(s => s.id === f.system);
                  return (
                    <View key={f.system} style={styles.patternItem}>
                      <Activity color="#2563EB" size={16} />
                      <View style={styles.patternItemContent}>
                        <Text style={styles.patternItemName}>{info?.name || f.system}</Text>
                        <Text style={styles.patternItemDesc} numberOfLines={1}>
                          {info?.description}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        <ScrollView
          ref={scrollViewRef}
          style={styles.messagesContainer}
          contentContainerStyle={styles.messagesContent}
          showsVerticalScrollIndicator={false}
        >
          {messages.length === 0 && (
            <View style={styles.welcomeContainer}>
              <View style={styles.welcomeIcon}>
                <Sparkles color="#7C3AED" size={32} />
              </View>
              <Text style={styles.welcomeTitle}>How can I help you today?</Text>
              <Text style={styles.welcomeText}>
                I analyze your health data through functional medicine and TCM frameworks to help identify patterns and provide personalized insights.
              </Text>
              
              {clinicalIntake?.chiefComplaint && (
                <View style={styles.chiefComplaintBadge}>
                  <AlertTriangle color="#F59E0B" size={14} />
                  <Text style={styles.chiefComplaintText}>
                    Chief Complaint: {clinicalIntake.chiefComplaint.description.slice(0, 50)}...
                  </Text>
                </View>
              )}

              <View style={styles.suggestions}>
                {suggestedQuestions.map((q, i) => (
                  <TouchableOpacity
                    key={i}
                    style={styles.suggestion}
                    onPress={() => handleSendMessage(q)}
                  >
                    <Text style={styles.suggestionText}>{q}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {messages.map((m) => (
            <View
              key={m.id}
              style={[
                styles.messageBubble,
                m.role === 'user' ? styles.userBubble : styles.assistantBubble,
              ]}
            >
              {m.parts.map((part, i) => {
                if (part.type === 'text') {
                  const displayText = m.role === 'user' 
                    ? part.text.replace(/^Context:[\s\S]*?User Question:\s*/i, '')
                    : part.text;
                  return (
                    <Text
                      key={`${m.id}-${i}`}
                      style={[
                        styles.messageText,
                        m.role === 'user' && styles.userMessageText,
                      ]}
                    >
                      {displayText}
                    </Text>
                  );
                }
                if (part.type === 'tool') {
                  return (
                    <View key={`${m.id}-${i}`} style={styles.tooling}>
                      <ActivityIndicator size="small" color="#7C3AED" />
                      <Text style={styles.toolingText}>Analyzing...</Text>
                    </View>
                  );
                }
                return null;
              })}
            </View>
          ))}
        </ScrollView>

        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            value={chatInput}
            onChangeText={setChatInput}
            placeholder="Ask about your health patterns..."
            placeholderTextColor={Colors.textTertiary}
            multiline
            maxLength={500}
          />
          <TouchableOpacity
            style={[styles.sendButton, !chatInput.trim() && styles.sendButtonDisabled]}
            onPress={() => handleSendMessage()}
            disabled={!chatInput.trim()}
          >
            <Send color="#fff" size={18} />
          </TouchableOpacity>
        </View>

        <View style={styles.disclaimer}>
          <Text style={styles.disclaimerText}>
            Educational purposes only. Not medical advice. Consult a healthcare provider.
          </Text>
        </View>
      </KeyboardAvoidingView>
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
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.background,
  },
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    backgroundColor: Colors.surface,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3E8FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  headerSubtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  closeButton: {
    padding: 4,
  },
  patternToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#ECFDF5',
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  patternToggleText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500' as const,
    color: '#059669',
  },
  patternInsights: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  patternSection: {
    marginBottom: 12,
  },
  patternSectionTitle: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  patternItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  patternItemContent: {
    flex: 1,
  },
  patternItemName: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.text,
  },
  patternItemDesc: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  messagesContainer: {
    flex: 1,
  },
  messagesContent: {
    padding: 16,
    paddingBottom: 24,
  },
  welcomeContainer: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  welcomeIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#F3E8FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  welcomeTitle: {
    fontSize: 20,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 8,
  },
  welcomeText: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  chiefComplaintBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#FEF3C7',
    borderRadius: 10,
    marginBottom: 20,
  },
  chiefComplaintText: {
    flex: 1,
    fontSize: 13,
    color: '#92400E',
  },
  suggestions: {
    width: '100%',
    gap: 10,
  },
  suggestion: {
    backgroundColor: Colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  suggestionText: {
    fontSize: 14,
    color: '#7C3AED',
    fontWeight: '500' as const,
    textAlign: 'center',
  },
  messageBubble: {
    maxWidth: '85%',
    padding: 14,
    borderRadius: 16,
    marginBottom: 12,
  },
  userBubble: {
    backgroundColor: '#7C3AED',
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    backgroundColor: Colors.surface,
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
  },
  messageText: {
    fontSize: 15,
    color: Colors.text,
    lineHeight: 22,
  },
  userMessageText: {
    color: '#fff',
  },
  tooling: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toolingText: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    gap: 10,
  },
  input: {
    flex: 1,
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: Colors.text,
    maxHeight: 100,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#7C3AED',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  disclaimer: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: Colors.surfaceSecondary,
  },
  disclaimerText: {
    fontSize: 11,
    color: Colors.textTertiary,
    textAlign: 'center',
  },
});
