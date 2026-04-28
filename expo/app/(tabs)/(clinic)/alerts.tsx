import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { 
  AlertTriangle, 
  Bell, 
  CheckCircle,
  ChevronRight,
  Filter,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import type { AlertSeverity, AlertEventStatus } from '@/types/clinic';
import { mockClinicAlerts } from '@/mocks/clinicMockData';

interface AlertItemProps {
  id: string;
  title: string;
  message: string;
  patientName: string;
  patientId: string;
  severity: AlertSeverity;
  status: AlertEventStatus;
  createdAt: string;
  onPress: () => void;
  onAcknowledge: () => void;
}

function AlertItem({ 
  title, 
  message, 
  patientName, 
  severity, 
  status, 
  createdAt, 
  onPress,
  onAcknowledge 
}: AlertItemProps) {
  const getSeverityColor = () => {
    switch (severity) {
      case 'critical': return Colors.danger;
      case 'high': return '#F59E0B';
      case 'medium': return Colors.primary;
      case 'low': return Colors.success;
      default: return Colors.textSecondary;
    }
  };

  const getSeverityIcon = () => {
    switch (severity) {
      case 'critical':
      case 'high':
        return <AlertTriangle size={18} color={getSeverityColor()} />;
      default:
        return <Bell size={18} color={getSeverityColor()} />;
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const isNew = status === 'new';

  return (
    <TouchableOpacity 
      style={[styles.alertItem, isNew && styles.alertItemNew]} 
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.severityBar, { backgroundColor: getSeverityColor() }]} />
      
      <View style={styles.alertContent}>
        <View style={styles.alertHeader}>
          <View style={styles.alertIconContainer}>
            {getSeverityIcon()}
          </View>
          <View style={styles.alertTitleContainer}>
            <Text style={styles.alertPatient}>{patientName}</Text>
            <Text style={styles.alertTitle} numberOfLines={1}>{title}</Text>
          </View>
          <Text style={styles.alertTime}>{formatTime(createdAt)}</Text>
        </View>
        
        <Text style={styles.alertMessage} numberOfLines={2}>{message}</Text>
        
        <View style={styles.alertActions}>
          <View style={[styles.severityBadge, { backgroundColor: getSeverityColor() + '20' }]}>
            <Text style={[styles.severityText, { color: getSeverityColor() }]}>
              {severity.charAt(0).toUpperCase() + severity.slice(1)}
            </Text>
          </View>
          
          {status === 'new' && (
            <TouchableOpacity 
              style={styles.acknowledgeButton}
              onPress={(e) => {
                e.stopPropagation();
                onAcknowledge();
              }}
            >
              <CheckCircle size={14} color={Colors.primary} />
              <Text style={styles.acknowledgeText}>Acknowledge</Text>
            </TouchableOpacity>
          )}
          
          <View style={styles.viewDetails}>
            <Text style={styles.viewDetailsText}>View</Text>
            <ChevronRight size={14} color={Colors.primary} />
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function AlertsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<AlertSeverity | undefined>(undefined);
  const [showFilters, setShowFilters] = useState(false);

  const alertsQuery = trpc.clinic.dashboard.getAlertInbox.useQuery({
    severity: severityFilter,
    limit: 50,
  });

  const acknowledgeMutation = trpc.clinic.alerts.acknowledgeEvent.useMutation({
    onSuccess: () => {
      alertsQuery.refetch();
    },
  });

  const realAlerts = alertsQuery.data?.alerts || [];
  const baseAlerts = realAlerts.length > 0 ? realAlerts : (mockClinicAlerts as unknown as typeof realAlerts);
  const alerts = severityFilter ? baseAlerts.filter((a) => a.severity === severityFilter) : baseAlerts;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await alertsQuery.refetch();
    setRefreshing(false);
  }, [alertsQuery]);

  const handleAcknowledge = useCallback((alertId: string) => {
    Alert.alert(
      'Acknowledge Alert',
      'Mark this alert as acknowledged?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Acknowledge', 
          onPress: () => acknowledgeMutation.mutate({ id: alertId, acknowledgedBy: 'clinician' })
        },
      ]
    );
  }, [acknowledgeMutation]);

  const severityFilters: { label: string; value: AlertSeverity | undefined; color: string }[] = [
    { label: 'All', value: undefined, color: Colors.textSecondary },
    { label: 'Critical', value: 'critical', color: Colors.danger },
    { label: 'High', value: 'high', color: '#F59E0B' },
    { label: 'Medium', value: 'medium', color: Colors.primary },
    { label: 'Low', value: 'low', color: Colors.success },
  ];

  const renderAlert = useCallback(({ item }: { item: typeof alerts[0] }) => (
    <AlertItem
      id={item.id}
      title={item.title}
      message={item.message}
      patientName={item.patientName}
      patientId={item.patientId}
      severity={item.severity}
      status={item.status}
      createdAt={item.createdAt}
      onPress={() => router.push(`/(tabs)/(clinic)/patient/${item.patientId}` as any)}
      onAcknowledge={() => handleAcknowledge(item.id)}
    />
  ), [router, handleAcknowledge]);

  const criticalCount = alerts.filter(a => a.severity === 'critical').length;
  const highCount = alerts.filter(a => a.severity === 'high').length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{alerts.length}</Text>
            <Text style={styles.statLabel}>Total</Text>
          </View>
          <View style={[styles.statItem, styles.statItemDanger]}>
            <Text style={[styles.statValue, { color: Colors.danger }]}>{criticalCount}</Text>
            <Text style={styles.statLabel}>Critical</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: '#F59E0B' }]}>{highCount}</Text>
            <Text style={styles.statLabel}>High</Text>
          </View>
        </View>

        <TouchableOpacity 
          style={[styles.filterToggle, showFilters && styles.filterToggleActive]}
          onPress={() => setShowFilters(!showFilters)}
        >
          <Filter size={18} color={showFilters ? Colors.textInverse : Colors.primary} />
          <Text style={[styles.filterToggleText, showFilters && styles.filterToggleTextActive]}>
            Filter
          </Text>
        </TouchableOpacity>
      </View>

      {showFilters && (
        <View style={styles.filtersContainer}>
          <View style={styles.filterChips}>
            {severityFilters.map((filter) => (
              <TouchableOpacity
                key={filter.label}
                style={[
                  styles.filterChip,
                  severityFilter === filter.value && { backgroundColor: filter.color, borderColor: filter.color }
                ]}
                onPress={() => setSeverityFilter(filter.value)}
              >
                <Text style={[
                  styles.filterChipText,
                  severityFilter === filter.value && styles.filterChipTextActive,
                ]}>
                  {filter.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {alertsQuery.isLoading && !refreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : alerts.length === 0 ? (
        <View style={styles.emptyContainer}>
          <CheckCircle size={48} color={Colors.success} />
          <Text style={styles.emptyTitle}>All Caught Up!</Text>
          <Text style={styles.emptySubtitle}>No alerts require your attention</Text>
        </View>
      ) : (
        <FlatList
          data={alerts}
          renderItem={renderAlert}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 100 }]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
          }
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: Colors.background,
  },
  statsRow: {
    flex: 1,
    flexDirection: 'row',
    gap: 16,
  },
  statItem: {
    backgroundColor: Colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  statItemDanger: {
    backgroundColor: Colors.danger + '10',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  statLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  filterToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    gap: 6,
  },
  filterToggleActive: {
    backgroundColor: Colors.primary,
  },
  filterToggleText: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.primary,
  },
  filterToggleTextActive: {
    color: Colors.textInverse,
  },
  filtersContainer: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  filterChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  filterChipText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500' as const,
  },
  filterChipTextActive: {
    color: Colors.textInverse,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600' as const,
    color: Colors.text,
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 8,
  },
  listContent: {
    padding: 16,
    paddingTop: 0,
  },
  alertItem: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    overflow: 'hidden',
  },
  alertItemNew: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.primary + '30',
  },
  severityBar: {
    width: 4,
  },
  alertContent: {
    flex: 1,
    padding: 14,
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  alertIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.surfaceSecondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  alertTitleContainer: {
    flex: 1,
  },
  alertPatient: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  alertTitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  alertTime: {
    fontSize: 12,
    color: Colors.textTertiary,
  },
  alertMessage: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 10,
    lineHeight: 18,
  },
  alertActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    gap: 10,
  },
  severityBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  severityText: {
    fontSize: 12,
    fontWeight: '600' as const,
  },
  acknowledgeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary + '10',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    gap: 4,
  },
  acknowledgeText: {
    fontSize: 12,
    fontWeight: '500' as const,
    color: Colors.primary,
  },
  viewDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 'auto',
  },
  viewDetailsText: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '500' as const,
  },
  separator: {
    height: 10,
  },
});
