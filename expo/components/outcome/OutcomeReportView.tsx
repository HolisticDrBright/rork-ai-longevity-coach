import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Share2, FileDown, Activity, Heart, Flame, FlaskConical, User, CheckCircle2 } from 'lucide-react-native';
import Colors from '@/constants/colors';
import TruAgeHero from './TruAgeHero';
import DeltaBar, { DeltaLike } from './DeltaBar';

interface OutcomeReport {
  dataCompletenessPct: number;
  biologicalAge: any;
  inflammation: { crp?: DeltaLike; il6?: DeltaLike; homocysteine?: DeltaLike; compositeScore?: DeltaLike };
  wearables: Record<string, DeltaLike | undefined>;
  bodyComp: Record<string, DeltaLike | undefined>;
  labShifts: any;
  adherence: any;
  patientReported: any;
  narrative: { topWins: string[]; topGaps: string[]; maintenanceRecommendation: string };
}

interface Props {
  report: OutcomeReport;
  narrativeSummary?: string;
  approved?: boolean;
  onShare?: () => void;
  onExportPdf?: () => void;
}

function CategoryCard({ icon: Icon, title, tint, children }: {
  icon: any; title: string; tint: string; children: React.ReactNode;
}) {
  return (
    <View style={styles.categoryCard}>
      <View style={styles.categoryHeader}>
        <View style={[styles.categoryIcon, { backgroundColor: tint + '20' }]}>
          <Icon color={tint} size={16} />
        </View>
        <Text style={styles.categoryTitle}>{title}</Text>
      </View>
      <View style={styles.categoryBody}>{children}</View>
    </View>
  );
}

