import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Plus, ChevronRight, Camera, Activity, AlertTriangle } from 'lucide-react-native';

import Colors from '@/constants/colors';
import { listRecentSessions, type VisualSessionStatus } from '@/lib/visualAnalyzerClient';

interface SessionRow {
  id: string;
  captured_at: string;
  status: VisualSessionStatus;
  visual_health_index: number | null;
  is_baseline: boolean;
}

const STATUS_LABELS: Record<VisualSessionStatus, string> = {
  pending: 'Queued',
  analyzing: 'Analyzing...',
  correlating: 'Correlating findings...',
  rendering: 'Rendering...',
  review_pending: 'Awaiting practitioner review',
  signed_off: 'Reviewed & signed off',
  render_failed: 'Render failed',
  failed: 'Failed',
};

function StatusBadge({ status }: { status: VisualSessionStatus }) {
  const isDone = status === 'review_pending' || status === 'signed_off';
  const isFail = status === 'failed' || status === 'render_failed';
  const color = isFail ? Colors.danger : isDone ? Colors.success : Colors.warning;
  return (
    <View style={[styles.badge, { backgroundColor: color + '20' }]}>
      <Text style={[styles.badgeText, { color }]}>{STATUS_LABELS[status]}</Text>
    </View>
  );
}

function VhiRing({ value }: { value: number | null }) {
  if (value == null) return null;
  const pct = Math.round(value * 100);
  const tone = pct >= 80 ? Colors.success : pct >= 60 ? Colors.warning : Colors.danger;
  return (
    <View style={[styles.vhiRing, { borderColor: tone }]}>
      <Text style={[styles.vhiNum, { color: tone }]}>{pct}</Text>
      <Text style={styles.vhiLabel}>VHI</Text>
    </View>
  );
}

export default function VisualAssessmentsHome() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await listRecentSessions(30);
      setSessions(data as SessionRow[]);
    } catch (err) {
      console.log('[visual-assessments] load failed', err);
    }
  }, []);

  useEffect(() => {
    load().finally(() => setIsLoading(false));
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.heroCard}>
          <View style={styles.heroIcon}>
            <Camera size={28} color={Colors.primary} />
          </View>
          <View style={styles.heroBody}>
            <Text style={styles.heroTitle}>Capture a new assessment</Text>
            <Text style={styles.heroDesc}>
              Skin and tongue images analyzed with the same scope-of-practice language Dr. Bright uses in clinic. Results are observational, not diagnostic.
            </Text>
            <TouchableOpacity
              style={styles.heroBtn}
              onPress={() => router.push('/(tabs)/visual-assessments/new-session' as never)}
              accessibilityRole="button"
            >
              <Plus size={18} color={Colors.textInverse} />
              <Text style={styles.heroBtnText}>New assessment</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.sectionHeader}>Recent assessments</Text>

        {isLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={Colors.primary} />
          </View>
        ) : sessions.length === 0 ? (
          <View style={styles.empty}>
            <Activity size={32} color={Colors.textTertiary} />
            <Text style={styles.emptyText}>
              No assessments yet. Capture one to see Visual Health Index trends over time.
            </Text>
          </View>
        ) : (
          sessions.map((s) => (
            <TouchableOpacity
              key={s.id}
              style={styles.sessionRow}
              onPress={() => router.push(`/(tabs)/visual-assessments/session/${s.id}` as never)}
              activeOpacity={0.7}
            >
              <VhiRing value={s.visual_health_index} />
              <View style={styles.sessionMain}>
                <Text style={styles.sessionDate}>{new Date(s.captured_at).toLocaleString()}</Text>
                <StatusBadge status={s.status} />
                {s.is_baseline ? <Text style={styles.baseline}>Baseline</Text> : null}
              </View>
              <ChevronRight size={18} color={Colors.textTertiary} />
            </TouchableOpacity>
          ))
        )}

        <View style={styles.disclosureCard}>
          <AlertTriangle size={16} color={Colors.warning} />
          <Text style={styles.disclosureText}>
            Visual assessments are observational and not a substitute for medical examination. All findings are reviewed by Dr. Bright (DAOM, L.Ac.) before sign-off.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 16, paddingBottom: 48 },
  heroCard: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  heroIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBody: { flex: 1 },
  heroTitle: { fontSize: 16, fontWeight: '600', color: Colors.text, marginBottom: 4 },
  heroDesc: { fontSize: 13, color: Colors.textSecondary, lineHeight: 18, marginBottom: 12 },
  heroBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  heroBtnText: { color: Colors.textInverse, fontWeight: '600', fontSize: 14 },
  sectionHeader: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    marginTop: 24,
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  loading: { padding: 24, alignItems: 'center' },
  empty: { padding: 24, alignItems: 'center', gap: 12 },
  emptyText: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center' },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    gap: 12,
  },
  sessionMain: { flex: 1 },
  sessionDate: { fontSize: 14, fontWeight: '500', color: Colors.text, marginBottom: 4 },
  baseline: { fontSize: 11, color: Colors.primary, fontWeight: '500', marginTop: 4 },
  vhiRing: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vhiNum: { fontSize: 14, fontWeight: '700' },
  vhiLabel: { fontSize: 8, color: Colors.textTertiary, fontWeight: '600' },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  disclosureCard: {
    flexDirection: 'row',
    backgroundColor: Colors.warning + '10',
    padding: 12,
    borderRadius: 8,
    marginTop: 24,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.warning + '30',
  },
  disclosureText: { flex: 1, fontSize: 11, color: Colors.textSecondary, lineHeight: 16 },
});
