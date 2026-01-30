import { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import {
  Heart,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  Check,
  ChevronRight,
  Calendar,
  Plus,
  History,
  Sparkles,
} from 'lucide-react-native';

import Colors from '@/constants/colors';
import { useHormones, hormoneSymptoms } from '@/providers/HormoneProvider';
import { HormoneEntry, HormoneGuidance } from '@/types';

type SymptomCategory = 'high_testosterone_dhea' | 'low_progesterone' | 'low_estrogen' | 'high_estrogen';

const categoryConfig: Record<SymptomCategory, { label: string; color: string; icon: string }> = {
  high_testosterone_dhea: { label: 'High Testosterone/DHEA', color: '#E76F51', icon: '⚡' },
  low_progesterone: { label: 'Low Progesterone', color: '#AB47BC', icon: '🌙' },
  low_estrogen: { label: 'Low Estrogen', color: '#4A90D9', icon: '💧' },
  high_estrogen: { label: 'High Estrogen', color: '#F4A261', icon: '🌸' },
};

const severityLabels = ['None', 'Mild', 'Moderate', 'Significant', 'Severe'];

export default function HormonesScreen() {
  const {
    todayEntry,
    recentEntries,
    currentGuidance,
    addEntry,
    updateEntry,
    getGuidance,
  } = useHormones();

  const [activeTab, setActiveTab] = useState<'log' | 'guidance' | 'history'>('log');
  const [cycleDay, setCycleDay] = useState(todayEntry?.cycleDay?.toString() || '');
  const [notes, setNotes] = useState(todayEntry?.notes || '');
  const [symptoms, setSymptoms] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    hormoneSymptoms.forEach(s => {
      const existing = todayEntry?.symptoms.find(ts => ts.symptomId === s.id);
      initial[s.id] = existing?.severity || 0;
    });
    return initial;
  });
  const [expandedCategory, setExpandedCategory] = useState<SymptomCategory | null>('high_testosterone_dhea');

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const handleSymptomChange = useCallback(async (symptomId: string, severity: number) => {
    await Haptics.selectionAsync();
    setSymptoms(prev => ({ ...prev, [symptomId]: severity }));
  }, []);

  const handleSave = useCallback(async () => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    
    const symptomArray = Object.entries(symptoms)
      .filter(([_, severity]) => severity > 0)
      .map(([symptomId, severity]) => ({ symptomId, severity }));

    const entry: Omit<HormoneEntry, 'id'> = {
      date: new Date().toISOString().split('T')[0],
      cycleDay: cycleDay ? parseInt(cycleDay) : undefined,
      symptoms: symptomArray,
      notes: notes || undefined,
    };

    if (todayEntry) {
      updateEntry(todayEntry.id, entry);
    } else {
      addEntry(entry);
    }
  }, [symptoms, cycleDay, notes, todayEntry, addEntry, updateEntry]);

  const previewGuidance = useMemo(() => {
    const symptomArray = Object.entries(symptoms)
      .filter(([_, severity]) => severity > 0)
      .map(([symptomId, severity]) => ({ symptomId, severity }));

    if (symptomArray.length === 0) return [];

    const mockEntry: HormoneEntry = {
      id: 'preview',
      date: new Date().toISOString().split('T')[0],
      symptoms: symptomArray,
    };

    return getGuidance(mockEntry);
  }, [symptoms, getGuidance]);

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
          onPress={() => handleSymptomChange(symptomId, level)}
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
  ), [handleSymptomChange]);

  const renderGuidanceCard = useCallback((guidance: HormoneGuidance, index: number) => {
    const getActionIcon = () => {
      switch (guidance.dosageAction) {
        case 'increase': return <TrendingUp color="#4CAF50" size={20} />;
        case 'decrease': return <TrendingDown color="#EF5350" size={20} />;
        case 'consult': return <AlertTriangle color="#FF9800" size={20} />;
        default: return <Minus color={Colors.textSecondary} size={20} />;
      }
    };

    const getStatusColor = () => {
      if (guidance.status === 'high') return '#EF5350';
      if (guidance.status === 'low') return '#4A90D9';
      return '#4CAF50';
    };

    const getActionLabel = () => {
      switch (guidance.dosageAction) {
        case 'increase': return 'Consider Increasing';
        case 'decrease': return 'Consider Reducing';
        case 'consult': return 'Monitor Closely';
        default: return 'Maintain Current';
      }
    };

    return (
      <View key={index} style={styles.guidanceCard}>
        <View style={styles.guidanceHeader}>
          <View style={styles.guidanceHormone}>
            <View style={[styles.statusDot, { backgroundColor: getStatusColor() }]} />
            <Text style={styles.guidanceHormoneText}>{guidance.hormone}</Text>
          </View>
          <View style={[styles.scoreChip, { backgroundColor: `${getStatusColor()}15` }]}>
            <Text style={[styles.scoreText, { color: getStatusColor() }]}>
              {guidance.score}% symptom score
            </Text>
          </View>
        </View>

        <View style={styles.actionRow}>
          {getActionIcon()}
          <Text style={styles.actionLabel}>{getActionLabel()}</Text>
        </View>

        <Text style={styles.guidanceRecommendation}>{guidance.recommendation}</Text>

        <View style={styles.supplementsRow}>
          <Text style={styles.supplementsLabel}>Related supplements:</Text>
          <View style={styles.supplementTags}>
            {guidance.supplements.slice(0, 3).map((supp, i) => (
              <View key={i} style={styles.supplementTag}>
                <Text style={styles.supplementTagText}>{supp}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>
    );
  }, []);

  const renderHistoryEntry = useCallback((entry: HormoneEntry, index: number) => {
    const entryGuidance = getGuidance(entry);
    const date = new Date(entry.date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });

    return (
      <View key={entry.id} style={styles.historyCard}>
        <View style={styles.historyHeader}>
          <View style={styles.historyDate}>
            <Calendar color={Colors.primary} size={16} />
            <Text style={styles.historyDateText}>{date}</Text>
            {entry.cycleDay && (
              <Text style={styles.cycleDayBadge}>Day {entry.cycleDay}</Text>
            )}
          </View>
          <Text style={styles.symptomCount}>
            {entry.symptoms.length} symptom{entry.symptoms.length !== 1 ? 's' : ''}
          </Text>
        </View>

        {entryGuidance.length > 0 && (
          <View style={styles.historyGuidance}>
            {entryGuidance.map((g, i) => (
              <View key={i} style={styles.miniGuidance}>
                <View style={[
                  styles.miniStatusDot,
                  { backgroundColor: g.status === 'high' ? '#EF5350' : g.status === 'low' ? '#4A90D9' : '#4CAF50' }
                ]} />
                <Text style={styles.miniGuidanceText}>{g.hormone}</Text>
                <Text style={[
                  styles.miniAction,
                  { color: g.dosageAction === 'decrease' ? '#EF5350' : 
                           g.dosageAction === 'increase' ? '#4CAF50' : Colors.textSecondary }
                ]}>
                  {g.dosageAction === 'decrease' ? '↓' : g.dosageAction === 'increase' ? '↑' : '—'}
                </Text>
              </View>
            ))}
          </View>
        )}

        {entry.notes && (
          <Text style={styles.historyNotes} numberOfLines={2}>{entry.notes}</Text>
        )}
      </View>
    );
  }, [getGuidance]);

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#AB47BC', '#7B1FA2']}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={['top']}>
          <View style={styles.header}>
            <Heart color={Colors.textInverse} size={24} />
            <Text style={styles.headerTitle}>Hormone Tracker</Text>
            <Text style={styles.headerSubtitle}>Track symptoms & get dosage guidance</Text>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'log' && styles.tabActive]}
          onPress={() => setActiveTab('log')}
        >
          <Plus color={activeTab === 'log' ? Colors.textInverse : Colors.textSecondary} size={16} />
          <Text style={[styles.tabText, activeTab === 'log' && styles.tabTextActive]}>
            Log
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'guidance' && styles.tabActive]}
          onPress={() => setActiveTab('guidance')}
        >
          <Sparkles color={activeTab === 'guidance' ? Colors.textInverse : Colors.textSecondary} size={16} />
          <Text style={[styles.tabText, activeTab === 'guidance' && styles.tabTextActive]}>
            Guidance
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'history' && styles.tabActive]}
          onPress={() => setActiveTab('history')}
        >
          <History color={activeTab === 'history' ? Colors.textInverse : Colors.textSecondary} size={16} />
          <Text style={[styles.tabText, activeTab === 'history' && styles.tabTextActive]}>
            History
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {activeTab === 'log' && (
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

            <Text style={styles.sectionTitle}>Rate Your Symptoms Today</Text>
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
                  <View style={styles.symptomsList}>
                    {groupedSymptoms[category].map(symptom => (
                      <View key={symptom.id} style={styles.symptomItem}>
                        <View style={styles.symptomInfo}>
                          <Text style={styles.symptomName}>{symptom.name}</Text>
                          <Text style={styles.symptomDescription}>{symptom.description}</Text>
                        </View>
                        {renderSeverityPicker(symptom.id, symptoms[symptom.id])}
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
                value={notes}
                onChangeText={setNotes}
                placeholder="Any additional observations..."
                placeholderTextColor={Colors.textTertiary}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </View>

            {previewGuidance.length > 0 && (
              <View style={styles.previewSection}>
                <Text style={styles.previewTitle}>Quick Preview</Text>
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

            <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
              <Check color={Colors.textInverse} size={20} />
              <Text style={styles.saveButtonText}>Save Entry</Text>
            </TouchableOpacity>
          </>
        )}

        {activeTab === 'guidance' && (
          <>
            <View style={styles.guidanceIntro}>
              <Sparkles color="#AB47BC" size={24} />
              <Text style={styles.guidanceIntroTitle}>Dosage Guidance</Text>
              <Text style={styles.guidanceIntroText}>
                Based on your logged symptoms, here are personalized recommendations for adjusting your hormone supplementation.
              </Text>
            </View>

            {previewGuidance.length > 0 ? (
              previewGuidance.map(renderGuidanceCard)
            ) : currentGuidance.length > 0 ? (
              currentGuidance.map(renderGuidanceCard)
            ) : (
              <View style={styles.emptyState}>
                <Heart color={Colors.textTertiary} size={48} />
                <Text style={styles.emptyTitle}>No Symptoms Logged</Text>
                <Text style={styles.emptyText}>
                  Log your daily symptoms to receive personalized hormone dosage guidance.
                </Text>
                <TouchableOpacity
                  style={styles.emptyButton}
                  onPress={() => setActiveTab('log')}
                >
                  <Text style={styles.emptyButtonText}>Log Symptoms</Text>
                </TouchableOpacity>
              </View>
            )}

            <View style={styles.disclaimer}>
              <AlertTriangle color={Colors.warning} size={16} />
              <Text style={styles.disclaimerText}>
                This guidance is for educational purposes only. Always consult your healthcare provider before adjusting hormone supplementation.
              </Text>
            </View>
          </>
        )}

        {activeTab === 'history' && (
          <>
            {recentEntries.length > 0 ? (
              <>
                <Text style={styles.historyTitle}>Recent Entries</Text>
                {recentEntries.map(renderHistoryEntry)}
              </>
            ) : (
              <View style={styles.emptyState}>
                <History color={Colors.textTertiary} size={48} />
                <Text style={styles.emptyTitle}>No History Yet</Text>
                <Text style={styles.emptyText}>
                  Start logging your daily symptoms to build your hormone tracking history.
                </Text>
                <TouchableOpacity
                  style={styles.emptyButton}
                  onPress={() => setActiveTab('log')}
                >
                  <Text style={styles.emptyButtonText}>Log First Entry</Text>
                </TouchableOpacity>
              </View>
            )}
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
  headerSubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.85)',
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
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: Colors.surfaceSecondary,
    gap: 6,
  },
  tabActive: {
    backgroundColor: '#AB47BC',
  },
  tabText: {
    fontSize: 13,
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
    paddingBottom: 40,
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
  symptomsList: {
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  symptomItem: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  symptomInfo: {
    marginBottom: 10,
  },
  symptomName: {
    fontSize: 15,
    fontWeight: '500' as const,
    color: Colors.text,
    marginBottom: 2,
  },
  symptomDescription: {
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
  notesInput: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    fontSize: 15,
    color: Colors.text,
    minHeight: 80,
    borderWidth: 1,
    borderColor: Colors.border,
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
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#AB47BC',
    paddingVertical: 16,
    borderRadius: 14,
    gap: 8,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.textInverse,
  },
  guidanceIntro: {
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 24,
    marginBottom: 20,
  },
  guidanceIntroTitle: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: Colors.text,
    marginTop: 12,
    marginBottom: 8,
  },
  guidanceIntroText: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  guidanceCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 18,
    marginBottom: 14,
  },
  guidanceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  guidanceHormone: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  guidanceHormoneText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  scoreChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  scoreText: {
    fontSize: 12,
    fontWeight: '600' as const,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    backgroundColor: Colors.surfaceSecondary,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  actionLabel: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  guidanceRecommendation: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: 14,
  },
  supplementsRow: {
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    paddingTop: 12,
  },
  supplementsLabel: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginBottom: 8,
  },
  supplementTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  supplementTag: {
    backgroundColor: '#F3E5F5',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
  },
  supplementTagText: {
    fontSize: 12,
    color: '#7B1FA2',
    fontWeight: '500' as const,
  },
  disclaimer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FFF8E1',
    borderRadius: 12,
    padding: 14,
    gap: 10,
    marginTop: 8,
  },
  disclaimerText: {
    flex: 1,
    fontSize: 12,
    color: '#F57C00',
    lineHeight: 18,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: Colors.text,
    marginTop: 16,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 32,
    marginBottom: 20,
  },
  emptyButton: {
    backgroundColor: '#AB47BC',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  emptyButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.textInverse,
  },
  historyTitle: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 16,
  },
  historyCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  historyDate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  historyDateText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  cycleDayBadge: {
    fontSize: 12,
    color: '#AB47BC',
    backgroundColor: '#F3E5F5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    fontWeight: '500' as const,
  },
  symptomCount: {
    fontSize: 13,
    color: Colors.textTertiary,
  },
  historyGuidance: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 10,
  },
  miniGuidance: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.surfaceSecondary,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  miniStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  miniGuidanceText: {
    fontSize: 12,
    color: Colors.text,
    fontWeight: '500' as const,
  },
  miniAction: {
    fontSize: 14,
    fontWeight: '700' as const,
  },
  historyNotes: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontStyle: 'italic',
  },
});
