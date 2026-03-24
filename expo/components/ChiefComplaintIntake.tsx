import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {
  AlertCircle,
  TrendingUp,
  TrendingDown,
  ChevronRight,
  Check,
  Plus,
  X,
} from 'lucide-react-native';

import Colors from '@/constants/colors';
import { ChiefComplaint, AssociatedSymptom } from '@/types';

interface ChiefComplaintIntakeProps {
  onComplete: (complaint: ChiefComplaint, symptoms: AssociatedSymptom[]) => void;
  initialComplaint?: ChiefComplaint;
  initialSymptoms?: AssociatedSymptom[];
}

const ONSET_OPTIONS = [
  { value: 'acute', label: 'Acute (sudden)', description: 'Started recently or suddenly' },
  { value: 'chronic', label: 'Chronic (gradual)', description: 'Developed over time' },
] as const;

const DURATION_OPTIONS = [
  'Less than 1 week',
  '1-4 weeks',
  '1-3 months',
  '3-6 months',
  '6-12 months',
  '1-2 years',
  'More than 2 years',
];

const MODIFYING_FACTORS = {
  better: [
    'Rest',
    'Movement/exercise',
    'Heat',
    'Cold',
    'Eating',
    'Fasting',
    'Sleep',
    'Stress reduction',
    'Certain foods',
    'Supplements',
    'Medications',
  ],
  worse: [
    'Stress',
    'Physical activity',
    'Certain foods',
    'Cold weather',
    'Hot weather',
    'Morning',
    'Evening',
    'After meals',
    'Lack of sleep',
    'Menstrual cycle',
    'Alcohol',
  ],
};

const SYMPTOM_CATEGORIES = [
  { value: 'physical', label: 'Physical' },
  { value: 'cognitive', label: 'Cognitive/Mental' },
  { value: 'emotional', label: 'Emotional' },
  { value: 'digestive', label: 'Digestive' },
] as const;

const SYMPTOM_TIMING = [
  { value: 'constant', label: 'Constant' },
  { value: 'morning', label: 'Morning' },
  { value: 'afternoon', label: 'Afternoon' },
  { value: 'evening', label: 'Evening' },
  { value: 'night', label: 'Night' },
  { value: 'post_meal', label: 'After meals' },
  { value: 'cyclical', label: 'Cyclical' },
] as const;

type IntakeStep = 'complaint' | 'onset' | 'modifiers' | 'symptoms' | 'review';

