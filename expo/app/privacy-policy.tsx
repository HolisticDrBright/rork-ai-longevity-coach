import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { Stack } from 'expo-router';
import { Shield, Heart, Lock, Eye, Trash2, Globe } from 'lucide-react-native';
import Colors from '@/constants/colors';

interface PolicySectionProps {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}

function PolicySection({ icon, title, children }: PolicySectionProps) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        {icon}
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <View style={styles.sectionBody}>
        {children}
      </View>
    </View>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={styles.bulletRow}>
      <View style={styles.bulletDot} />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

export default function PrivacyPolicyScreen() {
  const effectiveDate = "March 25, 2026";

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Privacy Policy',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
        }}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Shield color={Colors.textInverse} size={28} />
          </View>
          <Text style={styles.heroTitle}>Privacy Policy</Text>
          <Text style={styles.heroSubtitle}>
            AI Longevity Pro takes your privacy seriously. This policy explains how we collect, use, and protect your health data.
          </Text>
          <Text style={styles.effectiveDate}>Effective: {effectiveDate}</Text>
        </View>

        <PolicySection
          icon={<Heart color={Colors.danger} size={18} />}
          title="Health Data We Collect"
        >
          <Text style={styles.body}>
            AI Longevity Pro collects and processes the following categories of Protected Health Information (PHI) and personal data:
          </Text>
          <Bullet text="Biometric data: heart rate, HRV, blood pressure, SpO2, body temperature, sleep metrics, steps, and activity data from connected wearables (Apple Health, Oura, WHOOP, Fitbit, Garmin)." />
          <Bullet text="Lab results: biomarker values, reference ranges, panel names, and collection dates uploaded or entered manually." />
          <Bullet text="Nutrition logs: meal descriptions, calorie and macronutrient totals, meal timing, and dietary preferences." />
          <Bullet text="Supplement and medication logs: supplement names, dosages, timing, and adherence records." />
          <Bullet text="Symptom and subjective logs: symptom names, severity ratings, mood, energy, stress, and sleep quality scores." />
          <Bullet text="Hormone tracking: cycle day, symptom patterns, and related supplement data." />
          <Bullet text="Clinical intake data: chief complaints, associated symptoms, medical history, conditions, allergies, and contraindications (collected only when using clinician features)." />
          <Bullet text="Profile information: name, email, date of birth, sex, height, weight, health goals, and lifestyle preferences." />
          <Bullet text="Questionnaire responses: onboarding health questionnaire severity scores used to generate personalized protocols." />
        </PolicySection>

        <PolicySection
          icon={<Eye color={Colors.primary} size={18} />}
          title="How We Use Your Data"
        >
          <Bullet text="Generate personalized longevity protocols, supplement recommendations, and daily action plans." />
          <Bullet text="Compute recovery scores, baselines, detected patterns, and correlations across your health metrics." />
          <Bullet text="Display trends, insights, and practitioner flags to help you and your clinician make informed decisions." />
          <Bullet text="Send notification reminders for supplements, check-ins, and protocol adherence." />
          <Bullet text="Improve the accuracy of AI-generated recommendations over time (using de-identified, aggregated data only)." />
          <Text style={styles.bodyBold}>
            We never sell your health data to third parties. We never use your PHI for advertising.
          </Text>
        </PolicySection>

        <PolicySection
          icon={<Lock color={Colors.warning} size={18} />}
          title="Data Security & Storage"
        >
          <Bullet text="All data is stored in Supabase with Row-Level Security (RLS) enabled on every table. Each user can only access their own rows." />
          <Bullet text="Data in transit is encrypted via TLS 1.2+. Data at rest is encrypted using AES-256 by Supabase's underlying PostgreSQL infrastructure." />
          <Bullet text="Authentication tokens are stored in secure device storage (Keychain on iOS, Keystore on Android) via expo-secure-store." />
          <Bullet text="Sensitive fields (wearable OAuth tokens) are stored encrypted and never exposed in API responses." />
          <Bullet text="Sentry error monitoring is configured with PHI scrubbing — patient names, email addresses, health values, and tokens are redacted before any error payload leaves the device or server." />
          <Bullet text="HIPAA-compliant audit logging tracks all data access, modifications, and deletions with tamper-detection hashing." />
          <Bullet text="Optional biometric authentication (Face ID / fingerprint) provides an additional layer of session protection." />
        </PolicySection>

        <PolicySection
          icon={<Globe color={Colors.secondary} size={18} />}
          title="Third-Party Services"
        >
          <Text style={styles.body}>We use the following third-party services:</Text>
          <Bullet text="Supabase (database and authentication) — processes and stores your health data. Subject to Supabase's privacy policy and BAA." />
          <Bullet text="Sentry (error monitoring) — receives scrubbed error reports with no PHI. Subject to Sentry's privacy policy." />
          <Bullet text="Wearable providers (Apple Health, Oura, WHOOP, Fitbit, Garmin) — we read data you authorize. We do not share your data back to these providers beyond what is required for the integration." />
          <Text style={styles.body}>
            We maintain a Business Associate Agreement (BAA) with Supabase to ensure HIPAA compliance for all stored PHI.
          </Text>
        </PolicySection>

        <PolicySection
          icon={<Trash2 color={Colors.danger} size={18} />}
          title="Your Rights & Data Deletion"
        >
          <Bullet text="Access: You can view all your health data within the app at any time." />
          <Bullet text="Export: You may request a full export of your data by contacting support." />
          <Bullet text="Deletion: You can permanently delete all your PHI from the Profile > Privacy & Security > Delete All My Data option. This is irreversible and removes all records from every table." />
          <Bullet text="Correction: You can edit or update any health entry, lab result, or profile information directly in the app." />
          <Bullet text="Portability: Upon request, we will provide your data in a standard machine-readable format (JSON)." />
          <Text style={styles.body}>
            Data deletion requests are processed immediately. Deleted data cannot be recovered. Audit log entries are retained for 7 years as required by HIPAA.
          </Text>
        </PolicySection>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Shield color={Colors.primary} size={18} />
            <Text style={styles.sectionTitle}>HIPAA Compliance</Text>
          </View>
          <View style={styles.sectionBody}>
            <Text style={styles.body}>
              AI Longevity Pro is designed to comply with the Health Insurance Portability and Accountability Act (HIPAA). We implement administrative, physical, and technical safeguards including:
            </Text>
            <Bullet text="Encryption at rest and in transit for all PHI." />
            <Bullet text="Row-Level Security ensuring strict data isolation between users." />
            <Bullet text="Audit logging with integrity verification." />
            <Bullet text="Automatic session timeout and biometric re-authentication." />
            <Bullet text="PHI scrubbing in all error reporting and monitoring systems." />
            <Bullet text="Business Associate Agreements with all sub-processors." />
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Contact</Text>
          </View>
          <View style={styles.sectionBody}>
            <Text style={styles.body}>
              For questions about this privacy policy, data requests, or to report a security concern, contact us at:
            </Text>
            <Text style={styles.contactEmail}>privacy@ailongevitypro.com</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Shield size={12} color={Colors.textTertiary} />
          <Text style={styles.footerText}>
            Last updated: {effectiveDate}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  hero: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 28,
    alignItems: 'center',
  },
  heroIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: Colors.textInverse,
    marginBottom: 8,
  },
  heroSubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 12,
  },
  effectiveDate: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 12,
  },
  section: {
    marginHorizontal: 20,
    marginTop: 20,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  sectionBody: {
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  body: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 21,
    marginBottom: 10,
  },
  bodyBold: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
    lineHeight: 21,
    marginTop: 6,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
    paddingRight: 4,
  },
  bulletDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.primary,
    marginTop: 7,
    marginRight: 10,
    flexShrink: 0,
  },
  bulletText: {
    flex: 1,
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  contactEmail: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.primary,
    marginTop: 4,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 24,
    marginBottom: 12,
  },
  footerText: {
    fontSize: 12,
    color: Colors.textTertiary,
  },
});
