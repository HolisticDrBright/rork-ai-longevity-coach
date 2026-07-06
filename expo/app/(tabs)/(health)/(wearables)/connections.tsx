import { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  Watch,
  Wifi,
  Clock,
  Shield,
  Plus,
  Trash2,
  RefreshCw,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useWearables } from '@/providers/WearablesProvider';
import { showAlert, confirmAsync } from '@/lib/ui/appAlert';
import CapabilityChip from '@/components/ui/CapabilityChip';
import {
  PROVIDER_CATALOG,
  ProviderInfo,
  capabilitiesForProvider,
  normalizeProviderSlug,
  MetricAvailability,
} from '@/constants/wearableCapabilities';
import { useConnectDevice, useDisconnectProvider, useSyncHealth } from '@/hooks/useHealthData';

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  apple_health_kit: 'Apple Health',
  apple_health: 'Apple Health',
  health_connect: 'Health Connect',
  google_health: 'Health Connect (Android)',
  oura: 'Oura Ring',
  fitbit: 'Fitbit',
  whoop: 'WHOOP',
  garmin: 'Garmin',
  withings: 'Withings',
  polar: 'Polar',
  eight_sleep: 'Eight Sleep',
  strava: 'Strava',
  dexcom: 'Dexcom CGM',
  freestyle_libre: 'FreeStyle Libre',
  omron: 'Omron BP Monitor',
};

function displayName(slug: string): string {
  return PROVIDER_DISPLAY_NAMES[slug]
    ?? PROVIDER_CATALOG.find(p => p.slug === normalizeProviderSlug(slug))?.name
    ?? slug.replace(/_/g, ' ');
}

const CATALOG_CATEGORIES: ProviderInfo['category'][] = [
  'Rings & Bands',
  'Watches & Trackers',
  'Phone Health Platforms',
  'CGMs',
  'Blood Pressure & Scales',
  'Sleep',
];

