import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { 
  Mail, 
  Phone, 
  Calendar,
  AlertTriangle,
  FileText,
  Activity,
  ClipboardList,
  MapPin,
  Heart,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import OutcomeReportApprovalPanel from '@/components/outcome/OutcomeReportApprovalPanel';

/**
 * Bridges clinic patient id → longevity protocol id, then renders the
 * approval panel. Handled as a small helper component so the tab renders
 * cleanly even when the patient hasn't started a longevity protocol yet.
 */
function OutcomePanelForPatient({ clinicPatientId }: { clinicPatientId: string }) {
  const protocolQuery = trpc.longevity.getLatestProtocolForClinicPatient.useQuery({ clinicPatientId });

  if (protocolQuery.isLoading) {
    return <Text style={{ fontSize: 13, color: Colors.textSecondary }}>Loading outcome report…</Text>;
  }
  const protocol = protocolQuery.data as any;
  if (!protocol) {
    return (
      <View style={{ backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, padding: 20, alignItems: 'center' }}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.text }}>No longevity protocol linked</Text>
        <Text style={{ fontSize: 12, color: Colors.textSecondary, textAlign: 'center', marginTop: 6 }}>
          This patient doesn't have a longevity protocol yet, or their email doesn't match an app user.
        </Text>
      </View>
    );
  }
  return <OutcomeReportApprovalPanel protocolId={protocol.id} />;
}

type TabType = 'overview' | 'labs' | 'biometrics' | 'alerts' | 'timeline' | 'outcome';

interface InfoRowProps {
  icon: React.ReactNode;
  label: string;
  value?: string | null;
}

function InfoRow({ icon, label, value }: InfoRowProps) {
  if (!value) return null;
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoIcon}>{icon}</View>
      <View style={styles.infoContent}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value}</Text>
      </View>
    </View>
  );
}

interface StatBoxProps {
  label: string;
  value: number;
  color: string;
  icon: React.ReactNode;
}

