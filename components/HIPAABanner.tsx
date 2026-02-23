import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Shield, AlertTriangle, X } from 'lucide-react-native';
import Colors from '@/constants/colors';

interface HIPAAConsentBannerProps {
  onAccept: () => void;
}

export function HIPAAConsentBanner({ onAccept }: HIPAAConsentBannerProps) {
  return (
    <View style={styles.overlay}>
      <View style={styles.consentCard}>
        <View style={styles.iconRow}>
          <Shield size={28} color={Colors.primary} />
          <Text style={styles.consentTitle}>Privacy & Data Protection</Text>
        </View>

        <ScrollView style={styles.consentScroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.consentText}>
            This application processes Protected Health Information (PHI) in compliance with HIPAA regulations.
          </Text>

          <Text style={styles.consentHeading}>Your Data Rights</Text>
          <Text style={styles.consentText}>
            {'\u2022'} Your health data is encrypted at rest and in transit{'\n'}
            {'\u2022'} Access is logged and auditable{'\n'}
            {'\u2022'} You can request deletion of all your data at any time{'\n'}
            {'\u2022'} Sessions auto-lock after 5 minutes of inactivity{'\n'}
            {'\u2022'} PIN/biometric authentication protects your data
          </Text>

          <Text style={styles.consentHeading}>Data Collection</Text>
          <Text style={styles.consentText}>
            We collect only the minimum health information necessary to provide personalized wellness guidance, including lab results, symptom tracking, and lifestyle data.
          </Text>

          <Text style={styles.consentHeading}>Third-Party Services</Text>
          <Text style={styles.consentText}>
            AI analysis features transmit de-identified data for processing. No PHI is stored by third-party services beyond the processing session.
          </Text>

          <Text style={styles.consentHeading}>Medical Disclaimer</Text>
          <Text style={styles.consentText}>
            This app provides educational and informational content only. It does not constitute medical advice, diagnosis, or treatment. Always consult a qualified healthcare provider.
          </Text>
        </ScrollView>

        <TouchableOpacity style={styles.acceptButton} onPress={onAccept} testID="accept-consent">
          <Shield size={18} color="#fff" />
          <Text style={styles.acceptButtonText}>I Understand & Accept</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

interface BreachAlertProps {
  count: number;
  onPress: () => void;
}

export function BreachAlertBanner({ count, onPress }: BreachAlertProps) {
  if (count === 0) return null;

  return (
    <TouchableOpacity style={styles.breachBanner} onPress={onPress} testID="breach-alert">
      <AlertTriangle size={18} color="#fff" />
      <Text style={styles.breachText}>
        {count} security alert{count > 1 ? 's' : ''} require attention
      </Text>
    </TouchableOpacity>
  );
}

interface FTCDisclosureProps {
  compact?: boolean;
}

export function FTCDisclosure({ compact = false }: FTCDisclosureProps) {
  if (compact) {
    return (
      <Text style={styles.ftcCompact}>
        Affiliate Disclosure: Links may earn a commission at no extra cost to you.
      </Text>
    );
  }

  return (
    <View style={styles.ftcContainer}>
      <Text style={styles.ftcTitle}>FTC Affiliate Disclosure</Text>
      <Text style={styles.ftcText}>
        This content contains affiliate links. If you purchase through these links, we may earn a commission at no additional cost to you. Product recommendations are based on your health profile and are not influenced by affiliate relationships.
      </Text>
    </View>
  );
}

export function MedicalDisclaimer() {
  return (
    <View style={styles.disclaimerContainer}>
      <AlertTriangle size={14} color={Colors.warning} />
      <Text style={styles.disclaimerText}>
        For educational purposes only. Not medical advice. Consult your healthcare provider before making health decisions.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    zIndex: 1000,
  },
  consentCard: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 24,
    maxHeight: '85%',
    width: '100%',
    maxWidth: 400,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 12,
  },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  consentTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  consentScroll: {
    maxHeight: 400,
    marginBottom: 20,
  },
  consentHeading: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text,
    marginTop: 16,
    marginBottom: 6,
  },
  consentText: {
    fontSize: 13,
    lineHeight: 20,
    color: Colors.textSecondary,
  },
  acceptButton: {
    backgroundColor: Colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  acceptButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600' as const,
  },
  breachBanner: {
    backgroundColor: Colors.danger,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 10,
  },
  breachText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600' as const,
    flex: 1,
  },
  ftcContainer: {
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 10,
    padding: 12,
    marginVertical: 8,
    borderLeftWidth: 3,
    borderLeftColor: Colors.warning,
  },
  ftcTitle: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  ftcText: {
    fontSize: 11,
    lineHeight: 16,
    color: Colors.textTertiary,
  },
  ftcCompact: {
    fontSize: 10,
    color: Colors.textTertiary,
    fontStyle: 'italic' as const,
    textAlign: 'center' as const,
    paddingVertical: 4,
  },
  disclaimerContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: 'rgba(255,152,0,0.08)',
    borderRadius: 8,
    padding: 10,
    marginVertical: 8,
  },
  disclaimerText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
    color: Colors.textSecondary,
  },
});
