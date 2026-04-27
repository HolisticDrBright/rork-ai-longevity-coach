import { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Slider from '@react-native-community/slider';
import {
  Calendar,
  Zap,
  Moon,
  Smile,
  Activity,
  Brain,
  Check,
  Scale,
  Heart,
  Trophy,
  AlertCircle,
  ChevronRight,
  AlertTriangle,
  Pill,
  Clock,
  CheckCircle2,
  Circle,
} from 'lucide-react-native';

import Colors from '@/constants/colors';
import { useProtocol } from '@/providers/ProtocolProvider';
import { useHormones, hormoneSymptoms } from '@/providers/HormoneProvider';
import { DailySymptoms, HormoneEntry, TodayAction } from '@/types';

type SymptomCategory = 'high_testosterone_dhea' | 'low_progesterone' | 'low_estrogen' | 'high_estrogen';

const symptomConfig = [
  { key: 'energy' as const, label: 'Energy', icon: Zap, color: Colors.accent },
  { key: 'sleep' as const, label: 'Sleep Quality', icon: Moon, color: Colors.primary },
  { key: 'mood' as const, label: 'Mood', icon: Smile, color: Colors.success },
  { key: 'digestion' as const, label: 'Digestion', icon: Activity, color: Colors.coral },
  { key: 'focus' as const, label: 'Focus', icon: Brain, color: Colors.chartPurple },
];

const categoryConfig: Record<SymptomCategory, { label: string; color: string; icon: string }> = {
  high_testosterone_dhea: { label: 'High Testosterone/DHEA', color: '#E76F51', icon: '⚡' },
  low_progesterone: { label: 'Low Progesterone', color: '#AB47BC', icon: '🌙' },
  low_estrogen: { label: 'Low Estrogen', color: '#4A90D9', icon: '💧' },
  high_estrogen: { label: 'High Estrogen', color: '#F4A261', icon: '🌸' },
};

export default function TrackingScreen() {
  const { todayAdherence, todayActions, toggleActionComplete, updateDailySymptoms, saveWeeklyCheckIn } = useProtocol();
  const {
    todayEntry,
    addEntry,
    updateEntry,
    getGuidance,
  } = useHormones();

  const [activeTab, setActiveTab] = useState<'daily' | 'weekly' | 'hormones'>('daily');

  const [symptoms, setSymptoms] = useState<DailySymptoms>(
    todayAdherence?.symptoms || {
      energy: 5,
      sleep: 5,
      mood: 5,
      digestion: 5,
      focus: 5,
    }
  );
  const [symptomNotes, setSymptomNotes] = useState(todayAdherence?.symptoms.notes || '');

  const [weight, setWeight] = useState('');
  const [waist, setWaist] = useState('');
  const [restingHR, setRestingHR] = useState('');
  const [sleepScore, setSleepScore] = useState('');
  const [wins, setWins] = useState('');
  const [challenges, setChallenges] = useState('');

  const [cycleDay, setCycleDay] = useState(todayEntry?.cycleDay?.toString() || '');
  const [hormoneNotes, setHormoneNotes] = useState(todayEntry?.notes || '');
  const [hormoneSymptomValues, setHormoneSymptomValues] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    hormoneSymptoms.forEach(s => {
      const existing = todayEntry?.symptoms.find(ts => ts.symptomId === s.id);
      initial[s.id] = existing?.severity || 0;
    });
    return initial;
  });
  const [expandedCategory, setExpandedCategory] = useState<SymptomCategory | null>('high_testosterone_dhea');

  const handleSymptomChange = async (key: keyof Omit<DailySymptoms, 'notes'>, value: number) => {
    await Haptics.selectionAsync();
    const updated = { ...symptoms, [key]: Math.round(value) };
    setSymptoms(updated);
  };

  const handleSaveDaily = async () => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    updateDailySymptoms({ ...symptoms, notes: symptomNotes });
  };

  const handleSaveWeekly = async () => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    saveWeeklyCheckIn({
      weight: parseFloat(weight) || 0,
      waistCircumference: parseFloat(waist) || undefined,
      restingHeartRate: parseFloat(restingHR) || undefined,
      sleepScore: parseFloat(sleepScore) || undefined,
      wins,
      challenges,
    });
  };

  const handleHormoneSymptomChange = useCallback(async (symptomId: string, severity: number) => {
    await Haptics.selectionAsync();
    setHormoneSymptomValues(prev => ({ ...prev, [symptomId]: severity }));
  }, []);

  const handleSaveHormones = useCallback(async () => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    
    const symptomArray = Object.entries(hormoneSymptomValues)
      .filter(([_, severity]) => severity > 0)
      .map(([symptomId, severity]) => ({ symptomId, severity }));

    const entry: Omit<HormoneEntry, 'id'> = {
      date: new Date().toISOString().split('T')[0],
      cycleDay: cycleDay ? parseInt(cycleDay) : undefined,
      symptoms: symptomArray,
      notes: hormoneNotes || undefined,
    };

    if (todayEntry) {
      updateEntry(todayEntry.id, entry);
    } else {
      addEntry(entry);
    }
  }, [hormoneSymptomValues, cycleDay, hormoneNotes, todayEntry, addEntry, updateEntry]);

  const previewGuidance = useMemo(() => {
    const symptomArray = Object.entries(hormoneSymptomValues)
      .filter(([_, severity]) => severity > 0)
      .map(([symptomId, severity]) => ({ symptomId, severity }));

    if (symptomArray.length === 0) return [];

    const mockEntry: HormoneEntry = {
      id: 'preview',
      date: new Date().toISOString().split('T')[0],
      symptoms: symptomArray,
    };

    return getGuidance(mockEntry);
  }, [hormoneSymptomValues, getGuidance]);

  const groupedSymptoms = useMemo(() => {
    const groups: Record<SymptomCategory, typeof hormoneSymptoms> = {
      high_testosterone_dhea: [],
      low_progesterone: [],
      low_estrogen: [],
      high_estrogen: [],
    };

    hormoneSymptoms.forEach(s => {
      groups[s.category].push(s);
    });

    return groups;
  }, []);

  const supplementActions = useMemo(() => {
    return todayActions.filter(a => a.type === 'supplement');
  }, [todayActions]);

  const completedSupplementCount = useMemo(() => {
    return supplementActions.filter(a => a.completed).length;
  }, [supplementActions]);

  const handleToggleSupplement = useCallback(async (action: TodayAction) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    toggleActionComplete(action);
  }, [toggleActionComplete]);

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const renderSeverityPicker = useCallback((symptomId: string, currentValue: number) => (
    <View style={styles.severityPicker}>
      {[0, 1, 2, 3, 4].map(level => (
        <TouchableOpacity
          key={level}
          style={[
            styles.severityButton,
            currentValue === level && styles.severityButtonActive,
            currentValue === level && { backgroundColor: level === 0 ? Colors.textTertiary : 
              level === 1 ? '#66BB6A' : level === 2 ? '#FFA726' : level === 3 ? '#FF7043' : '#EF5350' },
          ]}
          onPress={() => handleHormoneSymptomChange(symptomId, level)}
        >
          <Text style={[
            styles.severityButtonText,
            currentValue === level && styles.severityButtonTextActive,
          ]}>
            {level}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  ), [handleHormoneSymptomChange]);

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[Colors.secondary, Colors.primaryLight]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={['top']}>
          <View style={styles.header}>
            <Calendar color={Colors.textInverse} size={24} />
            <Text style={styles.headerTitle}>Track Progress</Text>
            <Text style={styles.headerDate}>{today}</Text>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'daily' && styles.tabActive]}
          onPress={() => setActiveTab('daily')}
        >
          <Text style={[styles.tabText, activeTab === 'daily' && styles.tabTextActive]}>
            Daily
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'weekly' && styles.tabActive]}
          onPress={() => setActiveTab('weekly')}
        >
          <Text style={[styles.tabText, activeTab === 'weekly' && styles.tabTextActive]}>
            Weekly
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'hormones' && styles.tabActive]}
          onPress={() => setActiveTab('hormones')}
        >
          <Heart color={activeTab === 'hormones' ? Colors.textInverse : Colors.textSecondary} size={14} />
          <Text style={[styles.tabText, activeTab === 'hormones' && styles.tabTextActive]}>
            Hormones
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {activeTab === 'daily' && (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>How are you feeling today?</Text>
              <Text style={styles.sectionSubtitle}>
                Rate each area from 1 (poor) to 10 (excellent)
              </Text>

              {symptomConfig.map(({ key, label, icon: Icon, color }) => (
                <View key={key} style={styles.symptomRow}>
                  <View style={styles.symptomHeader}>
                    <View style={[styles.symptomIcon, { backgroundColor: `${color}15` }]}>
                      <Icon color={color} size={18} />
                    </View>
                    <Text style={styles.symptomLabel}>{label}</Text>
                    <View style={[styles.symptomValue, { backgroundColor: `${color}15` }]}>
                      <Text style={[styles.symptomValueText, { color }]}>
                        {symptoms[key]}
                      </Text>
                    </View>
                  </View>
                  <Slider
                    style={styles.slider}
                    minimumValue={1}
                    maximumValue={10}
                    step={1}
                    value={symptoms[key]}
                    onValueChange={(value) => handleSymptomChange(key, value)}
                    minimumTrackTintColor={color}
                    maximumTrackTintColor={Colors.border}
                    thumbTintColor={color}
                  />
                </View>
              ))}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Notes</Text>
              <TextInput
                style={styles.notesInput}
                value={symptomNotes}
                onChangeText={setSymptomNotes}
                placeholder="Any symptoms, observations, or notes for today..."
                placeholderTextColor={Colors.textTertiary}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
            </View>

            {supplementActions.length > 0 && (
              <View style={styles.section}>
                <View style={styles.supplementHeader}>
                  <View style={styles.supplementTitleRow}>
                    <View style={[styles.symptomIcon, { backgroundColor: `${Colors.chartTeal}15` }]}>
                      <Pill color={Colors.chartTeal} size={18} />
                    </View>
                    <View style={styles.supplementTitleInfo}>
                      <Text style={styles.sectionTitle}>Today's Supplements</Text>
                      <Text style={styles.supplementProgress}>
                        {completedSupplementCount} of {supplementActions.length} taken
                      </Text>
                    </View>
                  </View>
                  {supplementActions.length > 0 && (
                    <View style={styles.supplementProgressBar}>
                      <View
                        style={[
                          styles.supplementProgressFill,
                          {
                            width: `${supplementActions.length > 0 ? (completedSupplementCount / supplementActions.length) * 100 : 0}%`,
                            backgroundColor: completedSupplementCount === supplementActions.length ? Colors.success : Colors.chartTeal,
                          },
                        ]}
                      />
                    </View>
                  )}
                </View>

                {supplementActions.map((action) => (
                  <TouchableOpacity
                    key={action.id}
                    style={[
                      styles.supplementItem,
                      action.completed && styles.supplementItemCompleted,
                    ]}
                    onPress={() => handleToggleSupplement(action)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.supplementCheckbox}>
                      {action.completed ? (
                        <View style={styles.checkboxChecked}>
                          <Check color={Colors.textInverse} size={14} />
                        </View>
                      ) : (
                        <View style={styles.checkboxUnchecked}>
                          <Circle color={Colors.border} size={22} />
                        </View>
                      )}
                    </View>
                    <View style={styles.supplementInfo}>
                      <Text
                        style={[
                          styles.supplementName,
                          action.completed && styles.supplementNameCompleted,
                        ]}
                      >
                        {action.name}
                      </Text>
                      <Text style={styles.supplementDetails}>{action.details}</Text>
                    </View>
                    <View style={styles.supplementTimingBadge}>
                      <Clock color={Colors.textTertiary} size={12} />
                      <Text style={styles.supplementTimingText}>{action.timing}</Text>
                    </View>
                  </TouchableOpacity>
                ))}

                {completedSupplementCount === supplementActions.length && supplementActions.length > 0 && (
                  <View style={styles.allDoneBanner}>
                    <CheckCircle2 color={Colors.success} size={18} />
                    <Text style={styles.allDoneText}>All supplements taken today!</Text>
                  </View>
                )}
              </View>
            )}

            <TouchableOpacity style={styles.saveButton} onPress={handleSaveDaily}>
              <Check color={Colors.textInverse} size={20} />
              <Text style={styles.saveButtonText}>Save Daily Check-in</Text>
            </TouchableOpacity>
          </>
        )}

        {activeTab === 'weekly' && (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Measurements</Text>
              <Text style={styles.sectionSubtitle}>
                Track your key metrics weekly
              </Text>

              <View style={styles.measurementGrid}>
                <View style={styles.measurementCard}>
                  <Scale color={Colors.primary} size={20} />
                  <Text style={styles.measurementLabel}>Weight (lbs)</Text>
                  <TextInput
                    style={styles.measurementInput}
                    value={weight}
                    onChangeText={setWeight}
                    placeholder="175"
                    placeholderTextColor={Colors.textTertiary}
                    keyboardType="numeric"
                  />
                </View>

                <View style={styles.measurementCard}>
                  <Activity color={Colors.coral} size={20} />
                  <Text style={styles.measurementLabel}>Waist (in)</Text>
                  <TextInput
                    style={styles.measurementInput}
                    value={waist}
                    onChangeText={setWaist}
                    placeholder="32"
                    placeholderTextColor={Colors.textTertiary}
                    keyboardType="numeric"
                  />
                </View>

                <View style={styles.measurementCard}>
                  <Heart color={Colors.danger} size={20} />
                  <Text style={styles.measurementLabel}>Resting HR</Text>
                  <TextInput
                    style={styles.measurementInput}
                    value={restingHR}
                    onChangeText={setRestingHR}
                    placeholder="60"
                    placeholderTextColor={Colors.textTertiary}
                    keyboardType="numeric"
                  />
                </View>

                <View style={styles.measurementCard}>
                  <Moon color={Colors.primary} size={20} />
                  <Text style={styles.measurementLabel}>Sleep Score</Text>
                  <TextInput
                    style={styles.measurementInput}
                    value={sleepScore}
                    onChangeText={setSleepScore}
                    placeholder="85"
                    placeholderTextColor={Colors.textTertiary}
                    keyboardType="numeric"
                  />
                </View>
              </View>
            </View>

            <View style={styles.section}>
              <View style={styles.reflectionHeader}>
                <Trophy color={Colors.accent} size={20} />
                <Text style={styles.sectionTitle}>Wins this week</Text>
              </View>
              <TextInput
                style={styles.notesInput}
                value={wins}
                onChangeText={setWins}
                placeholder="What went well? What are you proud of?"
                placeholderTextColor={Colors.textTertiary}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </View>

            <View style={styles.section}>
              <View style={styles.reflectionHeader}>
                <AlertCircle color={Colors.coral} size={20} />
                <Text style={styles.sectionTitle}>Challenges</Text>
              </View>
              <TextInput
                style={styles.notesInput}
                value={challenges}
                onChangeText={setChallenges}
                placeholder="What was difficult? What can you improve?"
                placeholderTextColor={Colors.textTertiary}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </View>

            <TouchableOpacity style={styles.saveButton} onPress={handleSaveWeekly}>
              <Check color={Colors.textInverse} size={20} />
              <Text style={styles.saveButtonText}>Save Weekly Check-in</Text>
            </TouchableOpacity>
          </>
        )}

        {activeTab === 'hormones' && (
          <>
            <View style={styles.dateCard}>
              <Text style={styles.dateText}>{today}</Text>
              <View style={styles.cycleDayInput}>
                <Text style={styles.cycleDayLabel}>Cycle Day</Text>
                <TextInput
                  style={styles.cycleDayField}
                  value={cycleDay}
                  onChangeText={setCycleDay}
                  placeholder="—"
                  placeholderTextColor={Colors.textTertiary}
                  keyboardType="numeric"
                  maxLength={2}
                />
              </View>
            </View>

            <Text style={styles.sectionTitle}>Rate Your Symptoms</Text>
            <Text style={styles.sectionSubtitle}>0 = None, 4 = Severe</Text>

            {(Object.keys(groupedSymptoms) as SymptomCategory[]).map(category => (
              <View key={category} style={styles.categorySection}>
                <TouchableOpacity
                  style={styles.categoryHeader}
                  onPress={() => setExpandedCategory(expandedCategory === category ? null : category)}
                >
                  <View style={styles.categoryLeft}>
                    <Text style={styles.categoryIcon}>{categoryConfig[category].icon}</Text>
                    <Text style={styles.categoryLabel}>{categoryConfig[category].label}</Text>
                  </View>
                  <ChevronRight
                    color={Colors.textSecondary}
                    size={20}
                    style={{ transform: [{ rotate: expandedCategory === category ? '90deg' : '0deg' }] }}
                  />
                </TouchableOpacity>

                {expandedCategory === category && (
                  <View style={styles.hormoneSymptomsList}>
                    {groupedSymptoms[category].map(symptom => (
                      <View key={symptom.id} style={styles.hormoneSymptomItem}>
                        <View style={styles.hormoneSymptomInfo}>
                          <Text style={styles.hormoneSymptomName}>{symptom.name}</Text>
                          <Text style={styles.hormoneSymptomDescription}>{symptom.description}</Text>
                        </View>
                        {renderSeverityPicker(symptom.id, hormoneSymptomValues[symptom.id])}
                      </View>
                    ))}
                  </View>
                )}
              </View>
            ))}

            <View style={styles.notesSection}>
              <Text style={styles.notesLabel}>Notes (optional)</Text>
              <TextInput
                style={styles.notesInput}
                value={hormoneNotes}
                onChangeText={setHormoneNotes}
                placeholder="Any additional observations..."
                placeholderTextColor={Colors.textTertiary}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </View>

            {previewGuidance.length > 0 && (
              <View style={styles.previewSection}>
                <Text style={styles.previewTitle}>Quick Guidance</Text>
                {previewGuidance.map((g, i) => (
                  <View key={i} style={styles.previewItem}>
                    <View style={[styles.previewDot, { 
                      backgroundColor: g.dosageAction === 'decrease' ? '#EF5350' : 
                                       g.dosageAction === 'increase' ? '#4CAF50' : Colors.textTertiary 
                    }]} />
                    <Text style={styles.previewText}>
                      {g.hormone}: {g.dosageAction === 'decrease' ? 'Consider reducing' : 
                                   g.dosageAction === 'increase' ? 'Consider increasing' : 'Maintain'}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            <TouchableOpacity style={[styles.saveButton, { backgroundColor: '#AB47BC' }]} onPress={handleSaveHormones}>
              <Check color={Colors.textInverse} size={20} />
              <Text style={styles.saveButtonText}>Save Hormone Entry</Text>
            </TouchableOpacity>

            <View style={styles.disclaimer}>
              <AlertTriangle color={Colors.warning} size={14} />
              <Text style={styles.disclaimerText}>
                Guidance is for educational purposes. Consult your healthcare provider before adjusting supplementation.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
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
  headerDate: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
  },
  tabContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 10,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Colors.surfaceSecondary,
  },
  tabActive: {
    backgroundColor: Colors.primary,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  tabTextActive: {
    color: Colors.textInverse,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 120,
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
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 16,
  },
  symptomRow: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
  },
  symptomHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  symptomIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  symptomLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500' as const,
    color: Colors.text,
  },
  symptomValue: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  symptomValueText: {
    fontSize: 16,
    fontWeight: '700' as const,
  },
  slider: {
    width: '100%',
    height: 40,
  },
  notesInput: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    fontSize: 15,
    color: Colors.text,
    minHeight: 100,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  measurementGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  measurementCard: {
    width: '47%',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
  },
  measurementLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 8,
    marginBottom: 8,
  },
  measurementInput: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: Colors.text,
    textAlign: 'center',
    width: '100%',
  },
  reflectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.success,
    paddingVertical: 16,
    borderRadius: 14,
    gap: 8,
    marginTop: 8,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.textInverse,
  },
  dateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
  },
  dateText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  cycleDayInput: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cycleDayLabel: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  cycleDayField: {
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
    width: 50,
    textAlign: 'center',
  },
  categorySection: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    marginBottom: 12,
    overflow: 'hidden',
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  categoryLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  categoryIcon: {
    fontSize: 20,
  },
  categoryLabel: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  hormoneSymptomsList: {
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  hormoneSymptomItem: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  hormoneSymptomInfo: {
    marginBottom: 10,
  },
  hormoneSymptomName: {
    fontSize: 15,
    fontWeight: '500' as const,
    color: Colors.text,
    marginBottom: 2,
  },
  hormoneSymptomDescription: {
    fontSize: 12,
    color: Colors.textTertiary,
  },
  severityPicker: {
    flexDirection: 'row',
    gap: 8,
  },
  severityButton: {
    width: 40,
    height: 36,
    borderRadius: 8,
    backgroundColor: Colors.surfaceSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  severityButtonActive: {
    backgroundColor: Colors.primary,
  },
  severityButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  severityButtonTextActive: {
    color: Colors.textInverse,
  },
  notesSection: {
    marginTop: 8,
    marginBottom: 16,
  },
  notesLabel: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
    marginBottom: 8,
  },
  previewSection: {
    backgroundColor: '#F3E5F5',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  previewTitle: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#7B1FA2',
    marginBottom: 10,
  },
  previewItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  previewDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  previewText: {
    fontSize: 13,
    color: Colors.text,
  },
  disclaimer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FFF8E1',
    borderRadius: 12,
    padding: 14,
    gap: 10,
    marginTop: 16,
  },
  disclaimerText: {
    flex: 1,
    fontSize: 12,
    color: '#F57C00',
    lineHeight: 18,
  },
  supplementHeader: {
    marginBottom: 14,
  },
  supplementTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  supplementTitleInfo: {
    flex: 1,
  },
  supplementProgress: {
    fontSize: 13,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  supplementProgressBar: {
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.borderLight,
    overflow: 'hidden',
  },
  supplementProgressFill: {
    height: '100%',
    borderRadius: 2,
  },
  supplementItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  supplementItemCompleted: {
    backgroundColor: `${Colors.success}08`,
    borderColor: `${Colors.success}30`,
  },
  supplementCheckbox: {
    marginRight: 12,
  },
  checkboxChecked: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxUnchecked: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  supplementInfo: {
    flex: 1,
  },
  supplementName: {
    fontSize: 15,
    fontWeight: '500' as const,
    color: Colors.text,
    marginBottom: 2,
  },
  supplementNameCompleted: {
    color: Colors.textTertiary,
    textDecorationLine: 'line-through' as const,
  },
  supplementDetails: {
    fontSize: 12,
    color: Colors.textTertiary,
  },
  supplementTimingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.surfaceSecondary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  supplementTimingText: {
    fontSize: 11,
    color: Colors.textTertiary,
    fontWeight: '500' as const,
  },
  allDoneBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: `${Colors.success}12`,
    borderRadius: 10,
    paddingVertical: 10,
    marginTop: 4,
  },
  allDoneText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.success,
  },
});
