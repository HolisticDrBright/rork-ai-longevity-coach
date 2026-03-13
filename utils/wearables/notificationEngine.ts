import {
  DailyBiometricRecord,
  UserBaseline,
  AllScores,
  PatternDetection,
} from '@/types/wearables';

export type NotificationType =
  | 'low_recovery'
  | 'bedtime_drift'
  | 'missed_supplements'
  | 'hydration_shortfall'
  | 'positive_streak'
  | 'weekly_summary'
  | 'practitioner_review'
  | 'sleep_quality_alert'
  | 'overtraining_warning';

export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  date: string;
  actionable: boolean;
  dismissed: boolean;
}

export interface PractitionerFlag {
  id: string;
  type: string;
  severity: 'warning' | 'alert' | 'critical';
  summary: string;
  evidence: string[];
  daysPersisting: number;
  resolved: boolean;
  createdAt: string;
}

function safe(val: number | null, fallback: number): number {
  return val !== null && !isNaN(val) ? val : fallback;
}

export function generateNotifications(
  record: DailyBiometricRecord,
  records: DailyBiometricRecord[],
  scores: AllScores,
  patterns: PatternDetection[],
  _baseline: UserBaseline | null
): NotificationItem[] {
  const notifications: NotificationItem[] = [];
  const date = record.date;

  if (scores.recovery.score < 55) {
    notifications.push({
      id: `notif_recovery_${date}`,
      type: 'low_recovery',
      title: 'Low Recovery Day',
      body: `Your recovery score is ${scores.recovery.score}/100. Consider reducing training intensity and prioritizing rest today.`,
      priority: scores.recovery.score < 40 ? 'urgent' : 'high',
      date,
      actionable: true,
      dismissed: false,
    });
  }

  const recent3Bedtimes = records.slice(0, 3).map(r => {
    if (!r.bedtime) return null;
    const parts = r.bedtime.split(':');
    let h = parseInt(parts[0]);
    if (h < 12) h += 24;
    return h * 60 + parseInt(parts[1]);
  }).filter((v): v is number => v !== null);

  if (recent3Bedtimes.length >= 3) {
    const range = Math.max(...recent3Bedtimes) - Math.min(...recent3Bedtimes);
    if (range > 90) {
      notifications.push({
        id: `notif_bedtime_${date}`,
        type: 'bedtime_drift',
        title: 'Bedtime Drift Detected',
        body: `Your bedtime has varied by ${Math.round(range)} minutes over the last 3 nights. Circadian consistency is key for recovery.`,
        priority: 'medium',
        date,
        actionable: true,
        dismissed: false,
      });
    }
  }

  if (scores.adherence.score < 60) {
    notifications.push({
      id: `notif_adherence_${date}`,
      type: 'missed_supplements',
      title: 'Supplement Adherence Low',
      body: `Your adherence score is ${scores.adherence.score}%. Consistency with your supplement stack compounds results over time.`,
      priority: 'medium',
      date,
      actionable: true,
      dismissed: false,
    });
  }

  const hydration = safe(record.hydrationMl, 1500);
  if (hydration < 1800) {
    notifications.push({
      id: `notif_hydration_${date}`,
      type: 'hydration_shortfall',
      title: 'Hydration Below Target',
      body: `You've logged ${hydration}ml today. Aim for at least 2.5L for optimal recovery and cognitive function.`,
      priority: 'low',
      date,
      actionable: true,
      dismissed: false,
    });
  }

  const recent7Adherence = records.slice(0, 7).map(r => safe(r.adherenceScore, 50));
  const avgAdherence7 = recent7Adherence.reduce((a, b) => a + b, 0) / recent7Adherence.length;
  const recent7Sleep = records.slice(0, 7).map(r => safe(r.sleepScore, 70));
  const avgSleep7 = recent7Sleep.reduce((a, b) => a + b, 0) / recent7Sleep.length;

  if (avgAdherence7 > 85 && avgSleep7 > 78) {
    notifications.push({
      id: `notif_streak_${date}`,
      type: 'positive_streak',
      title: 'Strong Week!',
      body: `Your adherence (${Math.round(avgAdherence7)}%) and sleep quality (${Math.round(avgSleep7)}) have both been excellent this week. Keep it going!`,
      priority: 'low',
      date,
      actionable: false,
      dismissed: false,
    });
  }

  if (scores.sleep.score < 55) {
    notifications.push({
      id: `notif_sleep_${date}`,
      type: 'sleep_quality_alert',
      title: 'Sleep Quality Needs Attention',
      body: `Your sleep score is ${scores.sleep.score}/100. Focus on sleep hygiene tonight: consistent bedtime, cool room, no screens.`,
      priority: 'high',
      date,
      actionable: true,
      dismissed: false,
    });
  }

  const overreachPattern = patterns.find(p => p.type === 'overreaching' && p.severity !== 'mild');
  if (overreachPattern) {
    notifications.push({
      id: `notif_overtraining_${date}`,
      type: 'overtraining_warning',
      title: 'Overtraining Risk',
      body: 'Training load has been high while recovery is suppressed. Consider a deload day to prevent overreaching.',
      priority: 'high',
      date,
      actionable: true,
      dismissed: false,
    });
  }

  return notifications.sort((a, b) => {
    const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
}

export function generatePractitionerFlags(
  records: DailyBiometricRecord[],
  patterns: PatternDetection[],
  baseline: UserBaseline | null
): PractitionerFlag[] {
  const flags: PractitionerFlag[] = [];
  const bRhr = baseline?.restingHr14Day ?? 60;
  const bHrv = baseline?.hrv14Day ?? 50;
  const date = records[0]?.date ?? new Date().toISOString().split('T')[0];

  const rhrElevatedDays = records.slice(0, 10).filter(r =>
    safe(r.restingHr, bRhr) > bRhr * 1.08
  ).length;
  if (rhrElevatedDays >= 5) {
    flags.push({
      id: `flag_rhr_${date}`,
      type: 'persistent_elevated_rhr',
      severity: rhrElevatedDays >= 7 ? 'critical' : 'alert',
      summary: `Resting heart rate has been persistently elevated (>8% above baseline) for ${rhrElevatedDays} of the last 10 days.`,
      evidence: [`RHR elevated ${rhrElevatedDays}/10 days`, `Baseline: ${bRhr} bpm`],
      daysPersisting: rhrElevatedDays,
      resolved: false,
      createdAt: new Date().toISOString(),
    });
  }

  const hrvSuppressedDays = records.slice(0, 10).filter(r =>
    safe(r.hrv, bHrv) < bHrv * 0.85
  ).length;
  if (hrvSuppressedDays >= 7) {
    flags.push({
      id: `flag_hrv_${date}`,
      type: 'persistent_hrv_suppression',
      severity: 'critical',
      summary: `HRV has been persistently suppressed (>15% below baseline) for ${hrvSuppressedDays} of the last 10 days.`,
      evidence: [`HRV suppressed ${hrvSuppressedDays}/10 days`, `Baseline: ${bHrv} ms`],
      daysPersisting: hrvSuppressedDays,
      resolved: false,
      createdAt: new Date().toISOString(),
    });
  }

  const lowRecoveryDays = records.slice(0, 10).filter(r =>
    safe(r.readinessScore, 75) < 55
  ).length;
  if (lowRecoveryDays >= 7) {
    flags.push({
      id: `flag_recovery_${date}`,
      type: 'persistent_low_recovery',
      severity: 'alert',
      summary: `Recovery has been persistently low for ${lowRecoveryDays} of the last 10 days despite ongoing efforts.`,
      evidence: [`Low recovery ${lowRecoveryDays}/10 days`],
      daysPersisting: lowRecoveryDays,
      resolved: false,
      createdAt: new Date().toISOString(),
    });
  }

  const sleepFragDays = records.slice(0, 14).filter(r =>
    safe(r.awakenings, 3) >= 5 && safe(r.sleepEfficiency, 85) < 78
  ).length;
  if (sleepFragDays >= 7) {
    flags.push({
      id: `flag_sleep_frag_${date}`,
      type: 'worsening_sleep_fragmentation',
      severity: 'warning',
      summary: `Sleep fragmentation has been worsening over the past 2 weeks (${sleepFragDays} nights with 5+ awakenings and <78% efficiency).`,
      evidence: [`Fragmented sleep ${sleepFragDays}/14 nights`],
      daysPersisting: sleepFragDays,
      resolved: false,
      createdAt: new Date().toISOString(),
    });
  }

  const severePatterns = patterns.filter(p => p.escalationNeeded && p.severity === 'severe');
  for (const p of severePatterns) {
    flags.push({
      id: `flag_pattern_${p.id}_${date}`,
      type: `pattern_${p.type}`,
      severity: 'alert',
      summary: p.description,
      evidence: p.factors,
      daysPersisting: p.daysPersisting,
      resolved: false,
      createdAt: new Date().toISOString(),
    });
  }

  const hasHighBP = records.slice(0, 7).some(r =>
    (r.bloodPressureSystolic !== null && r.bloodPressureSystolic > 140) ||
    (r.bloodPressureDiastolic !== null && r.bloodPressureDiastolic > 90)
  );
  if (hasHighBP) {
    flags.push({
      id: `flag_bp_${date}`,
      type: 'elevated_blood_pressure',
      severity: 'alert',
      summary: 'Blood pressure readings above 140/90 have been recorded recently.',
      evidence: ['Elevated blood pressure entries'],
      daysPersisting: 1,
      resolved: false,
      createdAt: new Date().toISOString(),
    });
  }

  return flags.sort((a, b) => {
    const sevOrder = { critical: 0, alert: 1, warning: 2 };
    return sevOrder[a.severity] - sevOrder[b.severity];
  });
}
