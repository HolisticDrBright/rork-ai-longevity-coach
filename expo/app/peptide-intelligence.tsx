import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Stack, router } from 'expo-router';
import {
  ArrowLeft,
  Sparkles,
  Shield,
  BarChart3,
  Syringe,
  FlaskConical,
  Calendar as CalendarIcon,
  Brain,
} from 'lucide-react-native';

import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import PeptideProtocolBuilder from '@/components/PeptideProtocolBuilder';
import PeptideSafetyPanel from '@/components/PeptideSafetyPanel';
import PeptideCorrelationDashboard from '@/components/PeptideCorrelationDashboard';
import PeptideDoseTracker from '@/components/PeptideDoseTracker';
import PeptideLabOptimization from '@/components/PeptideLabOptimization';
import PeptideProtocolCalendar from '@/components/PeptideProtocolCalendar';
import type { PeptideGoal, LabType, InteractionSeverity } from '@/types';

type TabId = 'builder' | 'safety' | 'correlations' | 'tracker' | 'calendar' | 'labs';

interface Tab {
  id: TabId;
  label: string;
  icon: any;
}

const TABS: Tab[] = [
  { id: 'builder', label: 'Builder', icon: Sparkles },
  { id: 'safety', label: 'Safety', icon: Shield },
  { id: 'correlations', label: 'Insights', icon: BarChart3 },
  { id: 'tracker', label: 'Tracker', icon: Syringe },
  { id: 'calendar', label: 'Calendar', icon: CalendarIcon },
  { id: 'labs', label: 'Labs', icon: FlaskConical },
];

