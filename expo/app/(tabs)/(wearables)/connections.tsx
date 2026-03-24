import { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  Watch,
  Wifi,
  WifiOff,
  Clock,
  Shield,
  Info,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useWearables } from '@/providers/WearablesProvider';
import { WearableSource } from '@/types/wearables';

const sourceConfig: Record<WearableSource, { name: string; description: string; phase: string; color: string }> = {
  apple_health: { name: 'Apple HealthKit', description: 'Sleep, heart rate, steps, workouts, HRV', phase: 'Phase 1', color: '#FF2D55' },
  google_health: { name: 'Google Health Connect', description: 'Sleep, heart rate, steps, workouts', phase: 'Phase 1', color: '#4285F4' },
  oura: { name: 'Oura Ring', description: 'Sleep, readiness, HRV, temperature, activity', phase: 'Phase 1', color: '#C4A77D' },
  whoop: { name: 'WHOOP', description: 'Strain, recovery, sleep, HRV', phase: 'Phase 2', color: '#00BFA5' },
  fitbit: { name: 'Fitbit', description: 'Sleep, heart rate, steps, SpO2', phase: 'Phase 2', color: '#00B0B9' },
  garmin: { name: 'Garmin Connect', description: 'Training load, VO2 max, sleep, HR', phase: 'Phase 3', color: '#007DC3' },
  manual: { name: 'Manual Entry', description: 'Enter data manually', phase: '', color: '#6B7280' },
};

const phases = ['Phase 1', 'Phase 2', 'Phase 3'];

export default function ConnectionsScreen() {
  const { connections, toggleConnection } = useWearables();

  const handleToggle = useCallback((source: WearableSource) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    toggleConnection(source);
  }, [toggleConnection]);

  const connectedCount = connections.filter(c => c.connected).length;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.statusCard}>
        <View style={styles.statusRow}>
          {connectedCount > 0
            ? <Wifi size={20} color={Colors.success} />
            : <WifiOff size={20} color={Colors.textTertiary} />
          }
          <Text style={styles.statusText}>
            {connectedCount} device{connectedCount !== 1 ? 's' : ''} connected
          </Text>
        </View>
        <Text style={styles.statusDescription}>
          Connect your wearable devices to enable personalized health intelligence. More data sources lead to better recommendations.
        </Text>
      </View>

      <View style={styles.privacyCard}>
        <Shield size={16} color={Colors.primary} />
        <Text style={styles.privacyText}>
          Your health data is encrypted and stored securely. We only request the data types needed for wellness analysis. No data is shared with third parties.
        </Text>
      </View>

      {phases.map(phase => {
        const phaseConnections = connections.filter(c => sourceConfig[c.source]?.phase === phase);
        if (phaseConnections.length === 0) return null;

        return (
          <View key={phase}>
            <Text style={styles.phaseTitle}>{phase} Integrations</Text>
            {phaseConnections.map(conn => {
              const config = sourceConfig[conn.source];
              if (!config) return null;

              return (
                <View key={conn.id} style={[styles.connectionCard, conn.connected && styles.connectionCardActive]}>
                  <View style={styles.connectionHeader}>
                    <View style={[styles.connectionIcon, { backgroundColor: config.color + '18' }]}>
                      <Watch size={20} color={config.color} />
                    </View>
                    <View style={styles.connectionInfo}>
                      <Text style={styles.connectionName}>{config.name}</Text>
                      <Text style={styles.connectionDescription}>{config.description}</Text>
                    </View>
                    <Switch
                      value={conn.connected}
                      onValueChange={() => handleToggle(conn.source)}
                      trackColor={{ false: Colors.borderLight, true: Colors.primary + '60' }}
                      thumbColor={conn.connected ? Colors.primary : '#f4f3f4'}
                      testID={`toggle-${conn.source}`}
                    />
                  </View>
                  {conn.connected && conn.lastSync && (
                    <View style={styles.syncRow}>
                      <Clock size={12} color={Colors.textTertiary} />
                      <Text style={styles.syncText}>
                        Last synced: {new Date(conn.lastSync).toLocaleString()}
                      </Text>
                    </View>
                  )}
                  {conn.connected && conn.permissions.length > 0 && (
                    <View style={styles.permissionsRow}>
                      {conn.permissions.map((perm, i) => (
                        <View key={i} style={styles.permissionChip}>
                          <Text style={styles.permissionText}>{perm}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        );
      })}

      <View style={styles.infoCard}>
        <Info size={16} color={Colors.textTertiary} />
        <Text style={styles.infoText}>
          Phase 2 and Phase 3 integrations are available for connection but may have limited data in the current version. The system architecture supports adding new providers without restructuring.
        </Text>
      </View>

      <View style={styles.disclaimer}>
        <Text style={styles.disclaimerText}>
          Device connections require appropriate permissions on your device. Some features may require the corresponding app to be installed. Data availability varies by device and platform.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 40 },
  statusCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  statusText: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  statusDescription: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
  privacyCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
  },
  privacyText: { flex: 1, fontSize: 12, color: '#1E40AF', lineHeight: 17 },
  phaseTitle: { fontSize: 15, fontWeight: '700' as const, color: Colors.text, marginBottom: 10, marginTop: 8 },
  connectionCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1.5,
    borderColor: Colors.borderLight,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
  connectionCardActive: { borderColor: Colors.primary + '40' },
  connectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  connectionIcon: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  connectionInfo: { flex: 1 },
  connectionName: { fontSize: 15, fontWeight: '600' as const, color: Colors.text, marginBottom: 2 },
  connectionDescription: { fontSize: 12, color: Colors.textSecondary },
  syncRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: Colors.borderLight },
  syncText: { fontSize: 11, color: Colors.textTertiary },
  permissionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  permissionChip: { backgroundColor: Colors.surfaceSecondary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  permissionText: { fontSize: 10, color: Colors.textTertiary, fontWeight: '500' as const },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
    marginBottom: 12,
  },
  infoText: { flex: 1, fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },
  disclaimer: { padding: 14, backgroundColor: Colors.surfaceSecondary, borderRadius: 10, marginBottom: 20 },
  disclaimerText: { fontSize: 11, color: Colors.textTertiary, lineHeight: 16, textAlign: 'center' },
});
