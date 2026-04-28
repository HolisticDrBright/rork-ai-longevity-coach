import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { router, Stack } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  Stethoscope,
  Users,
  ClipboardList,
  Bell,
  FlaskConical,
  Package,
  ShieldCheck,
  ChevronRight,
  ArrowLeft,
  Sparkles,
  CheckCircle2,
  Lock,
} from 'lucide-react-native';

import Colors from '@/constants/colors';
import { useUser } from '@/providers/UserProvider';

interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  color: string;
}

function FeatureCard({ icon, title, description, color }: FeatureCardProps) {
  return (
    <View style={styles.featureCard} testID={`feature-${title}`}>
      <View style={[styles.featureIcon, { backgroundColor: color + '15' }]}>
        {icon}
      </View>
      <View style={styles.featureContent}>
        <Text style={styles.featureTitle}>{title}</Text>
        <Text style={styles.featureDesc}>{description}</Text>
      </View>
    </View>
  );
}

export default function PractitionerPortalLanding() {
  const insets = useSafeAreaInsets();
  const { isClinician, userProfile } = useUser();

  const firstName = userProfile.firstName || 'Practitioner';

  const features = useMemo(
    () => [
      {
        icon: <Users size={20} color={Colors.primary} />,
        color: Colors.primary,
        title: 'Patient Roster',
        description: 'Manage, search, and review every active patient in one place.',
      },
      {
        icon: <Bell size={20} color={Colors.danger} />,
        color: Colors.danger,
        title: 'Critical Alerts',
        description: 'Real-time triage of high-priority biometric and lab events.',
      },
      {
        icon: <FlaskConical size={20} color={Colors.accent} />,
        color: Colors.accent,
        title: 'Lab Reviews',
        description: 'Sign off on uploaded panels with annotated insights.',
      },
      {
        icon: <ClipboardList size={20} color={Colors.success} />,
        color: Colors.success,
        title: 'Protocols',
        description: 'Build, assign, and adjust personalized care plans.',
      },
      {
        icon: <Package size={20} color={Colors.chartPurple}/>,
        color: Colors.chartPurple,
        title: 'Supplements Admin',
        description: 'Curate Fullscript-ready supplement & peptide stacks.',
      },
      {
        icon: <ShieldCheck size={20} color={Colors.secondary} />,
        color: Colors.secondary,
        title: 'HIPAA Audit',
        description: 'Encrypted PHI access with tamper-evident audit trail.',
      },
    ],
    []
  );

  const handleEnterPortal = () => {
    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    router.replace('/(tabs)/(clinic)/dashboard' as any);
  };

  const handleApply = () => {
    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    router.push('/practitioner/apply' as any);
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/profile' as any);
    }
  };

  return (
    <View style={styles.container} testID="practitioner-portal-landing">
      <Stack.Screen options={{ headerShown: false }} />

      <LinearGradient
        colors={[Colors.primaryDark, Colors.primary, Colors.primaryLight]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.hero}
      >
        <SafeAreaView edges={['top']}>
          <View style={styles.heroTopBar}>
            <TouchableOpacity
              onPress={handleBack}
              style={styles.backButton}
              testID="back-button"
            >
              <ArrowLeft size={20} color={Colors.textInverse} />
            </TouchableOpacity>
            {isClinician && (
              <View style={styles.statusPill}>
                <CheckCircle2 size={12} color={Colors.textInverse} />
                <Text style={styles.statusPillText}>Verified</Text>
              </View>
            )}
          </View>

          <View style={styles.heroContent}>
            <View style={styles.heroBadge}>
              <Stethoscope size={14} color={Colors.textInverse} />
              <Text style={styles.heroBadgeText}>For Healthcare Providers</Text>
            </View>
            <Text style={styles.heroTitle}>
              Practitioners{'\n'}Portal
            </Text>
            <Text style={styles.heroSubtitle}>
              {isClinician
                ? `Welcome back, Dr. ${userProfile.lastName || firstName}. Your clinic command center is ready.`
                : 'A clinician-grade workspace for managing patients, reviewing labs, and orchestrating personalized longevity protocols.'}
            </Text>
          </View>
        </SafeAreaView>

        <View style={styles.heroDecorRing1} pointerEvents="none" />
        <View style={styles.heroDecorRing2} pointerEvents="none" />
      </LinearGradient>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 140 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statBoxValue}>HIPAA</Text>
            <Text style={styles.statBoxLabel}>Compliant</Text>
          </View>
          <View style={styles.statBoxDivider} />
          <View style={styles.statBox}>
            <Text style={styles.statBoxValue}>AES-256</Text>
            <Text style={styles.statBoxLabel}>PHI Encryption</Text>
          </View>
          <View style={styles.statBoxDivider} />
          <View style={styles.statBox}>
            <Text style={styles.statBoxValue}>24/7</Text>
            <Text style={styles.statBoxLabel}>Patient Sync</Text>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Sparkles size={16} color={Colors.primary} />
            <Text style={styles.sectionTitle}>Inside the portal</Text>
          </View>
          <View style={styles.featuresGrid}>
            {features.map((f) => (
              <FeatureCard
                key={f.title}
                icon={f.icon}
                title={f.title}
                description={f.description}
                color={f.color}
              />
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>How it works</Text>
          <View style={styles.stepsList}>
            <Step
              number={1}
              title="Apply with your credentials"
              description="Submit your license, NPI, and specialty for verification."
            />
            <Step
              number={2}
              title="Get verified"
              description="Our compliance team reviews credentials in 1–2 business days."
            />
            <Step
              number={3}
              title="Manage your patients"
              description="Access the clinic tab to review labs, alerts, and protocols."
            />
          </View>
        </View>

        <View style={styles.complianceCard}>
          <Lock size={16} color={Colors.primary} />
          <Text style={styles.complianceText}>
            All Protected Health Information is encrypted at rest and in transit.
            Access is logged with tamper-evident audit trails per HIPAA requirements.
          </Text>
        </View>
      </ScrollView>

      <View
        style={[styles.ctaBar, { paddingBottom: insets.bottom + 16 }]}
        testID="cta-bar"
      >
        {isClinician ? (
          <TouchableOpacity
            style={styles.ctaPrimary}
            onPress={handleEnterPortal}
            activeOpacity={0.85}
            testID="enter-portal-button"
          >
            <Text style={styles.ctaPrimaryText}>Enter Clinic Dashboard</Text>
            <ChevronRight size={18} color={Colors.textInverse} />
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity
              style={styles.ctaPrimary}
              onPress={handleApply}
              activeOpacity={0.85}
              testID="apply-button"
            >
              <Text style={styles.ctaPrimaryText}>Apply for Access</Text>
              <ChevronRight size={18} color={Colors.textInverse} />
            </TouchableOpacity>
            <Text style={styles.ctaHint}>
              Already approved? Sign in from the welcome screen with your provider account.
            </Text>
          </>
        )}
      </View>
    </View>
  );
}

function Step({
  number,
  title,
  description,
}: {
  number: number;
  title: string;
  description: string;
}) {
  return (
    <View style={styles.step}>
      <View style={styles.stepNumber}>
        <Text style={styles.stepNumberText}>{number}</Text>
      </View>
      <View style={styles.stepContent}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={styles.stepDesc}>{description}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  hero: {
    paddingBottom: 32,
    overflow: 'hidden',
  },
  heroTopBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: Colors.textInverse,
    letterSpacing: 0.5,
  },
  heroContent: {
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 16,
  },
  heroBadgeText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textInverse,
    letterSpacing: 0.3,
  },
  heroTitle: {
    fontSize: 40,
    fontWeight: '800' as const,
    color: Colors.textInverse,
    lineHeight: 44,
    letterSpacing: -1,
    marginBottom: 12,
  },
  heroSubtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: 'rgba(255,255,255,0.85)',
    maxWidth: 340,
  },
  heroDecorRing1: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 140,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    right: -100,
    top: -80,
  },
  heroDecorRing2: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    right: -40,
    bottom: -60,
  },
  scroll: {
    flex: 1,
    marginTop: -20,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 12,
    marginBottom: 28,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
  },
  statBoxValue: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: Colors.primary,
    letterSpacing: -0.3,
  },
  statBoxLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 4,
    fontWeight: '500' as const,
  },
  statBoxDivider: {
    width: 1,
    backgroundColor: Colors.borderLight,
  },
  section: {
    marginBottom: 28,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
    letterSpacing: -0.3,
  },
  featuresGrid: {
    gap: 10,
  },
  featureCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  featureIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureContent: {
    flex: 1,
  },
  featureTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 2,
  },
  featureDesc: {
    fontSize: 12.5,
    color: Colors.textSecondary,
    lineHeight: 17,
  },
  stepsList: {
    gap: 14,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderLeftWidth: 3,
    borderLeftColor: Colors.primary,
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: {
    fontSize: 13,
    fontWeight: '800' as const,
    color: Colors.textInverse,
  },
  stepContent: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 2,
  },
  stepDesc: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  complianceCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: Colors.primary + '0D',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.primary + '20',
  },
  complianceText: {
    flex: 1,
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 17,
  },
  ctaBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.surface,
    paddingHorizontal: 20,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  ctaPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    paddingVertical: 16,
    borderRadius: 14,
    shadowColor: Colors.primary,
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  ctaPrimaryText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.textInverse,
    letterSpacing: 0.2,
  },
  ctaHint: {
    fontSize: 11,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: 10,
  },
});