export default function PeptideIntelligenceScreen() {
  const [activeTab, setActiveTab] = useState<TabId>('builder');
  const [selectedLabType, setSelectedLabType] = useState<LabType | undefined>(undefined);

  // Queries
  const activeProtocolQuery = trpc.peptide.getActiveProtocol.useQuery(undefined, {
    refetchOnMount: true,
  });
  const activeProtocol = activeProtocolQuery.data;
  const protocolId = activeProtocol?.id;

  const correlationsQuery = trpc.peptide.getCorrelations.useQuery(
    { protocolId: protocolId! },
    { enabled: !!protocolId }
  );

  const adherenceQuery = trpc.peptide.getAdherence.useQuery(
    { protocolId: protocolId!, days: 30 },
    { enabled: !!protocolId }
  );

  const phasesQuery = trpc.peptide.getPhases.useQuery(
    { protocolId: protocolId! },
    { enabled: !!protocolId }
  );

  const injectionHistoryQuery = trpc.peptide.getInjectionSiteHistory.useQuery(
    { protocolId: protocolId!, limit: 10 },
    { enabled: !!protocolId }
  );

  const labSuggestionsQuery = trpc.peptide.getLabOptimizationSuggestions.useQuery(
    selectedLabType ? { labType: selectedLabType } : {}
  );

  // Safety report for active protocol peptides
  const peptideSlugs = useMemo(() => {
    const pepList = (activeProtocol as any)?.protocol_peptides ?? [];
    return pepList.map((p: any) => p.peptide_library?.slug).filter(Boolean) as string[];
  }, [activeProtocol]);

  const safetyReportMutation = trpc.peptide.getFullSafetyReport.useMutation();
  const [safetyReport, setSafetyReport] = useState<any>(null);

  // Mutations
  const generateProtocolMutation = trpc.peptide.generateProtocol.useMutation();
  const saveProtocolMutation = trpc.peptide.saveProtocol.useMutation();
  const logDoseMutation = trpc.peptide.logDose.useMutation();
  const skipDoseMutation = trpc.peptide.skipDose.useMutation();

  const utils = trpc.useUtils();

  const runSafetyCheck = useCallback(async () => {
    if (peptideSlugs.length === 0) {
      setSafetyReport(null);
      return;
    }
    try {
      const report = await safetyReportMutation.mutateAsync({
        peptideSlugs,
        conditions: [],
        labValues: [],
      });
      setSafetyReport(report);
    } catch (e) {
      console.log('[Peptide] Safety check failed', e);
    }
  }, [peptideSlugs, safetyReportMutation]);

  // Auto-run safety check when the protocol's peptide list changes
  useEffect(() => {
    void runSafetyCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peptideSlugs.join(',')]);

  const handleGenerateProtocol = useCallback(async (goal: PeptideGoal) => {
    const result = await generateProtocolMutation.mutateAsync({ goal });
    return result;
  }, [generateProtocolMutation]);

  const handleSaveProtocol = useCallback(async (recommendation: any) => {
    const libraryItems = await utils.peptide.getLibrary.fetch({});
    const peptideMap = new Map((libraryItems ?? []).map((p: any) => [p.slug, p]));

    const peptides = recommendation.peptides
      .map((p: any) => {
        const lib: any = peptideMap.get(p.slug);
        if (!lib) return null;
        return {
          peptideId: lib.id,
          doseAmount: p.doseAmount,
          doseUnit: p.doseUnit,
          frequency: p.frequency,
          timing: p.timing,
          durationWeeks: p.durationWeeks,
          aiRationale: p.rationale,
          sortOrder: 0,
        };
      })
      .filter(Boolean);

    await saveProtocolMutation.mutateAsync({
      name: `${recommendation.goal.replace(/_/g, ' ')} protocol`,
      goal: recommendation.goal,
      aiReasoning: recommendation.reasoning,
      suggestedRetestTimeline: recommendation.suggestedRetestTimeline,
      peptides,
    });

    await utils.peptide.getActiveProtocol.invalidate();
    setActiveTab('tracker');
  }, [utils, saveProtocolMutation]);

  const handleLogDose = useCallback(async (protocolPeptideId: string, site?: string, notes?: string) => {
    if (!protocolId || !activeProtocol) return;
    const pepList = (activeProtocol as any).protocol_peptides ?? [];
    const target = pepList.find((p: any) => p.id === protocolPeptideId);
    if (!target) return;
    await logDoseMutation.mutateAsync({
      protocolId,
      protocolPeptideId,
      doseAmount: target.dose_amount,
      doseUnit: target.dose_unit,
      injectionSite: site,
      notes,
    });
    await utils.peptide.getAdherence.invalidate();
    await utils.peptide.getInjectionSiteHistory.invalidate();
  }, [protocolId, activeProtocol, logDoseMutation, utils]);

  const handleSkipDose = useCallback(async (protocolPeptideId: string, reason?: string) => {
    if (!protocolId || !activeProtocol) return;
    const pepList = (activeProtocol as any).protocol_peptides ?? [];
    const target = pepList.find((p: any) => p.id === protocolPeptideId);
    if (!target) return;
    await skipDoseMutation.mutateAsync({
      protocolId,
      protocolPeptideId,
      doseAmount: target.dose_amount,
      doseUnit: target.dose_unit,
      skipReason: reason,
    });
    await utils.peptide.getAdherence.invalidate();
  }, [protocolId, activeProtocol, skipDoseMutation, utils]);

  const handleStartLabProtocol = useCallback((mapping: any) => {
    Alert.alert(
      'Start Protocol',
      `Start a peptide protocol based on: ${mapping.findingDescription}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Build Protocol',
          onPress: () => setActiveTab('builder'),
        },
      ]
    );
  }, []);

  const trackerPeptides = useMemo(() => {
    const pepList = (activeProtocol as any)?.protocol_peptides ?? [];
    return pepList.map((p: any) => ({
      id: p.id,
      peptideName: p.peptide_library?.name ?? 'Unknown',
      doseAmount: p.dose_amount,
      doseUnit: p.dose_unit,
      frequency: p.frequency,
      timing: p.timing,
    }));
  }, [activeProtocol]);

  const correlationInsights = useMemo(() => {
    return (correlationsQuery.data ?? []).map((c: any) => ({
      metricName: c.metric_name,
      baselineValue: c.baseline_value,
      currentValue: c.current_value,
      changePercent: c.change_percent,
      direction: c.direction,
      confidence: c.confidence,
      aiExplanation: c.ai_explanation,
      insightType: c.insight_type,
    }));
  }, [correlationsQuery.data]);

  const recentSites = useMemo(() => {
    return (injectionHistoryQuery.data ?? [])
      .map((h: any) => h.injection_site)
      .filter(Boolean)
      .slice(0, 4);
  }, [injectionHistoryQuery.data]);

  const calendarPhases = useMemo(() => {
    return (phasesQuery.data ?? []).map((p: any) => ({
      id: p.id,
      phaseName: p.phase_name,
      phaseOrder: p.phase_order,
      phaseType: p.phase_type,
      startDate: p.start_date,
      endDate: p.end_date,
      durationDays: p.duration_days,
    }));
  }, [phasesQuery.data]);

  const labSuggestions = useMemo(() => {
    return (labSuggestionsQuery.data ?? []).map((m: any) => ({
      id: m.id,
      labType: m.lab_type,
      findingPattern: m.finding_pattern,
      findingDescription: m.finding_description,
      recommendedPeptideSlugs: m.recommended_peptide_slugs,
      recommendedPeptides: m.recommendedPeptides,
      priorityLevel: m.priority_level,
      reasoning: m.reasoning,
      prerequisiteNote: m.prerequisite_note,
    }));
  }, [labSuggestionsQuery.data]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Brain color={Colors.primary} size={22} />
          <Text style={styles.headerTitle}>Peptide Intelligence</Text>
        </View>
        <View style={styles.headerRight} />
      </View>

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
          return (
            <TouchableOpacity
              key={tab.id}
              style={[styles.tab, isActive && styles.tabActive]}
              onPress={() => setActiveTab(tab.id)}
            >
              <Icon color={isActive ? Colors.primary : Colors.textSecondary} size={16} />
              <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Loading State */}
      {activeProtocolQuery.isLoading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      )}

      {/* Tab Content */}
      {!activeProtocolQuery.isLoading && (
        <View style={styles.content}>
          {activeTab === 'builder' && (
            <PeptideProtocolBuilder
              onGenerateProtocol={handleGenerateProtocol}
              onSaveProtocol={handleSaveProtocol}
            />
          )}

          {activeTab === 'safety' && (
            <ScrollView style={styles.tabContent} contentContainerStyle={styles.tabContentInner}>
              {activeProtocol ? (
                <PeptideSafetyPanel
                  report={safetyReport}
                  loading={safetyReportMutation.isPending}
                />
              ) : (
                <EmptyState
                  icon={Shield}
                  title="No Active Protocol"
                  message="Build a protocol first to see safety checks."
                  action={() => setActiveTab('builder')}
                  actionLabel="Build Protocol"
                />
              )}
            </ScrollView>
          )}

          {activeTab === 'correlations' && (
            activeProtocol ? (
              <PeptideCorrelationDashboard
                insights={correlationInsights}
                protocolName={activeProtocol.name}
              />
            ) : (
              <ScrollView style={styles.tabContent} contentContainerStyle={styles.tabContentInner}>
                <EmptyState
                  icon={BarChart3}
                  title="No Active Protocol"
                  message="Start a protocol to track biomarker and wearable correlations over time."
                  action={() => setActiveTab('builder')}
                  actionLabel="Build Protocol"
                />
              </ScrollView>
            )
          )}

          {activeTab === 'tracker' && (
            activeProtocol ? (
              <PeptideDoseTracker
                peptides={trackerPeptides}
                adherence={adherenceQuery.data}
                onLogDose={handleLogDose}
                onSkipDose={handleSkipDose}
                recentSites={recentSites}
              />
            ) : (
              <ScrollView style={styles.tabContent} contentContainerStyle={styles.tabContentInner}>
                <EmptyState
                  icon={Syringe}
                  title="No Active Protocol"
                  message="Start a protocol to begin logging doses."
                  action={() => setActiveTab('builder')}
                  actionLabel="Build Protocol"
                />
              </ScrollView>
            )
          )}

          {activeTab === 'calendar' && (
            activeProtocol ? (
              <PeptideProtocolCalendar
                phases={calendarPhases}
                protocolStartDate={activeProtocol.start_date}
              />
            ) : (
              <ScrollView style={styles.tabContent} contentContainerStyle={styles.tabContentInner}>
                <EmptyState
                  icon={CalendarIcon}
                  title="No Active Protocol"
                  message="Build a protocol to see your cycling schedule and phase calendar."
                  action={() => setActiveTab('builder')}
                  actionLabel="Build Protocol"
                />
              </ScrollView>
            )
          )}

          {activeTab === 'labs' && (
            <PeptideLabOptimization
              suggestions={labSuggestions}
              onStartProtocol={handleStartLabProtocol}
              selectedLabType={selectedLabType}
              onLabTypeSelect={setSelectedLabType}
            />
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

function EmptyState({ icon: Icon, title, message, action, actionLabel }: {
  icon: any;
  title: string;
  message: string;
  action?: () => void;
  actionLabel?: string;
}) {
  return (
    <View style={styles.emptyState}>
      <Icon color={Colors.textTertiary} size={40} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyMessage}>{message}</Text>
      {action && actionLabel && (
        <TouchableOpacity style={styles.emptyButton} onPress={action}>
          <Text style={styles.emptyButtonText}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    backgroundColor: Colors.surface,
  },
  backButton: { padding: 6, width: 40 },
  headerTitleContainer: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.text },
  headerRight: { width: 40 },
  tabScroll: { maxHeight: 56, backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  tabRow: { paddingHorizontal: 12, gap: 8, alignItems: 'center' },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 20, backgroundColor: Colors.surfaceSecondary,
  },
  tabActive: { backgroundColor: Colors.primary + '15' },
  tabLabel: { fontSize: 13, fontWeight: '500', color: Colors.textSecondary },
  tabLabelActive: { color: Colors.primary, fontWeight: '600' },
  content: { flex: 1 },
  tabContent: { flex: 1 },
  tabContentInner: { padding: 16 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyState: { alignItems: 'center', padding: 40, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.text, marginTop: 8 },
  emptyMessage: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  emptyButton: {
    marginTop: 12, paddingHorizontal: 20, paddingVertical: 12,
    backgroundColor: Colors.primary, borderRadius: 10,
  },
  emptyButtonText: { fontSize: 15, fontWeight: '600', color: '#fff' },
});