export default function ConnectionsScreen() {
  const { connections, hasConnections, isRefreshing, metricAvailability } = useWearables();
  const connectMutation = useConnectDevice();
  const disconnectMutation = useDisconnectProvider();
  const syncMutation = useSyncHealth();

  // Catalog rows pass their provider slug so Junction Link deep-links
  // straight to that device's auth flow; omitting it (the generic
  // "Connect device" button) opens Junction's provider picker.
  const handleConnect = useCallback(async (provider?: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const result = await connectMutation.mutateAsync(provider);
      if (result.success && result.newProvider) {
        showAlert('Connected', `${displayName(result.newProvider)} is now connected. Data will start syncing shortly.`);
      } else if (result.success && !result.newProvider) {
        showAlert('No device selected', 'The connection flow was closed before a device was picked. Try again and choose a provider.');
      } else {
        showAlert(
          'Wearables not available',
          'Device connections require a custom build with the Vital SDK installed. This preview/Expo Go build cannot connect to wearables. Once a development build is created and EXPO_PUBLIC_VITAL_API_KEY is configured, this button will open the provider picker.'
        );
      }
    } catch (err) {
      console.error('[Connections] connect failed', err);
      showAlert('Connection failed', (err as Error)?.message ?? 'Something went wrong. Please try again.');
    }
  }, [connectMutation]);

  const handleDisconnect = useCallback(async (provider: string) => {
    const confirmed = await confirmAsync(
      'Disconnect device',
      `Are you sure you want to disconnect ${displayName(provider)}? Historical data will be preserved.`,
      { confirmText: 'Disconnect', destructive: true }
    );
    if (confirmed) {
      disconnectMutation.mutate(provider);
    }
  }, [disconnectMutation]);

  const handleRefreshHistory = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    syncMutation.mutate();
  }, [syncMutation]);

  const connectedDevices = connections.filter(c => c.connected);
  const isConnecting = connectMutation.isPending;

  const connectedSlugs = useMemo(
    () => new Set(connectedDevices.map(c => normalizeProviderSlug(c.source))),
    [connectedDevices],
  );

  const catalogByCategory = useMemo(() => {
    const available = PROVIDER_CATALOG.filter(p => !connectedSlugs.has(p.slug));
    return CATALOG_CATEGORIES
      .map(category => ({ category, providers: available.filter(p => p.category === category) }))
      .filter(section => section.providers.length > 0);
  }, [connectedSlugs]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {/* Privacy banner */}
      <View style={styles.privacyCard}>
        <Shield size={16} color={Colors.primary} />
        <Text style={styles.privacyText}>
          Your health data is encrypted end-to-end. We only read the data types needed for wellness analysis.
        </Text>
      </View>

      {/* Empty state */}
      {!hasConnections && !isConnecting && (
        <View style={styles.emptyState}>
          <View style={styles.emptyIconContainer}>
            <Watch size={40} color={Colors.textTertiary} />
          </View>
          <Text style={styles.emptyTitle}>No devices connected</Text>
          <Text style={styles.emptyBody}>
            Connect a wearable device to unlock personalized health intelligence — sleep analysis, HRV trends, recovery scoring, and more.
          </Text>
          <TouchableOpacity style={styles.connectButton} onPress={() => handleConnect()}>
            <Plus color="#fff" size={20} />
            <Text style={styles.connectButtonText}>Connect a device</Text>
          </TouchableOpacity>
          {Platform.OS === 'android' && (
            <Text style={styles.androidNote}>
              Note: Android Health Connect limits historical data to the last 30 days. This is a Google restriction, not ours.
            </Text>
          )}
        </View>
      )}

      {/* Connecting state */}
      {isConnecting && (
        <View style={styles.connectingCard}>
          <ActivityIndicator color={Colors.primary} />
          <Text style={styles.connectingText}>Connecting your device…</Text>
        </View>
      )}

      {/* Connected devices list */}
      {connectedDevices.length > 0 && (
        <View style={styles.connectedSection}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderLeft}>
              <Wifi size={16} color={Colors.success} />
              <Text style={styles.sectionTitle}>Connected</Text>
            </View>
            <TouchableOpacity
              style={styles.refreshButton}
              onPress={handleRefreshHistory}
              disabled={syncMutation.isPending || isRefreshing}
            >
              {syncMutation.isPending || isRefreshing ? (
                <ActivityIndicator color={Colors.primary} size="small" />
              ) : (
                <>
                  <RefreshCw size={14} color={Colors.primary} />
                  <Text style={styles.refreshText}>Refresh</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {connectedDevices.map(conn => {
            const capabilities = capabilitiesForProvider(normalizeProviderSlug(conn.source));
            const chipStates: { key: string; label: string; availability: MetricAvailability }[] =
              capabilities.map(m => ({
                key: m.key,
                label: m.shortLabel,
                availability: metricAvailability[m.key] ?? 'expected',
              }));
            const anyLive = chipStates.some(c => c.availability === 'live');
            return (
              <View key={conn.id} style={styles.deviceCard}>
                <View style={styles.deviceHeader}>
                  <View style={styles.deviceIcon}>
                    <Watch size={20} color={Colors.primary} />
                  </View>
                  <View style={styles.deviceInfo}>
                    <Text style={styles.deviceName}>{displayName(conn.source)}</Text>
                    <Text style={styles.deviceStatus}>{anyLive ? 'Syncing data' : 'Connected'}</Text>
                    {conn.lastSync && (
                      <View style={styles.syncRow}>
                        <Clock size={11} color={Colors.textTertiary} />
                        <Text style={styles.syncText}>
                          Last synced {new Date(conn.lastSync).toLocaleString()}
                        </Text>
                      </View>
                    )}
                  </View>
                  <TouchableOpacity
                    style={styles.disconnectButton}
                    onPress={() => handleDisconnect(conn.source)}
                    disabled={disconnectMutation.isPending}
                  >
                    <Trash2 size={16} color={Colors.danger} />
                  </TouchableOpacity>
                </View>
                {chipStates.length > 0 && (
                  <View style={styles.chipsRow}>
                    {chipStates.map(chip => (
                      <CapabilityChip key={chip.key} label={chip.label} availability={chip.availability} />
                    ))}
                  </View>
                )}
                {!anyLive && chipStates.length > 0 && (
                  <Text style={styles.awaitingNote}>Awaiting first sync — metrics will light up as data arrives.</Text>
                )}
              </View>
            );
          })}
        </View>
      )}

      {/* Device catalog */}
      {catalogByCategory.length > 0 && (
        <View style={styles.catalogSection}>
          <Text style={styles.catalogTitle}>Add a device</Text>
          <Text style={styles.catalogSubtitle}>
            Each device unlocks different metrics. Connecting opens the secure Junction picker.
          </Text>
          {catalogByCategory.map(section => (
            <View key={section.category} style={styles.catalogCategory}>
              <Text style={styles.catalogCategoryLabel}>{section.category}</Text>
              {section.providers.map(provider => {
                const caps = capabilitiesForProvider(provider.slug).slice(0, 5);
                return (
                  <View key={provider.slug} style={styles.catalogRow}>
                    <View style={styles.catalogInfo}>
                      <Text style={styles.catalogName}>{provider.name}</Text>
                      {caps.length > 0 && (
                        <View style={styles.chipsRow}>
                          {caps.map(m => (
                            <CapabilityChip key={m.key} label={m.shortLabel} />
                          ))}
                        </View>
                      )}
                    </View>
                    <TouchableOpacity
                      style={styles.catalogConnectBtn}
                      onPress={() => handleConnect(provider.slug)}
                      disabled={isConnecting}
                      testID={`connect-${provider.slug}`}
                    >
                      <Plus size={13} color={Colors.primary} />
                      <Text style={styles.catalogConnectText}>Connect</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 40 },
  privacyCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: Colors.primary + '08', borderRadius: 12,
    padding: 14, marginBottom: 16,
    borderWidth: 1, borderColor: Colors.primary + '20',
  },
  privacyText: { flex: 1, fontSize: 12, color: Colors.textSecondary, lineHeight: 18 },
  emptyState: { alignItems: 'center', padding: 24, gap: 12 },
  emptyIconContainer: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: Colors.surfaceSecondary,
    justifyContent: 'center', alignItems: 'center', marginBottom: 8,
  },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: Colors.text },
  emptyBody: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20, maxWidth: 320 },
  connectButton: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: 12,
    paddingHorizontal: 24, paddingVertical: 14, marginTop: 8,
  },
  connectButtonText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  androidNote: {
    fontSize: 11, color: Colors.textTertiary, textAlign: 'center',
    fontStyle: 'italic', marginTop: 8, maxWidth: 300,
  },
  connectingCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.surface, borderRadius: 12,
    padding: 20, justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  connectingText: { fontSize: 14, color: Colors.textSecondary },
  connectedSection: { gap: 10, marginBottom: 24 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 4,
  },
  sectionHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
  refreshButton: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    borderWidth: 1, borderColor: Colors.primary,
  },
  refreshText: { fontSize: 12, fontWeight: '600', color: Colors.primary },
  deviceCard: {
    backgroundColor: Colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border, padding: 14,
  },
  deviceHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  deviceIcon: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: Colors.primary + '15',
    justifyContent: 'center', alignItems: 'center',
  },
  deviceInfo: { flex: 1, gap: 2 },
  deviceName: { fontSize: 15, fontWeight: '600', color: Colors.text },
  deviceStatus: { fontSize: 11, fontWeight: '600', color: Colors.success },
  syncRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  syncText: { fontSize: 11, color: Colors.textTertiary },
  disconnectButton: {
    width: 36, height: 36, borderRadius: 8,
    backgroundColor: Colors.danger + '10',
    justifyContent: 'center', alignItems: 'center',
  },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  awaitingNote: { fontSize: 11, color: Colors.textTertiary, fontStyle: 'italic', marginTop: 8 },
  catalogSection: { marginBottom: 8 },
  catalogTitle: { fontSize: 18, fontWeight: '700', color: Colors.text, marginBottom: 4 },
  catalogSubtitle: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17, marginBottom: 14 },
  catalogCategory: { marginBottom: 16 },
  catalogCategoryLabel: {
    fontSize: 11, fontWeight: '700', color: Colors.textTertiary,
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8,
  },
  catalogRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
    padding: 12, marginBottom: 8,
  },
  catalogInfo: { flex: 1 },
  catalogName: { fontSize: 14, fontWeight: '600', color: Colors.text },
  catalogConnectBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
    borderWidth: 1, borderColor: Colors.primary,
  },
  catalogConnectText: { fontSize: 12, fontWeight: '600', color: Colors.primary },
});
