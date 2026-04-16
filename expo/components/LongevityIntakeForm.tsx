import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import {
  ChevronLeft,
  ChevronRight,
  Check,
  Upload,
  User,
  Target,
  Sparkles,
  FlaskConical,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import type {
  MenstrualStatus,
  FitnessLevel,
  DietType,
} from '@/types';

interface IntakeData {
  biologicalAge?: number;
  chronologicalAge?: number;
  weightCurrent?: number;
  weightIdeal?: number;
  height?: number;
  sex?: 'female' | 'male' | 'other';
  menstrualStatus?: MenstrualStatus;
  fitnessLevel?: FitnessLevel;
  dietType?: DietType;
  conditions: string[];
  sensitivities: string[];
  oppositions: string[];
  longevityGoals: string[];
  preferredBrands: string[];
  modalities: string[];
  topComplaints: string[];
  lifestyleFactors: string[];
  labs: Record<string, any>;
  notes: string;
}

const INITIAL: IntakeData = {
  conditions: [],
  sensitivities: [],
  oppositions: [],
  longevityGoals: [],
  preferredBrands: [],
  modalities: [],
  topComplaints: [],
  lifestyleFactors: [],
  labs: {},
  notes: '',
};

const STEPS = [
  { id: 'demographics', title: 'Demographics', icon: User },
  { id: 'goals', title: 'Goals & Lifestyle', icon: Target },
  { id: 'preferences', title: 'Preferences', icon: Sparkles },
  { id: 'labs', title: 'Labs', icon: FlaskConical },
];

const FITNESS_OPTIONS: FitnessLevel[] = ['sedentary', 'recreational', 'athletic', 'elite'];
const DIET_OPTIONS: DietType[] = ['carnivore', 'paleo', 'keto', 'mediterranean', 'vegan', 'standard', 'other'];
const SEX_OPTIONS: Array<'female' | 'male' | 'other'> = ['female', 'male', 'other'];
const MENSTRUAL_OPTIONS: MenstrualStatus[] = ['pre_menopause', 'peri_menopause', 'post_menopause', 'na'];

const LONGEVITY_GOALS = [
  'Reverse biological age', 'Improve biomarkers', 'Increase energy',
  'Improve cognition', 'Better sleep', 'Body recomposition',
  'Athletic performance', 'Healthspan extension', 'Hormone optimization',
];

const MODALITY_OPTIONS = [
  'Red Light', 'HBOT', 'PEMF', 'Vibration Plate', 'Sauna', 'Cold Plunge',
];

const BRAND_OPTIONS = [
  'Healthgevity', 'Quicksilver', 'LVLUP', 'C60 Wizard Sciences', 'NOVOS', 'StemRegen',
];

const LIFESTYLE_FACTORS = [
  'Shift work', 'Frequent travel', 'Athlete', 'High stress', 'Parent', 'Caregiver',
];

const OPPOSITION_OPTIONS = [
  'No injections', 'No meat (vegan)', 'No meat (vegetarian)',
  'Capsule limit: 5/day', 'Capsule limit: 10/day',
  'No extended fasting', 'No cold therapy',
];

const CONDITION_OPTIONS = [
  'Cancer', 'Diabetes', 'Thyroid condition', 'Cardiovascular disease',
  'Autoimmune', 'Immunocompromised', 'Pregnant/Nursing', 'Depression/Anxiety',
];

interface Props {
  onSubmit: (data: IntakeData) => Promise<void>;
  initialData?: Partial<IntakeData>;
}

export default function LongevityIntakeForm({ onSubmit, initialData }: Props) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<IntakeData>({ ...INITIAL, ...initialData });
  const [submitting, setSubmitting] = useState(false);

  const update = <K extends keyof IntakeData>(key: K, value: IntakeData[K]) =>
    setData(prev => ({ ...prev, [key]: value }));

  const toggleArrayItem = (key: keyof IntakeData, item: string) => {
    const current = (data[key] as string[]) ?? [];
    const next = current.includes(item) ? current.filter(x => x !== item) : [...current, item];
    update(key, next as any);
  };

  const handleSubmit = useCallback(async () => {
    if (!data.chronologicalAge) {
      Alert.alert('Missing Info', 'Please enter your chronological age.');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(data);
    } catch (e) {
      Alert.alert('Error', 'Failed to save intake. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [data, onSubmit]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {/* Step Indicator */}
      <View style={styles.stepIndicator}>
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const isActive = i === step;
          const isComplete = i < step;
          return (
            <View key={s.id} style={styles.stepItem}>
              <View style={[
                styles.stepDot,
                isActive && styles.stepDotActive,
                isComplete && styles.stepDotComplete,
              ]}>
                {isComplete ? <Check color="#fff" size={14} /> : <Icon color={isActive ? '#fff' : Colors.textTertiary} size={14} />}
              </View>
              <Text style={[styles.stepLabel, isActive && styles.stepLabelActive]}>{s.title}</Text>
            </View>
          );
        })}
      </View>

      {/* Step 0: Demographics */}
      {step === 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tell us about yourself</Text>

          <View style={styles.row}>
            <View style={styles.col}>
              <Text style={styles.label}>Chronological Age *</Text>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                placeholder="45"
                placeholderTextColor={Colors.textTertiary}
                value={data.chronologicalAge?.toString() ?? ''}
                onChangeText={(v) => update('chronologicalAge', v ? Number(v) : undefined)}
              />
            </View>
            <View style={styles.col}>
              <Text style={styles.label}>Biological Age (TruAge)</Text>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                placeholder="52"
                placeholderTextColor={Colors.textTertiary}
                value={data.biologicalAge?.toString() ?? ''}
                onChangeText={(v) => update('biologicalAge', v ? Number(v) : undefined)}
              />
            </View>
          </View>

          <View style={styles.row}>
            <View style={styles.col}>
              <Text style={styles.label}>Weight (lbs)</Text>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                placeholder="165"
                placeholderTextColor={Colors.textTertiary}
                value={data.weightCurrent?.toString() ?? ''}
                onChangeText={(v) => update('weightCurrent', v ? Number(v) : undefined)}
              />
            </View>
            <View style={styles.col}>
              <Text style={styles.label}>Ideal Weight (lbs)</Text>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                placeholder="150"
                placeholderTextColor={Colors.textTertiary}
                value={data.weightIdeal?.toString() ?? ''}
                onChangeText={(v) => update('weightIdeal', v ? Number(v) : undefined)}
              />
            </View>
            <View style={styles.col}>
              <Text style={styles.label}>Height (in)</Text>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                placeholder="68"
                placeholderTextColor={Colors.textTertiary}
                value={data.height?.toString() ?? ''}
                onChangeText={(v) => update('height', v ? Number(v) : undefined)}
              />
            </View>
          </View>

          <Text style={styles.label}>Sex</Text>
          <View style={styles.chipRow}>
            {SEX_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt}
                style={[styles.chip, data.sex === opt && styles.chipActive]}
                onPress={() => update('sex', opt)}
              >
                <Text style={[styles.chipText, data.sex === opt && styles.chipTextActive]}>{opt}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {data.sex === 'female' && (
            <>
              <Text style={styles.label}>Menstrual Status</Text>
              <View style={styles.chipRow}>
                {MENSTRUAL_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt}
                    style={[styles.chip, data.menstrualStatus === opt && styles.chipActive]}
                    onPress={() => update('menstrualStatus', opt)}
                  >
                    <Text style={[styles.chipText, data.menstrualStatus === opt && styles.chipTextActive]}>
                      {opt.replace(/_/g, ' ')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          <Text style={styles.label}>Fitness Level</Text>
          <View style={styles.chipRow}>
            {FITNESS_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt}
                style={[styles.chip, data.fitnessLevel === opt && styles.chipActive]}
                onPress={() => update('fitnessLevel', opt)}
              >
                <Text style={[styles.chipText, data.fitnessLevel === opt && styles.chipTextActive]}>{opt}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Diet Type</Text>
          <View style={styles.chipRow}>
            {DIET_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt}
                style={[styles.chip, data.dietType === opt && styles.chipActive]}
                onPress={() => update('dietType', opt)}
              >
                <Text style={[styles.chipText, data.dietType === opt && styles.chipTextActive]}>{opt}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Step 1: Goals & Lifestyle */}
      {step === 1 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your longevity goals</Text>

          <Text style={styles.label}>Top longevity goals (select all that apply)</Text>
          <View style={styles.chipRow}>
            {LONGEVITY_GOALS.map((g) => (
              <TouchableOpacity
                key={g}
                style={[styles.chip, data.longevityGoals.includes(g) && styles.chipActive]}
                onPress={() => toggleArrayItem('longevityGoals', g)}
              >
                <Text style={[styles.chipText, data.longevityGoals.includes(g) && styles.chipTextActive]}>{g}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Known conditions</Text>
          <View style={styles.chipRow}>
            {CONDITION_OPTIONS.map((c) => (
              <TouchableOpacity
                key={c}
                style={[styles.chip, data.conditions.includes(c) && styles.chipActive]}
                onPress={() => toggleArrayItem('conditions', c)}
              >
                <Text style={[styles.chipText, data.conditions.includes(c) && styles.chipTextActive]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Lifestyle factors</Text>
          <View style={styles.chipRow}>
            {LIFESTYLE_FACTORS.map((f) => (
              <TouchableOpacity
                key={f}
                style={[styles.chip, data.lifestyleFactors.includes(f) && styles.chipActive]}
                onPress={() => toggleArrayItem('lifestyleFactors', f)}
              >
                <Text style={[styles.chipText, data.lifestyleFactors.includes(f) && styles.chipTextActive]}>{f}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Top 3 complaints (comma-separated)</Text>
          <TextInput
            style={[styles.input, styles.textarea]}
            multiline
            numberOfLines={3}
            placeholder="Low energy, brain fog, poor sleep"
            placeholderTextColor={Colors.textTertiary}
            value={data.topComplaints.join(', ')}
            onChangeText={(v) => update('topComplaints', v.split(',').map(s => s.trim()).filter(Boolean))}
          />

          <Text style={styles.label}>Sensitivities / Allergies</Text>
          <TextInput
            style={[styles.input, styles.textarea]}
            multiline
            numberOfLines={2}
            placeholder="Shellfish, niacin flushing, latex"
            placeholderTextColor={Colors.textTertiary}
            value={data.sensitivities.join(', ')}
            onChangeText={(v) => update('sensitivities', v.split(',').map(s => s.trim()).filter(Boolean))}
          />
        </View>
      )}

      {/* Step 2: Preferences & Modalities */}
      {step === 2 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Preferences & available tools</Text>

          <Text style={styles.label}>Preferred supplement brands</Text>
          <View style={styles.chipRow}>
            {BRAND_OPTIONS.map((b) => (
              <TouchableOpacity
                key={b}
                style={[styles.chip, data.preferredBrands.includes(b) && styles.chipActive]}
                onPress={() => toggleArrayItem('preferredBrands', b)}
              >
                <Text style={[styles.chipText, data.preferredBrands.includes(b) && styles.chipTextActive]}>{b}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Available modalities</Text>
          <View style={styles.chipRow}>
            {MODALITY_OPTIONS.map((m) => (
              <TouchableOpacity
                key={m}
                style={[styles.chip, data.modalities.includes(m) && styles.chipActive]}
                onPress={() => toggleArrayItem('modalities', m)}
              >
                <Text style={[styles.chipText, data.modalities.includes(m) && styles.chipTextActive]}>{m}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Oppositions (what you want to avoid)</Text>
          <View style={styles.chipRow}>
            {OPPOSITION_OPTIONS.map((o) => (
              <TouchableOpacity
                key={o}
                style={[styles.chip, data.oppositions.includes(o) && styles.chipActive]}
                onPress={() => toggleArrayItem('oppositions', o)}
              >
                <Text style={[styles.chipText, data.oppositions.includes(o) && styles.chipTextActive]}>{o}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Additional notes</Text>
          <TextInput
            style={[styles.input, styles.textarea]}
            multiline
            numberOfLines={4}
            placeholder="Anything else your practitioner should know..."
            placeholderTextColor={Colors.textTertiary}
            value={data.notes}
            onChangeText={(v) => update('notes', v)}
          />
        </View>
      )}

      {/* Step 3: Labs */}
      {step === 3 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Upload your lab reports</Text>
          <Text style={styles.hint}>
            Labs power the personalization engine. Upload PDFs of any recent lab reports.
            The existing Rupa/Vibrant integration will parse them automatically.
          </Text>

          {[
            { key: 'truAge', label: 'TruAge Epigenetic Report' },
            { key: 'nutrEval', label: 'NutrEval (Genova)' },
            { key: 'genetics3x4', label: '3x4 Genetics Report' },
            { key: 'dutch', label: 'DUTCH Hormone Test' },
            { key: 'giMap', label: 'GI-MAP Stool Test' },
            { key: 'vibrant', label: 'Vibrant Wellness Panels' },
          ].map((lab) => (
            <TouchableOpacity
              key={lab.key}
              style={styles.labUpload}
              onPress={() => Alert.alert('Upload', `Lab upload for ${lab.label} will use the existing lab pipeline.`)}
            >
              <Upload color={Colors.primary} size={20} />
              <View style={styles.labUploadContent}>
                <Text style={styles.labUploadTitle}>{lab.label}</Text>
                <Text style={styles.labUploadSubtitle}>Tap to upload PDF</Text>
              </View>
              {data.labs[lab.key] && <Check color={Colors.success} size={20} />}
            </TouchableOpacity>
          ))}

          <Text style={styles.hint}>
            You can skip labs and add them later — we'll generate a best-effort protocol
            based on the data you've provided, and refine it once labs arrive.
          </Text>
        </View>
      )}

      {/* Navigation */}
      <View style={styles.navRow}>
        {step > 0 && (
          <TouchableOpacity style={styles.navBack} onPress={() => setStep(step - 1)}>
            <ChevronLeft color={Colors.primary} size={18} />
            <Text style={styles.navBackText}>Back</Text>
          </TouchableOpacity>
        )}
        {step < STEPS.length - 1 ? (
          <TouchableOpacity style={styles.navNext} onPress={() => setStep(step + 1)}>
            <Text style={styles.navNextText}>Next</Text>
            <ChevronRight color="#fff" size={18} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.navNext} onPress={handleSubmit} disabled={submitting}>
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Check color="#fff" size={18} />
                <Text style={styles.navNextText}>Generate Protocol</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 40 },
  stepIndicator: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    marginBottom: 20, paddingHorizontal: 8,
  },
  stepItem: { flex: 1, alignItems: 'center', gap: 6 },
  stepDot: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: Colors.borderLight,
    justifyContent: 'center', alignItems: 'center',
  },
  stepDotActive: { backgroundColor: Colors.primary },
  stepDotComplete: { backgroundColor: Colors.success },
  stepLabel: { fontSize: 11, color: Colors.textTertiary, textAlign: 'center' },
  stepLabelActive: { color: Colors.primary, fontWeight: '600' },
  section: { gap: 14 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: Colors.text, marginBottom: 4 },
  label: { fontSize: 13, fontWeight: '600', color: Colors.text, marginTop: 6 },
  hint: { fontSize: 12, color: Colors.textSecondary, lineHeight: 18, fontStyle: 'italic' },
  row: { flexDirection: 'row', gap: 10 },
  col: { flex: 1 },
  input: {
    backgroundColor: Colors.surface, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: Colors.text,
  },
  textarea: { minHeight: 70, textAlignVertical: 'top' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
  },
  chipActive: { backgroundColor: Colors.primary + '15', borderColor: Colors.primary },
  chipText: { fontSize: 12, color: Colors.text },
  chipTextActive: { color: Colors.primary, fontWeight: '600' },
  labUpload: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, backgroundColor: Colors.surface, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.border,
  },
  labUploadContent: { flex: 1 },
  labUploadTitle: { fontSize: 14, fontWeight: '600', color: Colors.text },
  labUploadSubtitle: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  navRow: { flexDirection: 'row', gap: 10, marginTop: 20 },
  navBack: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 14, borderRadius: 10, borderWidth: 1, borderColor: Colors.primary,
  },
  navBackText: { fontSize: 15, fontWeight: '600', color: Colors.primary },
  navNext: {
    flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 14, borderRadius: 10, backgroundColor: Colors.primary,
  },
  navNextText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