export default function ChiefComplaintIntake({
  onComplete,
  initialComplaint,
  initialSymptoms,
}: ChiefComplaintIntakeProps) {
  const [step, setStep] = useState<IntakeStep>('complaint');
  
  const [description, setDescription] = useState(initialComplaint?.description || '');
  const [onset, setOnset] = useState<'acute' | 'chronic'>(initialComplaint?.onset || 'chronic');
  const [duration, setDuration] = useState(initialComplaint?.duration || '');
  const [severity, setSeverity] = useState(initialComplaint?.severity || 5);
  const [betterWith, setBetterWith] = useState<string[]>(initialComplaint?.betterWith || []);
  const [worseWith, setWorseWith] = useState<string[]>(initialComplaint?.worseWith || []);
  const [previousDiagnoses, setPreviousDiagnoses] = useState<string[]>(initialComplaint?.previousDiagnoses || []);
  const [previousTreatments, setPreviousTreatments] = useState<string[]>(initialComplaint?.previousTreatments || []);
  const [newDiagnosis, setNewDiagnosis] = useState('');
  const [newTreatment, setNewTreatment] = useState('');
  
  const [symptoms, setSymptoms] = useState<AssociatedSymptom[]>(initialSymptoms || []);
  const [newSymptomName, setNewSymptomName] = useState('');
  const [newSymptomCategory, setNewSymptomCategory] = useState<AssociatedSymptom['category']>('physical');
  const [newSymptomTiming, setNewSymptomTiming] = useState<AssociatedSymptom['timing']>('constant');
  const [newSymptomSeverity, setNewSymptomSeverity] = useState(5);

  const toggleFactor = useCallback((factor: string, type: 'better' | 'worse') => {
    if (type === 'better') {
      setBetterWith(prev => 
        prev.includes(factor) ? prev.filter(f => f !== factor) : [...prev, factor]
      );
    } else {
      setWorseWith(prev => 
        prev.includes(factor) ? prev.filter(f => f !== factor) : [...prev, factor]
      );
    }
  }, []);

  const addDiagnosis = useCallback(() => {
    if (newDiagnosis.trim()) {
      setPreviousDiagnoses(prev => [...prev, newDiagnosis.trim()]);
      setNewDiagnosis('');
    }
  }, [newDiagnosis]);

  const addTreatment = useCallback(() => {
    if (newTreatment.trim()) {
      setPreviousTreatments(prev => [...prev, newTreatment.trim()]);
      setNewTreatment('');
    }
  }, [newTreatment]);

  const addSymptom = useCallback(() => {
    if (newSymptomName.trim()) {
      const symptom: AssociatedSymptom = {
        id: `symptom_${Date.now()}`,
        name: newSymptomName.trim(),
        category: newSymptomCategory,
        timing: newSymptomTiming,
        severity: newSymptomSeverity,
      };
      setSymptoms(prev => [...prev, symptom]);
      setNewSymptomName('');
      setNewSymptomSeverity(5);
    }
  }, [newSymptomName, newSymptomCategory, newSymptomTiming, newSymptomSeverity]);

  const removeSymptom = useCallback((id: string) => {
    setSymptoms(prev => prev.filter(s => s.id !== id));
  }, []);

  const handleComplete = useCallback(() => {
    const complaint: ChiefComplaint = {
      id: initialComplaint?.id || `complaint_${Date.now()}`,
      description,
      onset,
      duration,
      severity,
      betterWith,
      worseWith,
      previousDiagnoses,
      previousTreatments,
      timestamp: new Date().toISOString(),
    };
    onComplete(complaint, symptoms);
  }, [
    description, onset, duration, severity, betterWith, worseWith,
    previousDiagnoses, previousTreatments, symptoms, onComplete, initialComplaint,
  ]);

  const canProceed = () => {
    switch (step) {
      case 'complaint':
        return description.trim().length > 10 && duration;
      case 'onset':
        return true;
      case 'modifiers':
        return true;
      case 'symptoms':
        return true;
      case 'review':
        return true;
      default:
        return false;
    }
  };

  const nextStep = () => {
    const steps: IntakeStep[] = ['complaint', 'onset', 'modifiers', 'symptoms', 'review'];
    const currentIndex = steps.indexOf(step);
    if (currentIndex < steps.length - 1) {
      setStep(steps[currentIndex + 1]);
    }
  };

  const prevStep = () => {
    const steps: IntakeStep[] = ['complaint', 'onset', 'modifiers', 'symptoms', 'review'];
    const currentIndex = steps.indexOf(step);
    if (currentIndex > 0) {
      setStep(steps[currentIndex - 1]);
    }
  };

  const renderComplaintStep = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>What brings you in today?</Text>
      <Text style={styles.stepDescription}>
        Describe your primary concern in your own words
      </Text>

      <TextInput
        style={styles.textArea}
        value={description}
        onChangeText={setDescription}
        placeholder="Describe your main health concern..."
        placeholderTextColor={Colors.textTertiary}
        multiline
        numberOfLines={4}
        textAlignVertical="top"
      />

      <Text style={styles.label}>How long has this been going on?</Text>
      <View style={styles.optionGrid}>
        {DURATION_OPTIONS.map((option) => (
          <TouchableOpacity
            key={option}
            style={[styles.optionChip, duration === option && styles.optionChipActive]}
            onPress={() => setDuration(option)}
          >
            <Text style={[styles.optionChipText, duration === option && styles.optionChipTextActive]}>
              {option}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Severity (0-10)</Text>
      <View style={styles.severityContainer}>
        <Text style={styles.severityLabel}>Mild</Text>
        <View style={styles.severityTrack}>
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((val) => (
            <TouchableOpacity
              key={val}
              style={[
                styles.severityDot,
                severity === val && styles.severityDotActive,
                val <= 3 && styles.severityDotGreen,
                val > 3 && val <= 6 && styles.severityDotYellow,
                val > 6 && styles.severityDotRed,
              ]}
              onPress={() => setSeverity(val)}
            >
              {severity === val && (
                <Text style={styles.severityValue}>{val}</Text>
              )}
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.severityLabel}>Severe</Text>
      </View>
    </View>
  );

  const renderOnsetStep = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>How did it start?</Text>
      
      {ONSET_OPTIONS.map((option) => (
        <TouchableOpacity
          key={option.value}
          style={[styles.onsetCard, onset === option.value && styles.onsetCardActive]}
          onPress={() => setOnset(option.value)}
        >
          <View style={styles.onsetCardContent}>
            {option.value === 'acute' ? (
              <TrendingUp color={onset === option.value ? Colors.primary : Colors.textSecondary} size={24} />
            ) : (
              <TrendingDown color={onset === option.value ? Colors.primary : Colors.textSecondary} size={24} />
            )}
            <View style={styles.onsetCardText}>
              <Text style={[styles.onsetCardTitle, onset === option.value && styles.onsetCardTitleActive]}>
                {option.label}
              </Text>
              <Text style={styles.onsetCardDesc}>{option.description}</Text>
            </View>
          </View>
          {onset === option.value && <Check color={Colors.primary} size={20} />}
        </TouchableOpacity>
      ))}

      <Text style={[styles.label, { marginTop: 24 }]}>Previous diagnoses related to this</Text>
      <View style={styles.addItemRow}>
        <TextInput
          style={styles.addItemInput}
          value={newDiagnosis}
          onChangeText={setNewDiagnosis}
          placeholder="e.g., IBS, hypothyroidism..."
          placeholderTextColor={Colors.textTertiary}
        />
        <TouchableOpacity style={styles.addItemButton} onPress={addDiagnosis}>
          <Plus color="#fff" size={20} />
        </TouchableOpacity>
      </View>
      <View style={styles.chipList}>
        {previousDiagnoses.map((d, i) => (
          <View key={i} style={styles.removableChip}>
            <Text style={styles.removableChipText}>{d}</Text>
            <TouchableOpacity onPress={() => setPreviousDiagnoses(prev => prev.filter((_, idx) => idx !== i))}>
              <X color={Colors.textSecondary} size={14} />
            </TouchableOpacity>
          </View>
        ))}
      </View>

      <Text style={styles.label}>Previous treatments tried</Text>
      <View style={styles.addItemRow}>
        <TextInput
          style={styles.addItemInput}
          value={newTreatment}
          onChangeText={setNewTreatment}
          placeholder="e.g., elimination diet, supplements..."
          placeholderTextColor={Colors.textTertiary}
        />
        <TouchableOpacity style={styles.addItemButton} onPress={addTreatment}>
          <Plus color="#fff" size={20} />
        </TouchableOpacity>
      </View>
      <View style={styles.chipList}>
        {previousTreatments.map((t, i) => (
          <View key={i} style={styles.removableChip}>
            <Text style={styles.removableChipText}>{t}</Text>
            <TouchableOpacity onPress={() => setPreviousTreatments(prev => prev.filter((_, idx) => idx !== i))}>
              <X color={Colors.textSecondary} size={14} />
            </TouchableOpacity>
          </View>
        ))}
      </View>
    </View>
  );

  const renderModifiersStep = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>What makes it better or worse?</Text>
      
      <View style={styles.modifierSection}>
        <View style={styles.modifierHeader}>
          <TrendingUp color={Colors.success} size={20} />
          <Text style={styles.modifierTitle}>Better with...</Text>
        </View>
        <View style={styles.optionGrid}>
          {MODIFYING_FACTORS.better.map((factor) => (
            <TouchableOpacity
              key={factor}
              style={[styles.optionChip, betterWith.includes(factor) && styles.optionChipSuccess]}
              onPress={() => toggleFactor(factor, 'better')}
            >
              <Text style={[styles.optionChipText, betterWith.includes(factor) && styles.optionChipTextActive]}>
                {factor}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.modifierSection}>
        <View style={styles.modifierHeader}>
          <TrendingDown color={Colors.danger} size={20} />
          <Text style={styles.modifierTitle}>Worse with...</Text>
        </View>
        <View style={styles.optionGrid}>
          {MODIFYING_FACTORS.worse.map((factor) => (
            <TouchableOpacity
              key={factor}
              style={[styles.optionChip, worseWith.includes(factor) && styles.optionChipDanger]}
              onPress={() => toggleFactor(factor, 'worse')}
            >
              <Text style={[styles.optionChipText, worseWith.includes(factor) && styles.optionChipTextActive]}>
                {factor}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </View>
  );

  const renderSymptomsStep = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Associated Symptoms</Text>
      <Text style={styles.stepDescription}>
        Add any other symptoms you are experiencing
      </Text>

      <View style={styles.addSymptomCard}>
        <TextInput
          style={styles.symptomInput}
          value={newSymptomName}
          onChangeText={setNewSymptomName}
          placeholder="Symptom name (e.g., headaches, fatigue)"
          placeholderTextColor={Colors.textTertiary}
        />

        <Text style={styles.miniLabel}>Category</Text>
        <View style={styles.miniOptionRow}>
          {SYMPTOM_CATEGORIES.map((cat) => (
            <TouchableOpacity
              key={cat.value}
              style={[styles.miniChip, newSymptomCategory === cat.value && styles.miniChipActive]}
              onPress={() => setNewSymptomCategory(cat.value)}
            >
              <Text style={[styles.miniChipText, newSymptomCategory === cat.value && styles.miniChipTextActive]}>
                {cat.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.miniLabel}>When does it occur?</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.miniOptionRow}>
            {SYMPTOM_TIMING.map((timing) => (
              <TouchableOpacity
                key={timing.value}
                style={[styles.miniChip, newSymptomTiming === timing.value && styles.miniChipActive]}
                onPress={() => setNewSymptomTiming(timing.value)}
              >
                <Text style={[styles.miniChipText, newSymptomTiming === timing.value && styles.miniChipTextActive]}>
                  {timing.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        <View style={styles.symptomSeverityRow}>
          <Text style={styles.miniLabel}>Severity: {newSymptomSeverity}/10</Text>
          <View style={styles.miniSlider}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((val) => (
              <TouchableOpacity
                key={val}
                style={[styles.miniDot, newSymptomSeverity >= val && styles.miniDotActive]}
                onPress={() => setNewSymptomSeverity(val)}
              />
            ))}
          </View>
        </View>

        <TouchableOpacity
          style={[styles.addSymptomButton, !newSymptomName.trim() && styles.addSymptomButtonDisabled]}
          onPress={addSymptom}
          disabled={!newSymptomName.trim()}
        >
          <Plus color="#fff" size={18} />
          <Text style={styles.addSymptomButtonText}>Add Symptom</Text>
        </TouchableOpacity>
      </View>

      {symptoms.length > 0 && (
        <View style={styles.symptomsList}>
          <Text style={styles.symptomsListTitle}>Added Symptoms ({symptoms.length})</Text>
          {symptoms.map((symptom) => (
            <View key={symptom.id} style={styles.symptomItem}>
              <View style={styles.symptomItemContent}>
                <Text style={styles.symptomItemName}>{symptom.name}</Text>
                <Text style={styles.symptomItemMeta}>
                  {symptom.category} • {symptom.timing.replace('_', ' ')} • Severity: {symptom.severity}/10
                </Text>
              </View>
              <TouchableOpacity onPress={() => removeSymptom(symptom.id)}>
                <X color={Colors.danger} size={20} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
    </View>
  );

  const renderReviewStep = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Review Your Information</Text>

      <View style={styles.reviewCard}>
        <Text style={styles.reviewLabel}>Chief Complaint</Text>
        <Text style={styles.reviewValue}>{description}</Text>
      </View>

      <View style={styles.reviewRow}>
        <View style={styles.reviewCardHalf}>
          <Text style={styles.reviewLabel}>Onset</Text>
          <Text style={styles.reviewValue}>{onset === 'acute' ? 'Acute' : 'Chronic'}</Text>
        </View>
        <View style={styles.reviewCardHalf}>
          <Text style={styles.reviewLabel}>Duration</Text>
          <Text style={styles.reviewValue}>{duration}</Text>
        </View>
      </View>

      <View style={styles.reviewCard}>
        <Text style={styles.reviewLabel}>Severity</Text>
        <View style={styles.severityBadge}>
          <Text style={styles.severityBadgeText}>{severity}/10</Text>
        </View>
      </View>

      {betterWith.length > 0 && (
        <View style={styles.reviewCard}>
          <Text style={styles.reviewLabel}>Better with</Text>
          <View style={styles.reviewChips}>
            {betterWith.map((f, i) => (
              <View key={i} style={styles.reviewChipSuccess}>
                <Text style={styles.reviewChipText}>{f}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {worseWith.length > 0 && (
        <View style={styles.reviewCard}>
          <Text style={styles.reviewLabel}>Worse with</Text>
          <View style={styles.reviewChips}>
            {worseWith.map((f, i) => (
              <View key={i} style={styles.reviewChipDanger}>
                <Text style={styles.reviewChipText}>{f}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {symptoms.length > 0 && (
        <View style={styles.reviewCard}>
          <Text style={styles.reviewLabel}>Associated Symptoms ({symptoms.length})</Text>
          {symptoms.map((s) => (
            <Text key={s.id} style={styles.reviewSymptom}>
              • {s.name} ({s.severity}/10)
            </Text>
          ))}
        </View>
      )}

      <View style={styles.disclaimer}>
        <AlertCircle color={Colors.warning} size={16} />
        <Text style={styles.disclaimerText}>
          This information will be used for educational pattern analysis only and does not constitute medical advice.
        </Text>
      </View>
    </View>
  );

  const renderContent = () => {
    switch (step) {
      case 'complaint': return renderComplaintStep();
      case 'onset': return renderOnsetStep();
      case 'modifiers': return renderModifiersStep();
      case 'symptoms': return renderSymptomsStep();
      case 'review': return renderReviewStep();
      default: return null;
    }
  };

  const stepIndex = ['complaint', 'onset', 'modifiers', 'symptoms', 'review'].indexOf(step);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.progress}>
        {['complaint', 'onset', 'modifiers', 'symptoms', 'review'].map((s, i) => (
          <View
            key={s}
            style={[
              styles.progressDot,
              i <= stepIndex && styles.progressDotActive,
            ]}
          />
        ))}
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {renderContent()}
      </ScrollView>

      <View style={styles.footer}>
        {stepIndex > 0 && (
          <TouchableOpacity style={styles.backButton} onPress={prevStep}>
            <Text style={styles.backButtonText}>Back</Text>
          </TouchableOpacity>
        )}
        
        {step === 'review' ? (
          <TouchableOpacity style={styles.submitButton} onPress={handleComplete}>
            <Text style={styles.submitButtonText}>Submit & Analyze</Text>
            <ChevronRight color="#fff" size={20} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.nextButton, !canProceed() && styles.nextButtonDisabled]}
            onPress={nextStep}
            disabled={!canProceed()}
          >
            <Text style={styles.nextButtonText}>Continue</Text>
            <ChevronRight color="#fff" size={20} />
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  progress: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  progressDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.border,
  },
  progressDotActive: {
    backgroundColor: Colors.primary,
    width: 24,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  stepContent: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 8,
  },
  stepDescription: {
    fontSize: 15,
    color: Colors.textSecondary,
    marginBottom: 24,
    lineHeight: 22,
  },
  label: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 12,
    marginTop: 20,
  },
  textArea: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: Colors.text,
    minHeight: 120,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  optionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  optionChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  optionChipSuccess: {
    backgroundColor: Colors.success,
    borderColor: Colors.success,
  },
  optionChipDanger: {
    backgroundColor: Colors.danger,
    borderColor: Colors.danger,
  },
  optionChipText: {
    fontSize: 14,
    color: Colors.text,
  },
  optionChipTextActive: {
    color: '#fff',
  },
  severityContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  severityLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    width: 40,
  },
  severityTrack: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  severityDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  severityDotActive: {
    transform: [{ scale: 1.3 }],
  },
  severityDotGreen: {
    backgroundColor: '#D1FAE5',
  },
  severityDotYellow: {
    backgroundColor: '#FEF3C7',
  },
  severityDotRed: {
    backgroundColor: '#FEE2E2',
  },
  severityValue: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  onsetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 12,
  },
  onsetCardActive: {
    borderColor: Colors.primary,
    backgroundColor: `${Colors.primary}08`,
  },
  onsetCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flex: 1,
  },
  onsetCardText: {
    flex: 1,
  },
  onsetCardTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 2,
  },
  onsetCardTitleActive: {
    color: Colors.primary,
  },
  onsetCardDesc: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  addItemRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  addItemInput: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  addItemButton: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  removableChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 6,
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 16,
  },
  removableChipText: {
    fontSize: 13,
    color: Colors.text,
  },
  modifierSection: {
    marginBottom: 24,
  },
  modifierHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  modifierTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  addSymptomCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  symptomInput: {
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.text,
    marginBottom: 16,
  },
  miniLabel: {
    fontSize: 13,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
    marginBottom: 8,
    marginTop: 4,
  },
  miniOptionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  miniChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: Colors.surfaceSecondary,
  },
  miniChipActive: {
    backgroundColor: Colors.primary,
  },
  miniChipText: {
    fontSize: 12,
    color: Colors.text,
  },
  miniChipTextActive: {
    color: '#fff',
  },
  symptomSeverityRow: {
    marginTop: 8,
  },
  miniSlider: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
  },
  miniDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.surfaceSecondary,
  },
  miniDotActive: {
    backgroundColor: Colors.primary,
  },
  addSymptomButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 16,
  },
  addSymptomButtonDisabled: {
    backgroundColor: Colors.border,
  },
  addSymptomButtonText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: '#fff',
  },
  symptomsList: {
    marginTop: 20,
  },
  symptomsListTitle: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 12,
  },
  symptomItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    marginBottom: 8,
  },
  symptomItemContent: {
    flex: 1,
  },
  symptomItemName: {
    fontSize: 15,
    fontWeight: '500' as const,
    color: Colors.text,
    marginBottom: 2,
  },
  symptomItemMeta: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  reviewCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  reviewRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  reviewCardHalf: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
  },
  reviewLabel: {
    fontSize: 12,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  reviewValue: {
    fontSize: 15,
    color: Colors.text,
    lineHeight: 22,
  },
  severityBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 12,
  },
  severityBadgeText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  reviewChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  reviewChipSuccess: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#D1FAE5',
    borderRadius: 10,
  },
  reviewChipDanger: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#FEE2E2',
    borderRadius: 10,
  },
  reviewChipText: {
    fontSize: 12,
    color: Colors.text,
  },
  reviewSymptom: {
    fontSize: 14,
    color: Colors.text,
    marginTop: 4,
  },
  disclaimer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    backgroundColor: '#FEF3C7',
    borderRadius: 10,
    marginTop: 8,
  },
  disclaimerText: {
    flex: 1,
    fontSize: 12,
    color: Colors.text,
    lineHeight: 18,
  },
  footer: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.background,
  },
  backButton: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.surface,
  },
  backButtonText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  nextButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.primary,
  },
  nextButtonDisabled: {
    backgroundColor: Colors.border,
  },
  nextButtonText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: '#fff',
  },
  submitButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#059669',
  },
  submitButtonText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: '#fff',
  },
});