export default function OutcomeReportView({ report, narrativeSummary, onShare, onExportPdf }: Props) {
  const ba = report.biologicalAge;
  const infl = report.inflammation;
  const w = report.wearables;
  const bc = report.bodyComp;
  const adh = report.adherence;
  const pr = report.patientReported;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {/* Data completeness indicator */}
      <View style={styles.completenessBar}>
        <Text style={styles.completenessLabel}>
          Report built from {report.dataCompletenessPct}% of expected data.
        </Text>
      </View>

      {/* Hero */}
      <TruAgeHero
        baseline={ba.baselineTruAge}
        current={ba.currentTruAge}
        deltaYears={ba.deltaYears}
        targetDeltaYears={ba.targetDeltaYears}
        direction={ba.direction}
        organs={ba.organs ?? []}
      />

      {/* Top wins banner */}
      {report.narrative.topWins.length > 0 && (
        <View style={styles.winsCard}>
          <View style={styles.winsHeader}>
            <CheckCircle2 color={Colors.success} size={18} />
            <Text style={styles.winsTitle}>Top wins</Text>
          </View>
          {report.narrative.topWins.map((w, i) => (
            <Text key={i} style={styles.winItem}>• {w}</Text>
          ))}
        </View>
      )}

      {/* Inflammation */}
      <CategoryCard icon={Flame} title="Inflammation" tint="#EF4444">
        {infl.crp && <DeltaBar delta={infl.crp} />}
        {infl.il6 && <DeltaBar delta={infl.il6} />}
        {infl.homocysteine && <DeltaBar delta={infl.homocysteine} />}
        {infl.compositeScore && <DeltaBar delta={infl.compositeScore} />}
      </CategoryCard>

      {/* Wearables */}
      <CategoryCard icon={Activity} title="Wearables (14-day avg)" tint="#3B82F6">
        {w.hrv && <DeltaBar delta={w.hrv} />}
        {w.restingHr && <DeltaBar delta={w.restingHr} />}
        {w.deepSleepPct && <DeltaBar delta={w.deepSleepPct} />}
        {w.remSleepPct && <DeltaBar delta={w.remSleepPct} />}
        {w.sleepEfficiency && <DeltaBar delta={w.sleepEfficiency} />}
        {w.spo2Mean && <DeltaBar delta={w.spo2Mean} />}
        {w.vo2Max && <DeltaBar delta={w.vo2Max} />}
      </CategoryCard>

      {/* Body composition */}
      <CategoryCard icon={Heart} title="Body composition" tint="#EC4899">
        {bc.weight && <DeltaBar delta={bc.weight} />}
        {bc.bodyFatPct && <DeltaBar delta={bc.bodyFatPct} />}
        {bc.leanMass && <DeltaBar delta={bc.leanMass} />}
        {bc.waistToHipRatio && <DeltaBar delta={bc.waistToHipRatio} />}
      </CategoryCard>

      {/* Functional labs */}
      <CategoryCard icon={FlaskConical} title="Functional labs" tint="#8B5CF6">
        {report.labShifts.nutrEval && (
          <View style={styles.labBlock}>
            <Text style={styles.labBlockTitle}>NutrEval</Text>
            <Text style={styles.labLabel}>Corrected deficiencies ({report.labShifts.nutrEval.correctedDeficiencies.length})</Text>
            {report.labShifts.nutrEval.correctedDeficiencies.map((d: string, i: number) => (
              <Text key={`c-${i}`} style={styles.labItemPositive}>✓ {d}</Text>
            ))}
            {report.labShifts.nutrEval.correctedDeficiencies.length === 0 && (
              <Text style={styles.labItem}>None yet corrected.</Text>
            )}
            <Text style={[styles.labLabel, { marginTop: 8 }]}>
              Remaining deficiencies ({report.labShifts.nutrEval.remainingDeficiencies.length})
            </Text>
            {report.labShifts.nutrEval.remainingDeficiencies.map((d: string, i: number) => (
              <Text key={`r-${i}`} style={styles.labItem}>• {d}</Text>
            ))}
          </View>
        )}
        {report.labShifts.dutch && (
          <View style={styles.labBlock}>
            <Text style={styles.labBlockTitle}>DUTCH</Text>
            <Text style={styles.labItem}>
              Cortisol rhythm: {report.labShifts.dutch.baselineCortisolRhythm ?? '—'} → {report.labShifts.dutch.currentCortisolRhythm ?? '—'}
              {report.labShifts.dutch.normalized ? ' (normalized)' : ''}
            </Text>
          </View>
        )}
        {report.labShifts.giMap && (
          <View style={styles.labBlock}>
            <Text style={styles.labBlockTitle}>GI-MAP</Text>
            <Text style={styles.labItem}>
              Resolved: {report.labShifts.giMap.resolvedMarkers.length} · Persistent: {report.labShifts.giMap.persistentMarkers.length}
            </Text>
          </View>
        )}
      </CategoryCard>

      {/* Patient-reported */}
      <CategoryCard icon={User} title="Patient-reported" tint="#14B8A6">
        {pr.energy && (
          <DeltaBar delta={{ label: 'Energy (1-10)', baseline: pr.energy.baseline, current: pr.energy.current, deltaPercent: undefined, direction: pr.energy.delta > 0 ? 'improved' : pr.energy.delta < 0 ? 'declined' : 'stable', sentiment: pr.energy.delta >= 0 ? 'positive' : 'negative' }} />
        )}
        {pr.sleepQuality && (
          <DeltaBar delta={{ label: 'Sleep quality (1-10)', baseline: pr.sleepQuality.baseline, current: pr.sleepQuality.current, direction: pr.sleepQuality.delta > 0 ? 'improved' : pr.sleepQuality.delta < 0 ? 'declined' : 'stable', sentiment: pr.sleepQuality.delta >= 0 ? 'positive' : 'negative' }} />
        )}
        {pr.cognitiveFunction && (
          <DeltaBar delta={{ label: 'Cognition (1-10)', baseline: pr.cognitiveFunction.baseline, current: pr.cognitiveFunction.current, direction: pr.cognitiveFunction.delta > 0 ? 'improved' : pr.cognitiveFunction.delta < 0 ? 'declined' : 'stable', sentiment: pr.cognitiveFunction.delta >= 0 ? 'positive' : 'negative' }} />
        )}
        {pr.complaintsResolution?.length > 0 && (
          <View style={{ marginTop: 10, gap: 4 }}>
            <Text style={styles.labLabel}>Top complaints</Text>
            {pr.complaintsResolution.map((c: any, i: number) => (
              <Text key={i} style={
                c.status === 'resolved' ? styles.labItemPositive :
                c.status === 'worsened' ? styles.labItemNegative : styles.labItem
              }>
                {c.status === 'resolved' ? '✓ ' : c.status === 'improved' ? '↗ ' : c.status === 'worsened' ? '↓ ' : '· '}
                {c.complaint} ({c.status})
              </Text>
            ))}
          </View>
        )}
      </CategoryCard>

      {/* Adherence */}
      <CategoryCard icon={CheckCircle2} title="Adherence" tint="#10B981">
        {adh.overallPct != null && (
          <Text style={styles.adherenceOverall}>
            Overall: {adh.overallPct}% ({adh.totalDosesTaken}/{adh.totalDosesScheduled} items)
          </Text>
        )}
        <View style={styles.adherenceGrid}>
          {[
            { key: 'supplementPct', label: 'Supplements' },
            { key: 'peptidePct', label: 'Peptides' },
            { key: 'fastingPct', label: 'Fasting' },
            { key: 'exercisePct', label: 'Exercise' },
          ].map(cell => (
            <View key={cell.key} style={styles.adherenceCell}>
              <Text style={styles.adherenceLabel}>{cell.label}</Text>
              <Text style={styles.adherenceValue}>
                {adh[cell.key] != null ? `${adh[cell.key]}%` : '—'}
              </Text>
            </View>
          ))}
        </View>
      </CategoryCard>

      {/* Narrative */}
      {narrativeSummary && (
        <View style={styles.narrativeCard}>
          <Text style={styles.narrativeTitle}>Summary</Text>
          <Text style={styles.narrativeBody}>{narrativeSummary}</Text>
        </View>
      )}

      {/* Gaps */}
      {report.narrative.topGaps.length > 0 && (
        <View style={styles.gapsCard}>
          <Text style={styles.gapsTitle}>Focus areas</Text>
          {report.narrative.topGaps.map((g, i) => (
            <Text key={i} style={styles.gapItem}>• {g}</Text>
          ))}
        </View>
      )}

      {/* Actions */}
      {(onShare || onExportPdf) && (
        <View style={styles.actionsRow}>
          {onShare && (
            <TouchableOpacity style={styles.actionBtn} onPress={onShare}>
              <Share2 color={Colors.primary} size={18} />
              <Text style={styles.actionText}>Share</Text>
            </TouchableOpacity>
          )}
          {onExportPdf && (
            <TouchableOpacity style={styles.actionBtn} onPress={onExportPdf}>
              <FileDown color={Colors.primary} size={18} />
              <Text style={styles.actionText}>Export PDF</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 14, gap: 12, paddingBottom: 40 },
  completenessBar: {
    backgroundColor: Colors.surfaceSecondary, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  completenessLabel: { fontSize: 11, color: Colors.textSecondary },
  winsCard: {
    backgroundColor: Colors.success + '10', borderRadius: 12,
    borderWidth: 1, borderColor: Colors.success + '30', padding: 14, gap: 6,
  },
  winsHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  winsTitle: { fontSize: 14, fontWeight: '700', color: Colors.success },
  winItem: { fontSize: 13, color: Colors.text, lineHeight: 20 },
  categoryCard: {
    backgroundColor: Colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
  },
  categoryHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8,
  },
  categoryIcon: { width: 30, height: 30, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  categoryTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
  categoryBody: { paddingHorizontal: 14, paddingBottom: 6 },
  labBlock: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.borderLight, gap: 4 },
  labBlockTitle: { fontSize: 13, fontWeight: '700', color: Colors.text, marginBottom: 4 },
  labLabel: { fontSize: 11, fontWeight: '600', color: Colors.textSecondary, textTransform: 'uppercase' },
  labItem: { fontSize: 12, color: Colors.text, lineHeight: 18 },
  labItemPositive: { fontSize: 12, color: Colors.success, lineHeight: 18 },
  labItemNegative: { fontSize: 12, color: Colors.danger, lineHeight: 18 },
  adherenceOverall: { fontSize: 14, fontWeight: '700', color: Colors.primary, marginBottom: 8 },
  adherenceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  adherenceCell: { flex: 1, minWidth: 80, padding: 8, backgroundColor: Colors.surfaceSecondary, borderRadius: 8 },
  adherenceLabel: { fontSize: 11, color: Colors.textSecondary },
  adherenceValue: { fontSize: 18, fontWeight: '700', color: Colors.text, marginTop: 2 },
  narrativeCard: {
    backgroundColor: Colors.primary + '08', borderRadius: 12,
    borderWidth: 1, borderColor: Colors.primary + '30', padding: 14, gap: 8,
  },
  narrativeTitle: { fontSize: 14, fontWeight: '700', color: Colors.primary },
  narrativeBody: { fontSize: 13, color: Colors.text, lineHeight: 20 },
  gapsCard: {
    backgroundColor: Colors.warning + '10', borderRadius: 12,
    borderWidth: 1, borderColor: Colors.warning + '30', padding: 14, gap: 6,
  },
  gapsTitle: { fontSize: 14, fontWeight: '700', color: Colors.warning, marginBottom: 4 },
  gapItem: { fontSize: 13, color: Colors.text, lineHeight: 20 },
  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 12, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.primary,
    backgroundColor: Colors.surface,
  },
  actionText: { fontSize: 14, fontWeight: '600', color: Colors.primary },
});
