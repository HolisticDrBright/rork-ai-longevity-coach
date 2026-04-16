import { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Stack, router } from 'expo-router';
import {
  ArrowLeft,
  Sparkles,
  Calendar,
  PieChart,
  FileText,
  Play,
  RefreshCw,
} from 'lucide-react-native';

import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import LongevityIntakeForm from '@/components/LongevityIntakeForm';
import ProtocolTimeline from '@/components/ProtocolTimeline';
import MonthDetailView from '@/components/MonthDetailView';
import PulsingCalendar from '@/components/PulsingCalendar';
import HallmarksCoverage from '@/components/HallmarksCoverage';
import PractitionerReviewBanner from '@/components/PractitionerReviewBanner';

type TabId = 'intake' | 'timeline' | 'calendar' | 'hallmarks' | 'summary';

interface Tab {
  id: TabId;
  label: string;
  icon: any;
}

const TABS: Tab[] = [
  { id: 'intake', label: 'Intake', icon: FileText },
  { id: 'timeline', label: 'Timeline', icon: Calendar },
  { id: 'calendar', label: 'Pulsing', icon: Sparkles },
  { id: 'hallmarks', label: 'Hallmarks', icon: PieChart },
  { id: 'summary', label: 'Summary', icon: FileText },
];

export default function LongevityProtocolScreen() {
  const [activeTab, setActiveTab] = useState<TabId>('timeline');
  const [selectedMonth, setSelectedMonth] = useState(1);

  const intakeQuery = trpc.longevity.getLatestIntake.useQuery();
  const protocolQuery = trpc.longevity.getLatestProtocol.useQuery();

  const createIntakeMutation = trpc.longevity.createIntake.useMutation();
  const updateIntakeMutation = trpc.longevity.updateIntake.useMutation();
  const generateMutation = trpc.longevity.generateProtocol.useMutation();
  const updateStatusMutation = trpc.longevity.updateProtocolStatus.useMutation();
  const logProgressMutation = trpc.longevity.logProgress.useMutation();

  const utils = trpc.useUtils();

  const intake = intakeQuery.data;
  const protocol = protocolQuery.data;

  const months = useMemo(() => {
    if (!protocol?.months) return [];
    return Array.isArray(protocol.months) ? protocol.months : [];
  }, [protocol]);

  const summary = protocol?.summary;
  const pulsingCalendar = useMemo(() => {
    if (!protocol?.pulsing_calendar) return [];
    return Array.isArray(protocol.pulsing_calendar) ? protocol.pulsing_calendar : [];
  }, [protocol]);

  const handleIntakeSubmit = useCallback(async (data: any) => {
    try {
      let intakeId: string;
      if (intake) {
        const updated = await updateIntakeMutation.mutateAsync({ intakeId: intake.id, data });
        intakeId = updated.id;
      } else {
        const created = await createIntakeMutation.mutateAsync(data);
        intakeId = created.id;
      }

      await utils.longevity.getLatestIntake.invalidate();

      // Auto-generate protocol after intake submission
      await generateMutation.mutateAsync({ intakeId });
      await utils.longevity.getLatestProtocol.invalidate();

      setActiveTab('timeline');
      Alert.alert('Success', 'Your longevity protocol has been generated!');
    } catch (e) {
      Alert.alert('Error', 'Failed to generate protocol. Please try again.');
    }
  }, [intake, createIntakeMutation, updateIntakeMutation, generateMutation, utils]);

  const handleRegenerate = useCallback(async () => {
    if (!intake) return;
    Alert.alert(
      'Regenerate Protocol',
      'This will create a new version of your protocol based on your current intake data. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Regenerate',
          onPress: async () => {
            try {
              await generateMutation.mutateAsync({ intakeId: intake.id });
              await utils.longevity.getLatestProtocol.invalidate();
              Alert.alert('Done', 'Your protocol has been regenerated.');
            } catch {
              Alert.alert('Error', 'Failed to regenerate.');
            }
          },
        },
      ]
    );
  }, [intake, generateMutation, utils]);

  const handleActivate = useCallback(async () => {
    if (!protocol) return;
    try {
      await updateStatusMutation.mutateAsync({ protocolId: protocol.id, status: 'active' });
      await utils.longevity.getLatestProtocol.invalidate();
      Alert.alert('Activated', 'Your longevity protocol is now active. Track your progress daily.');
    } catch {
      Alert.alert('Error', 'Failed to activate.');
    }
  }, [protocol, updateStatusMutation, utils]);

  const handleLogItem = useCallback(async (itemKey: string, category: string, taken: boolean) => {
    if (!protocol) return;
    try {
      await logProgressMutation.mutateAsync({
        protocolId: protocol.id,
        month: selectedMonth,
        itemKey,
        itemCategory: category as any,
        taken,
      });
    } catch (e) {
      console.log('[Longevity] Failed to log progress', e);
    }
  }, [protocol, selectedMonth, logProgressMutation]);

  const currentMonth = months.find((m: any) => m.month === selectedMonth);
  const isLoading = intakeQuery.isLoading || protocolQuery.isLoading;

  return (
    <SafeAreaView style={styles.safeArea}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Sparkles color={Colors.primary} size={22} />
          <Text style={styles.headerTitle}>Longevity Protocol</Text>
        </View>
        <View style={styles.headerRight}>
          {protocol && (
            <TouchableOpacity onPress={handleRegenerate}>
              <RefreshCw color={Colors.primary} size={20} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Status bar */}
      {protocol && (
        <View style={styles.statusBar}>
          <View style={styles.statusLeft}>
            <Text style={styles.statusLabel}>Protocol v{protocol.version}</Text>
            <Text style={[styles.statusBadge, styles[`status_${protocol.status}` as keyof typeof styles] as any]}>
              {protocol.status.replace(/_/g, ' ').toUpperCase()}
            </Text>
          </View>
          {protocol.status !== 'active' && protocol.status !== 'completed' && (
            <TouchableOpacity style={styles.activateBtn} onPress={handleActivate}>
              <Play color="#fff" size={14} />
              <Text style={styles.activateBtnText}>Activate</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Practitioner review banner */}
      {protocol && (protocol.practitioner_review_required?.length > 0 || protocol.practitioner_approved) && (
        <PractitionerReviewBanner
          reviewItems={protocol.practitioner_review_required ?? []}
          approved={protocol.practitioner_approved}
          onRequestReview={() => Alert.alert('Review Requested', 'Your practitioner has been notified.')}
        />
      )}

      {/* Tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabScroll}
        contentContainerStyle={styles.tabRow}
      >
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          const isDisabled = tab.id !== 'intake' && !protocol;
          return (
            <TouchableOpacity
              key={tab.id}
              style={[styles.tab, isActive && styles.tabActive, isDisabled && styles.tabDisabled]}
              onPress={() => !isDisabled && setActiveTab(tab.id)}
              disabled={isDisabled}
            >
              <Icon color={isActive ? Colors.primary : isDisabled ? Colors.textTertiary : Colors.textSecondary} size={14} />
              <Text style={[styles.tabLabel, isActive && styles.tabLabelActive, isDisabled && styles.tabLabelDisabled]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Content */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <View style={styles.content}>
          {activeTab === 'intake' && (
            <LongevityIntakeForm
              onSubmit={handleIntakeSubmit}
              initialData={intake ? {
                biologicalAge: intake.biological_age ?? undefined,
                chronologicalAge: intake.chronological_age ?? undefined,
                weightCurrent: intake.weight_current ?? undefined,
                weightIdeal: intake.weight_ideal ?? undefined,
                height: intake.height ?? undefined,
                sex: intake.sex ?? undefined,
                menstrualStatus: intake.menstrual_status ?? undefined,
                fitnessLevel: intake.fitness_level ?? undefined,
                dietType: intake.diet_type ?? undefined,
                conditions: intake.conditions ?? [],
                sensitivities: intake.sensitivities ?? [],
                oppositions: intake.oppositions ?? [],
                longevityGoals: intake.longevity_goals ?? [],
                preferredBrands: intake.preferred_brands ?? [],
                modalities: intake.modalities ?? [],
                topComplaints: intake.top_complaints ?? [],
                lifestyleFactors: intake.lifestyle_factors ?? [],
                labs: intake.labs ?? {},
                notes: intake.notes ?? '',
              } : undefined}
            />
          )}

          {activeTab === 'timeline' && protocol && (
            <View style={{ flex: 1 }}>
              <ProtocolTimeline
                months={months}
                selectedMonth={selectedMonth}
                onSelectMonth={setSelectedMonth}
              />
              {currentMonth && (
                <MonthDetailView month={currentMonth} onLogItem={handleLogItem} />
              )}
            </View>
          )}

          {activeTab === 'calendar' && protocol && (
            <PulsingCalendar entries={pulsingCalendar} />
          )}

          {activeTab === 'hallmarks' && protocol && (
            <HallmarksCoverage months={months} />
          )}

          {activeTab === 'summary' && protocol && summary && (
            <ScrollView style={styles.summaryContainer} contentContainerStyle={styles.summaryContent}>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryTitle}>Target Biological Age Reduction</Text>
                <Text style={styles.summaryNumber}>
                  -{(summary as any).targetBiologicalAgeReduction ?? (summary as any).target_biological_age_reduction ?? 0} years
                </Text>
              </View>

              <View style={styles.summaryCard}>
                <Text style={styles.summarySection}>Primary Root Causes Identified</Text>
                {((summary as any).primaryRootCauses ?? (summary as any).primary_root_causes ?? []).map((c: string, i: number) => (
                  <Text key={i} style={styles.bulletItem}>• {c}</Text>
                ))}
              </View>

              <View style={styles.summaryCard}>
                <Text style={styles.summarySection}>Expected Outcomes</Text>
                {((summary as any).expectedOutcomes ?? (summary as any).expected_outcomes ?? []).map((c: string, i: number) => (
                  <Text key={i} style={styles.bulletItem}>• {c}</Text>
                ))}
              </View>

              {((summary as any).contraindicationsFlagged ?? (summary as any).contraindications_flagged ?? []).length > 0 && (
                <View style={[styles.summaryCard, styles.warningCard]}>
                  <Text style={[styles.summarySection, { color: Colors.danger }]}>⚠ Contraindications Flagged</Text>
                  {((summary as any).contraindicationsFlagged ?? (summary as any).contraindications_flagged ?? []).map((c: string, i: number) => (
                    <Text key={i} style={styles.bulletItem}>• {c}</Text>
                  ))}
                </View>
              )}

              <View style={styles.summaryCard}>
                <Text style={styles.summarySection}>Safety Notes</Text>
                {(protocol.safety_notes ?? []).map((s: string, i: number) => (
                  <Text key={i} style={[styles.bulletItem, { fontSize: 11, color: Colors.textTertiary }]}>• {s}</Text>
                ))}
              </View>
            </ScrollView>
          )}

          {!protocol && activeTab !== 'intake' && (
            <View style={styles.emptyState}>
              <Sparkles color={Colors.textTertiary} size={40} />
              <Text style={styles.emptyTitle}>No Protocol Yet</Text>
              <Text style={styles.emptyMessage}>
                Complete the intake form to generate your personalized 6-month longevity protocol.
              </Text>
              <TouchableOpacity
                style={styles.emptyButton}
                onPress={() => setActiveTab('intake')}
              >
                <Text style={styles.emptyButtonText}>Start Intake</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {generateMutation.isPending && (
        <View style={styles.generatingOverlay}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.generatingText}>Generating your personalized protocol...</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
    backgroundColor: Colors.surface,
  },
  backButton: { padding: 6, width: 40 },
  headerTitleContainer: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.text },
  headerRight: { width: 40, alignItems: 'flex-end' },
  statusBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: Colors.surfaceSecondary,
  },
  statusLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusLabel: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  statusBadge: {
    fontSize: 10, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 4, overflow: 'hidden',
  },
  status_draft: { backgroundColor: Colors.textTertiary + '20', color: Colors.textTertiary } as any,
  status_pending_review: { backgroundColor: Colors.warning + '20', color: Colors.warning } as any,
  status_approved: { backgroundColor: Colors.success + '20', color: Colors.success } as any,
  status_active: { backgroundColor: Colors.primary + '20', color: Colors.primary } as any,
  status_completed: { backgroundColor: Colors.accent + '20', color: Colors.accent } as any,
  status_archived: { backgroundColor: Colors.textTertiary + '20', color: Colors.textTertiary } as any,
  activateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: Colors.primary, borderRadius: 6,
  },
  activateBtnText: { fontSize: 12, fontWeight: '600', color: '#fff' },
  tabScroll: { maxHeight: 50, backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  tabRow: { paddingHorizontal: 12, gap: 6, alignItems: 'center' },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20,
    backgroundColor: Colors.surfaceSecondary,
  },
  tabActive: { backgroundColor: Colors.primary + '15' },
  tabDisabled: { opacity: 0.4 },
  tabLabel: { fontSize: 12, fontWeight: '500', color: Colors.textSecondary },
  tabLabelActive: { color: Colors.primary, fontWeight: '700' },
  tabLabelDisabled: { color: Colors.textTertiary },
  content: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyState: { alignItems: 'center', padding: 40, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.text, marginTop: 8 },
  emptyMessage: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  emptyButton: {
    marginTop: 12, paddingHorizontal: 24, paddingVertical: 12,
    backgroundColor: Colors.primary, borderRadius: 10,
  },
  emptyButtonText: { fontSize: 15, fontWeight: '600', color: '#fff' },
  summaryContainer: { flex: 1 },
  summaryContent: { padding: 16, gap: 12 },
  summaryCard: {
    backgroundColor: Colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
    padding: 14, gap: 6,
  },
  warningCard: { borderColor: Colors.danger + '40', backgroundColor: Colors.danger + '08' },
  summaryTitle: { fontSize: 13, color: Colors.textSecondary },
  summaryNumber: { fontSize: 32, fontWeight: '800', color: Colors.primary, marginTop: 4 },
  summarySection: { fontSize: 14, fontWeight: '700', color: Colors.text, marginBottom: 4 },
  bulletItem: { fontSize: 13, color: Colors.text, lineHeight: 20 },
  generatingOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.9)',
    justifyContent: 'center', alignItems: 'center', gap: 16,
  },
  generatingText: { fontSize: 15, color: Colors.text, fontWeight: '500' },
});