function StatBox({ label, value, color, icon }: StatBoxProps) {
  return (
    <View style={[styles.statBox, { borderColor: color + '30' }]}>
      <View style={[styles.statIcon, { backgroundColor: color + '15' }]}>
        {icon}
      </View>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

interface TimelineItemProps {
  type: string;
  title: string;
  description?: string;
  date: string;
}

function TimelineItem({ type, title, description, date }: TimelineItemProps) {
  const getTypeColor = () => {
    switch (type) {
      case 'alert': return Colors.danger;
      case 'lab_upload':
      case 'lab_result': return Colors.primary;
      case 'biometric': return Colors.success;
      default: return Colors.textSecondary;
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  return (
    <View style={styles.timelineItem}>
      <View style={styles.timelineDot}>
        <View style={[styles.dot, { backgroundColor: getTypeColor() }]} />
        <View style={styles.timelineLine} />
      </View>
      <View style={styles.timelineContent}>
        <Text style={styles.timelineTitle}>{title}</Text>
        {description && (
          <Text style={styles.timelineDesc} numberOfLines={2}>{description}</Text>
        )}
        <Text style={styles.timelineDate}>{formatDate(date)}</Text>
      </View>
    </View>
  );
}

interface AlertCardProps {
  title: string;
  message: string;
  severity: string;
  createdAt: string;
}

function AlertCard({ title, message, severity, createdAt }: AlertCardProps) {
  const getSeverityColor = () => {
    switch (severity) {
      case 'critical': return Colors.danger;
      case 'high': return '#F59E0B';
      case 'medium': return Colors.primary;
      default: return Colors.success;
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <View style={[styles.alertCard, { borderLeftColor: getSeverityColor() }]}>
      <View style={styles.alertCardHeader}>
        <AlertTriangle size={16} color={getSeverityColor()} />
        <Text style={styles.alertCardTitle}>{title}</Text>
        <Text style={styles.alertCardDate}>{formatDate(createdAt)}</Text>
      </View>
      <Text style={styles.alertCardMessage} numberOfLines={2}>{message}</Text>
    </View>
  );
}

export default function PatientDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [refreshing, setRefreshing] = useState(false);

  const patientQuery = trpc.clinic.patients.getById.useQuery({ id: id || '' });
  const overviewQuery = trpc.clinic.dashboard.getPatientOverview.useQuery({ patientId: id || '' });
  const healthHistoryQuery = trpc.clinic.patients.getHealthHistory.useQuery({ patientId: id || '' });

  const patient = patientQuery.data;
  const overview = overviewQuery.data;
  const healthHistory = healthHistoryQuery.data;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      patientQuery.refetch(),
      overviewQuery.refetch(),
      healthHistoryQuery.refetch(),
    ]);
    setRefreshing(false);
  }, [patientQuery, overviewQuery, healthHistoryQuery]);

  const isLoading = patientQuery.isLoading || overviewQuery.isLoading;

  if (isLoading && !refreshing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!patient) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>Patient not found</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const calculateAge = (dob: string) => {
    const birthDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  };

  const tabs: { key: TabType; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'timeline', label: 'Timeline' },
    { key: 'alerts', label: 'Alerts' },
    { key: 'outcome', label: 'Outcome Report' },
  ];

  const getStatusColor = () => {
    switch (patient.status) {
      case 'active': return Colors.success;
      case 'inactive': return Colors.warning;
      case 'archived': return Colors.textTertiary;
    }
  };

  return (
    <>
      <Stack.Screen 
        options={{ 
          title: `${patient.firstName} ${patient.lastName}`,
          headerBackTitle: 'Back',
        }} 
      />
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.profileHeader}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {patient.firstName.charAt(0)}{patient.lastName.charAt(0)}
            </Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.patientName}>{patient.firstName} {patient.lastName}</Text>
            <View style={styles.profileMeta}>
              <Text style={styles.profileAge}>{calculateAge(patient.dateOfBirth)} yrs</Text>
              <View style={styles.divider} />
              <Text style={styles.profileSex}>{patient.sex.charAt(0).toUpperCase() + patient.sex.slice(1)}</Text>
              <View style={[styles.statusBadge, { backgroundColor: getStatusColor() + '20' }]}>
                <View style={[styles.statusDot, { backgroundColor: getStatusColor() }]} />
                <Text style={[styles.statusText, { color: getStatusColor() }]}>
                  {patient.status.charAt(0).toUpperCase() + patient.status.slice(1)}
                </Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.statsRow}>
          <StatBox
            label="Alerts"
            value={overview?.alertCount || 0}
            color={Colors.danger}
            icon={<AlertTriangle size={18} color={Colors.danger} />}
          />
          <StatBox
            label="Labs"
            value={overview?.labCount || 0}
            color={Colors.primary}
            icon={<FileText size={18} color={Colors.primary} />}
          />
          <StatBox
            label="Readings"
            value={overview?.biometricCount || 0}
            color={Colors.success}
            icon={<Activity size={18} color={Colors.success} />}
          />
        </View>

        <View style={styles.tabBar}>
          {tabs.map((tab) => (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tab, activeTab === tab.key && styles.tabActive]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {activeTab === 'overview' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Contact Information</Text>
            <View style={styles.card}>
              <InfoRow
                icon={<Mail size={16} color={Colors.textSecondary} />}
                label="Email"
                value={patient.email}
              />
              <InfoRow
                icon={<Phone size={16} color={Colors.textSecondary} />}
                label="Phone"
                value={patient.phone}
              />
              <InfoRow
                icon={<Calendar size={16} color={Colors.textSecondary} />}
                label="Date of Birth"
                value={new Date(patient.dateOfBirth).toLocaleDateString('en-US', { 
                  month: 'long', day: 'numeric', year: 'numeric' 
                })}
              />
              {patient.city && (
                <InfoRow
                  icon={<MapPin size={16} color={Colors.textSecondary} />}
                  label="Location"
                  value={`${patient.city}${patient.state ? `, ${patient.state}` : ''}`}
                />
              )}
            </View>

            {healthHistory && (
              <>
                <Text style={styles.sectionTitle}>Health Summary</Text>
                <View style={styles.card}>
                  {healthHistory.conditions.length > 0 && (
                    <View style={styles.healthItem}>
                      <Text style={styles.healthLabel}>Current Conditions</Text>
                      <View style={styles.tagList}>
                        {healthHistory.conditions.map((condition, i) => (
                          <View key={i} style={styles.healthTag}>
                            <Text style={styles.healthTagText}>{condition}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}
                  {healthHistory.allergies.length > 0 && (
                    <View style={styles.healthItem}>
                      <Text style={styles.healthLabel}>Allergies</Text>
                      <View style={styles.tagList}>
                        {healthHistory.allergies.map((allergy, i) => (
                          <View key={i} style={[styles.healthTag, styles.allergyTag]}>
                            <Text style={[styles.healthTagText, styles.allergyTagText]}>
                              {allergy.allergen}
                            </Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}
                  {healthHistory.currentMedications.length > 0 && (
                    <View style={styles.healthItem}>
                      <Text style={styles.healthLabel}>Current Medications</Text>
                      {healthHistory.currentMedications.map((med, i) => (
                        <Text key={i} style={styles.medicationText}>
                          {med.name} - {med.dose} {med.frequency}
                        </Text>
                      ))}
                    </View>
                  )}
                </View>
              </>
            )}

            {patient.tags.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Tags</Text>
                <View style={styles.tagList}>
                  {patient.tags.map((tag, i) => (
                    <View key={i} style={styles.patientTag}>
                      <Text style={styles.patientTagText}>{tag}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}
          </View>
        )}

        {activeTab === 'timeline' && (
          <View style={styles.section}>
            {overview?.timeline && overview.timeline.length > 0 ? (
              <View style={styles.timeline}>
                {overview.timeline.map((event) => (
                  <TimelineItem
                    key={event.id}
                    type={event.type}
                    title={event.title}
                    description={event.description}
                    date={event.date}
                  />
                ))}
              </View>
            ) : (
              <View style={styles.emptyState}>
                <ClipboardList size={40} color={Colors.textTertiary} />
                <Text style={styles.emptyText}>No activity recorded yet</Text>
              </View>
            )}
          </View>
        )}

        {activeTab === 'alerts' && (
          <View style={styles.section}>
            {overview?.recentAlerts && overview.recentAlerts.length > 0 ? (
              <View style={styles.alertsList}>
                {overview.recentAlerts.map((alert) => (
                  <AlertCard
                    key={alert.id}
                    title={alert.title}
                    message={alert.message}
                    severity={alert.severity}
                    createdAt={alert.createdAt}
                  />
                ))}
              </View>
            ) : (
              <View style={styles.emptyState}>
                <Heart size={40} color={Colors.success} />
                <Text style={styles.emptyText}>No active alerts</Text>
              </View>
            )}
          </View>
        )}

        {activeTab === 'outcome' && id && (
          <View style={{ paddingHorizontal: 16, paddingBottom: 24 }}>
            <OutcomePanelForPatient clinicPatientId={id} />
          </View>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: 20,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
    padding: 20,
  },
  errorText: {
    fontSize: 18,
    color: Colors.text,
    marginBottom: 16,
  },
  backButton: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  backButtonText: {
    color: Colors.textInverse,
    fontSize: 16,
    fontWeight: '600' as const,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.primary + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  avatarText: {
    fontSize: 26,
    fontWeight: '700' as const,
    color: Colors.primary,
  },
  profileInfo: {
    flex: 1,
  },
  patientName: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 6,
  },
  profileMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  profileAge: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  profileSex: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  divider: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.textTertiary,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600' as const,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  statBox: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
  },
  statIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '700' as const,
  },
  statLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 4,
    marginBottom: 20,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 10,
  },
  tabActive: {
    backgroundColor: Colors.primary,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
  },
  tabTextActive: {
    color: Colors.textInverse,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 12,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  infoIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: Colors.surfaceSecondary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  infoContent: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 15,
    color: Colors.text,
  },
  healthItem: {
    marginBottom: 14,
  },
  healthLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    marginBottom: 8,
  },
  tagList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  healthTag: {
    backgroundColor: Colors.primary + '15',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  healthTagText: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '500' as const,
  },
  allergyTag: {
    backgroundColor: Colors.danger + '15',
  },
  allergyTagText: {
    color: Colors.danger,
  },
  medicationText: {
    fontSize: 14,
    color: Colors.text,
    marginBottom: 4,
  },
  patientTag: {
    backgroundColor: Colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  patientTagText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500' as const,
  },
  timeline: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
  },
  timelineItem: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  timelineDot: {
    alignItems: 'center',
    marginRight: 14,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  timelineLine: {
    flex: 1,
    width: 2,
    backgroundColor: Colors.borderLight,
    marginTop: 4,
    marginBottom: -4,
  },
  timelineContent: {
    flex: 1,
    paddingBottom: 20,
  },
  timelineTitle: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  timelineDesc: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  timelineDate: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 6,
  },
  alertsList: {
    gap: 12,
  },
  alertCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    borderLeftWidth: 4,
  },
  alertCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  alertCardTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  alertCardDate: {
    fontSize: 12,
    color: Colors.textTertiary,
  },
  alertCardMessage: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  emptyState: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 12,
  },
});
