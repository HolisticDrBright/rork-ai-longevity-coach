import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import {
  Shield,
  AlertTriangle,
  AlertOctagon,
  Info,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  XCircle,
} from 'lucide-react-native';
import { useState } from 'react';
import Colors from '@/constants/colors';
import type { InteractionSeverity } from '@/types';

interface InteractionAlert {
  peptideASlug: string;
  peptideBSlug: string;
  interactionType: string;
  severity: InteractionSeverity;
  description: string;
  recommendation?: string;
}

interface ContraindicationAlert {
  peptideSlug: string;
  condition: string;
  severity: InteractionSeverity;
  description: string;
  recommendation?: string;
}

interface LabThresholdAlert {
  peptideSlug: string;
  biomarkerName: string;
  severity: InteractionSeverity;
  message: string;
  recommendation?: string;
  actualValue?: number;
}

interface SafetyReport {
  interactions: InteractionAlert[];
  contraindications: ContraindicationAlert[];
  labThresholds: LabThresholdAlert[];
  overallSeverity: InteractionSeverity;
  safeToStart: boolean;
}

const SEVERITY_CONFIG: Record<InteractionSeverity, { color: string; icon: any; label: string }> = {
  info: { color: Colors.success, icon: Info, label: 'Info' },
  caution: { color: '#EAB308', icon: AlertTriangle, label: 'Caution' },
  warning: { color: Colors.warning, icon: AlertTriangle, label: 'Warning' },
  critical: { color: Colors.danger, icon: AlertOctagon, label: 'Critical' },
};

function AlertCard({ severity, title, description, recommendation }: {
  severity: InteractionSeverity;
  title: string;
  description: string;
  recommendation?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const config = SEVERITY_CONFIG[severity];
  const Icon = config.icon;

  return (
    <TouchableOpacity
      style={[styles.alertCard, { borderLeftColor: config.color }]}
      onPress={() => setExpanded(!expanded)}
      activeOpacity={0.7}
    >
      <View style={styles.alertHeader}>
        <Icon color={config.color} size={18} />
        <View style={styles.alertContent}>
          <View style={styles.alertTitleRow}>
            <Text style={styles.alertTitle}>{title}</Text>
            <View style={[styles.severityBadge, { backgroundColor: config.color + '20' }]}>
              <Text style={[styles.severityText, { color: config.color }]}>{config.label}</Text>
            </View>
          </View>
          <Text style={styles.alertDescription} numberOfLines={expanded ? undefined : 2}>{description}</Text>
        </View>
        {recommendation ? (expanded ? <ChevronUp color={Colors.textTertiary} size={16} /> : <ChevronDown color={Colors.textTertiary} size={16} />) : null}
      </View>
      {expanded && recommendation && (
        <View style={styles.recommendationContainer}>
          <Text style={styles.recommendationLabel}>Recommendation:</Text>
          <Text style={styles.recommendationText}>{recommendation}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

interface Props {
  report?: SafetyReport | null;
  loading?: boolean;
}

export default function PeptideSafetyPanel({ report, loading }: Props) {
  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.sectionHeader}>
          <Shield color={Colors.primary} size={20} />
          <Text style={styles.sectionTitle}>Safety Check</Text>
        </View>
        <Text style={styles.loadingText}>Running safety analysis...</Text>
      </View>
    );
  }

  if (!report) return null;

  const totalAlerts = report.interactions.length + report.contraindications.length + report.labThresholds.length;

  return (
    <View style={styles.container}>
      <View style={styles.sectionHeader}>
        <Shield color={Colors.primary} size={20} />
        <Text style={styles.sectionTitle}>Safety Report</Text>
      </View>

      {/* Overall Status */}
      <View style={[styles.overallStatus, { backgroundColor: report.safeToStart ? Colors.success + '15' : Colors.danger + '15' }]}>
        {report.safeToStart ? (
          <CheckCircle color={Colors.success} size={22} />
        ) : (
          <XCircle color={Colors.danger} size={22} />
        )}
        <View style={styles.overallContent}>
          <Text style={[styles.overallTitle, { color: report.safeToStart ? Colors.success : Colors.danger }]}>
            {report.safeToStart ? 'Safe to Start' : 'Critical Issues Found'}
          </Text>
          <Text style={styles.overallSubtitle}>
            {totalAlerts === 0 ? 'No safety concerns detected.' : `${totalAlerts} alert${totalAlerts > 1 ? 's' : ''} found.`}
          </Text>
        </View>
      </View>

      {/* Interactions */}
      {report.interactions.length > 0 && (
        <View style={styles.alertSection}>
          <Text style={styles.alertSectionTitle}>Peptide Interactions ({report.interactions.length})</Text>
          {report.interactions.map((interaction, i) => (
            <AlertCard
              key={`int-${i}`}
              severity={interaction.severity}
              title={`${interaction.peptideASlug} + ${interaction.peptideBSlug}`}
              description={interaction.description}
              recommendation={interaction.recommendation}
            />
          ))}
        </View>
      )}

      {/* Contraindications */}
      {report.contraindications.length > 0 && (
        <View style={styles.alertSection}>
          <Text style={styles.alertSectionTitle}>Contraindications ({report.contraindications.length})</Text>
          {report.contraindications.map((contra, i) => (
            <AlertCard
              key={`contra-${i}`}
              severity={contra.severity}
              title={`${contra.peptideSlug}: ${contra.condition}`}
              description={contra.description}
              recommendation={contra.recommendation}
            />
          ))}
        </View>
      )}

      {/* Lab Thresholds */}
      {report.labThresholds.length > 0 && (
        <View style={styles.alertSection}>
          <Text style={styles.alertSectionTitle}>Lab Threshold Alerts ({report.labThresholds.length})</Text>
          {report.labThresholds.map((threshold, i) => (
            <AlertCard
              key={`lab-${i}`}
              severity={threshold.severity}
              title={`${threshold.peptideSlug}: ${threshold.biomarkerName}`}
              description={threshold.message}
              recommendation={threshold.recommendation}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
  loadingText: { fontSize: 14, color: Colors.textSecondary, fontStyle: 'italic' },
  overallStatus: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 16, borderRadius: 12,
  },
  overallContent: { flex: 1 },
  overallTitle: { fontSize: 16, fontWeight: '700' },
  overallSubtitle: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  alertSection: { gap: 8 },
  alertSectionTitle: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary, marginTop: 4 },
  alertCard: {
    backgroundColor: Colors.surface, borderRadius: 10, padding: 12,
    borderLeftWidth: 4, borderWidth: 1, borderColor: Colors.border,
  },
  alertHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  alertContent: { flex: 1, gap: 4 },
  alertTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  alertTitle: { fontSize: 14, fontWeight: '600', color: Colors.text, flex: 1 },
  severityBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  severityText: { fontSize: 11, fontWeight: '700' },
  alertDescription: { fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  recommendationContainer: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: Colors.borderLight },
  recommendationLabel: { fontSize: 12, fontWeight: '600', color: Colors.primary, marginBottom: 4 },
  recommendationText: { fontSize: 13, color: Colors.text, lineHeight: 18 },
});
