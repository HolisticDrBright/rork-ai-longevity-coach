import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  User,
  Target,
  ChevronRight,
  LogOut,
  FileText,
  Bell,
  Shield,
  HelpCircle,
  BarChart3,
  Stethoscope,
  Lock,
  Trash2,
  Fingerprint,
  ClipboardList,
  AlertTriangle,
  ShieldCheck,
} from 'lucide-react-native';

import Colors from '@/constants/colors';
import { useUser } from '@/providers/UserProvider';
import { useProtocol } from '@/providers/ProtocolProvider';
import { useAuth } from '@/providers/AuthProvider';
import { useHIPAA } from '@/providers/HIPAAProvider';

export default function ProfileScreen() {
  const { userProfile, lifestyleProfile, categoryScores, resetOnboarding, isLoading, isClinician, setUserRole } = useUser();
  const { weeklyAdherenceStats } = useProtocol();
  const { biometricAvailable, biometricEnabled, toggleBiometric, logout } = useAuth();
  const { requestDataDeletion, isDeleting, fetchAuditLogs, auditLogs, checkAuditIntegrity, auditIntegrity, unacknowledgedBreaches } = useHIPAA();
  const [showAuditLogs, setShowAuditLogs] = useState(false);

  const handleResetOnboarding = async () => {
    Alert.alert(
      'Reset Profile',
      'This will clear all your data and restart the onboarding process. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            await resetOnboarding();
            router.replace('/onboarding');
          },
        },
      ]
    );
  };

  const handleDeleteAllData = () => {
    Alert.alert(
      'Delete All Health Data',
      'This will permanently delete ALL your Protected Health Information (PHI) including lab results, protocols, hormone entries, nutrition logs, and personal information. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Everything',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Final Confirmation',
              'Are you absolutely sure? All encrypted health data will be permanently erased.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Yes, Delete All PHI',
                  style: 'destructive',
                  onPress: () => requestDataDeletion(),
                },
              ]
            );
          },
        },
      ]
    );
  };

  const handleLogout = () => {
    Alert.alert('Lock Session', 'Lock the app and require PIN to re-enter?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Lock', onPress: () => logout() },
    ]);
  };

  const handleViewAuditLogs = () => {
    fetchAuditLogs();
    checkAuditIntegrity();
    setShowAuditLogs(!showAuditLogs);
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  const age = userProfile.dateOfBirth
    ? Math.floor(
        (new Date().getTime() - new Date(userProfile.dateOfBirth).getTime()) /
          (365.25 * 24 * 60 * 60 * 1000)
      )
    : null;

  const weeklyAverage =
    weeklyAdherenceStats.reduce((sum, day) => sum + day.percentage, 0) /
    weeklyAdherenceStats.length;

  const topSymptomCategories = [...categoryScores]
    .sort((a, b) => b.percentage - a.percentage)
    .slice(0, 3);

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[Colors.primary, Colors.primaryLight]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={['top']}>
          <View style={styles.header}>
            <View style={styles.avatarContainer}>
              <Text style={styles.avatarText}>
                {userProfile.firstName?.[0]?.toUpperCase() || 'U'}
                {userProfile.lastName?.[0]?.toUpperCase() || ''}
              </Text>
            </View>
            <Text style={styles.userName}>
              {userProfile.firstName} {userProfile.lastName}
            </Text>
            <Text style={styles.userEmail}>{userProfile.email}</Text>

            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{age || '--'}</Text>
                <Text style={styles.statLabel}>Age</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{Math.round(weeklyAverage)}%</Text>
                <Text style={styles.statLabel}>Adherence</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{userProfile.goals.length}</Text>
                <Text style={styles.statLabel}>Goals</Text>
              </View>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Health Goals</Text>
          <View style={styles.goalsContainer}>
            {userProfile.goals.length > 0 ? (
              userProfile.goals.map((goal, index) => (
                <View key={index} style={styles.goalChip}>
                  <Target color={Colors.primary} size={14} />
                  <Text style={styles.goalText}>{goal}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.emptyText}>No goals set</Text>
            )}
          </View>
        </View>

        {topSymptomCategories.length > 0 && topSymptomCategories[0].percentage > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Top Symptom Areas</Text>
            {topSymptomCategories.map(category => (
              <View key={category.categoryId} style={styles.symptomRow}>
                <View style={styles.symptomInfo}>
                  <Text style={styles.symptomName}>{category.categoryName}</Text>
                  <Text style={styles.symptomScore}>
                    {category.score} / {category.maxScore}
                  </Text>
                </View>
                <View style={styles.symptomBarContainer}>
                  <View
                    style={[
                      styles.symptomBar,
                      {
                        width: `${category.percentage}%`,
                        backgroundColor:
                          category.percentage > 60
                            ? Colors.danger
                            : category.percentage > 30
                            ? Colors.warning
                            : Colors.success,
                      },
                    ]}
                  />
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Lifestyle Snapshot</Text>
          <View style={styles.lifestyleGrid}>
            <View style={styles.lifestyleItem}>
              <Text style={styles.lifestyleValue}>{lifestyleProfile.sleepHours}h</Text>
              <Text style={styles.lifestyleLabel}>Sleep</Text>
            </View>
            <View style={styles.lifestyleItem}>
              <Text style={styles.lifestyleValue}>{lifestyleProfile.exerciseFrequency}x</Text>
              <Text style={styles.lifestyleLabel}>Workouts/wk</Text>
            </View>
            <View style={styles.lifestyleItem}>
              <Text style={styles.lifestyleValue}>{lifestyleProfile.stressLevel}/10</Text>
              <Text style={styles.lifestyleLabel}>Stress</Text>
            </View>
            <View style={styles.lifestyleItem}>
              <Text style={styles.lifestyleValue}>
                {lifestyleProfile.dietType.charAt(0).toUpperCase() + lifestyleProfile.dietType.slice(1)}
              </Text>
              <Text style={styles.lifestyleLabel}>Diet</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Settings</Text>
          <View style={styles.menuContainer}>
            <TouchableOpacity style={styles.menuItem}>
              <View style={[styles.menuIcon, { backgroundColor: `${Colors.primary}15` }]}>
                <User color={Colors.primary} size={18} />
              </View>
              <Text style={styles.menuText}>Edit Profile</Text>
              <ChevronRight color={Colors.textTertiary} size={20} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.menuItem}>
              <View style={[styles.menuIcon, { backgroundColor: `${Colors.accent}15` }]}>
                <Bell color={Colors.accent} size={18} />
              </View>
              <Text style={styles.menuText}>Notifications</Text>
              <ChevronRight color={Colors.textTertiary} size={20} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.menuItem}>
              <View style={[styles.menuIcon, { backgroundColor: `${Colors.success}15` }]}>
                <BarChart3 color={Colors.success} size={18} />
              </View>
              <Text style={styles.menuText}>Progress Reports</Text>
              <ChevronRight color={Colors.textTertiary} size={20} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.menuItem}>
              <View style={[styles.menuIcon, { backgroundColor: `${Colors.chartPurple}15` }]}>
                <HelpCircle color={Colors.chartPurple} size={18} />
              </View>
              <Text style={styles.menuText}>Help & Support</Text>
              <ChevronRight color={Colors.textTertiary} size={20} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Privacy & Security</Text>
          {unacknowledgedBreaches.length > 0 && (
            <View style={styles.breachCard}>
              <AlertTriangle size={16} color={Colors.danger} />
              <Text style={styles.breachCardText}>
                {unacknowledgedBreaches.length} security alert{unacknowledgedBreaches.length > 1 ? 's' : ''} detected
              </Text>
            </View>
          )}
          <View style={styles.menuContainer}>
            {biometricAvailable && (
              <View style={styles.menuItem}>
                <View style={[styles.menuIcon, { backgroundColor: `${Colors.primary}15` }]}>
                  <Fingerprint color={Colors.primary} size={18} />
                </View>
                <Text style={styles.menuText}>Biometric Unlock</Text>
                <Switch
                  value={biometricEnabled}
                  onValueChange={toggleBiometric}
                  trackColor={{ false: Colors.border, true: Colors.primaryLight }}
                  thumbColor={biometricEnabled ? Colors.primary : '#f4f3f4'}
                />
              </View>
            )}

            <TouchableOpacity style={styles.menuItem} onPress={handleViewAuditLogs}>
              <View style={[styles.menuIcon, { backgroundColor: `${Colors.secondary}15` }]}>
                <ClipboardList color={Colors.secondary} size={18} />
              </View>
              <Text style={styles.menuText}>Audit Logs</Text>
              <ChevronRight color={Colors.textTertiary} size={20} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.menuItem} onPress={handleLogout}>
              <View style={[styles.menuIcon, { backgroundColor: `${Colors.warning}15` }]}>
                <Lock color={Colors.warning} size={18} />
              </View>
              <Text style={styles.menuText}>Lock Session</Text>
              <ChevronRight color={Colors.textTertiary} size={20} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.menuItem} onPress={handleDeleteAllData}>
              <View style={[styles.menuIcon, { backgroundColor: `${Colors.danger}15` }]}>
                <Trash2 color={Colors.danger} size={18} />
              </View>
              <Text style={[styles.menuText, { color: Colors.danger }]}>
                {isDeleting ? 'Deleting...' : 'Delete All My Data'}
              </Text>
              <ChevronRight color={Colors.danger} size={20} />
            </TouchableOpacity>
          </View>

          {showAuditLogs && auditLogs && (
            <View style={styles.auditSection}>
              <View style={styles.auditIntegrityRow}>
                <ShieldCheck size={14} color={auditIntegrity?.tampered === 0 ? Colors.success : Colors.danger} />
                <Text style={styles.auditIntegrityText}>
                  {auditIntegrity
                    ? `${auditIntegrity.valid}/${auditIntegrity.total} entries verified${auditIntegrity.tampered > 0 ? ` (${auditIntegrity.tampered} tampered)` : ''}`
                    : 'Verifying...'}
                </Text>
              </View>
              <Text style={styles.auditTitle}>Recent Activity ({auditLogs.length} entries)</Text>
              {auditLogs.slice(0, 20).map((log) => (
                <View key={log.id} style={styles.auditEntry}>
                  <Text style={styles.auditAction}>{log.action.replace(/_/g, ' ')}</Text>
                  <Text style={styles.auditDetail}>{log.resource} • {new Date(log.timestamp).toLocaleString()}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Clinician Mode</Text>
          <TouchableOpacity 
            style={styles.clinicianToggle}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              setUserRole(isClinician ? 'patient' : 'clinician');
            }}
          >
            <View style={[styles.menuIcon, { backgroundColor: isClinician ? `${Colors.primary}15` : `${Colors.textTertiary}15` }]}>
              <Stethoscope color={isClinician ? Colors.primary : Colors.textTertiary} size={18} />
            </View>
            <View style={styles.clinicianToggleContent}>
              <Text style={styles.menuText}>Clinician Portal</Text>
              <Text style={styles.clinicianToggleDesc}>
                {isClinician ? 'Access enabled - Clinic tab visible' : 'Enable to access patient management'}
              </Text>
            </View>
            <View style={[styles.toggleSwitch, isClinician && styles.toggleSwitchActive]}>
              <View style={[styles.toggleKnob, isClinician && styles.toggleKnobActive]} />
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.disclaimerCard}>
          <FileText color={Colors.textTertiary} size={18} />
          <Text style={styles.disclaimerText}>
            This app provides educational information only and is not intended as medical
            advice. Always consult with your healthcare provider before making changes
            to your health regimen.
          </Text>
        </View>

        <TouchableOpacity style={styles.resetButton} onPress={handleResetOnboarding}>
          <LogOut color={Colors.danger} size={18} />
          <Text style={styles.resetText}>Reset & Start Over</Text>
        </TouchableOpacity>

        <View style={styles.hipaaFooter}>
          <Shield size={12} color={Colors.textTertiary} />
          <Text style={styles.hipaaFooterText}>HIPAA-compliant encrypted storage</Text>
        </View>

        <Text style={styles.versionText}>AI Longevity Coach v1.0.0</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  loadingText: {
    fontSize: 16,
    color: Colors.textSecondary,
  },
  headerGradient: {
    paddingBottom: 24,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 16,
    alignItems: 'center',
  },
  avatarContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarText: {
    fontSize: 28,
    fontWeight: '700' as const,
    color: Colors.textInverse,
  },
  userName: {
    fontSize: 22,
    fontWeight: '700' as const,
    color: Colors.textInverse,
    marginBottom: 4,
  },
  userEmail: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    marginBottom: 20,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.textInverse,
  },
  statLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 30,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 12,
  },
  goalsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  goalChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  goalText: {
    fontSize: 14,
    color: Colors.text,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.textTertiary,
  },
  symptomRow: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  symptomInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  symptomName: {
    fontSize: 15,
    fontWeight: '500' as const,
    color: Colors.text,
  },
  symptomScore: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  symptomBarContainer: {
    height: 6,
    backgroundColor: Colors.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  symptomBar: {
    height: '100%',
    borderRadius: 3,
  },
  lifestyleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  lifestyleItem: {
    width: '47%',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
  },
  lifestyleValue: {
    fontSize: 22,
    fontWeight: '700' as const,
    color: Colors.primary,
    marginBottom: 4,
  },
  lifestyleLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  menuContainer: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  menuIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  menuText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500' as const,
    color: Colors.text,
  },
  disclaimerCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
  },
  disclaimerText: {
    flex: 1,
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  resetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.danger,
    marginBottom: 16,
  },
  resetText: {
    fontSize: 15,
    fontWeight: '500' as const,
    color: Colors.danger,
  },
  versionText: {
    fontSize: 13,
    color: Colors.textTertiary,
    textAlign: 'center',
  },
  clinicianToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
  },
  clinicianToggleContent: {
    flex: 1,
  },
  clinicianToggleDesc: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  toggleSwitch: {
    width: 50,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.border,
    padding: 3,
    justifyContent: 'center',
  },
  toggleSwitchActive: {
    backgroundColor: Colors.primary,
  },
  toggleKnob: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.textInverse,
  },
  toggleKnobActive: {
    alignSelf: 'flex-end',
  },
  breachCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(239,83,80,0.08)',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderLeftWidth: 3,
    borderLeftColor: Colors.danger,
  },
  breachCardText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.danger,
    flex: 1,
  },
  auditSection: {
    marginTop: 12,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
  },
  auditIntegrityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  auditIntegrityText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500' as const,
  },
  auditTitle: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 8,
  },
  auditEntry: {
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  auditAction: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.text,
    textTransform: 'capitalize' as const,
  },
  auditDetail: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  hipaaFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 8,
  },
  hipaaFooterText: {
    fontSize: 11,
    color: Colors.textTertiary,
    fontWeight: '500' as const,
  },
});
