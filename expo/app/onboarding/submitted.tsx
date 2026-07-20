import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { CheckCircle2, ClipboardCheck, FlaskConical, MessageSquare } from 'lucide-react-native';

import Colors from '@/constants/colors';

/**
 * End state after submission. The message is deliberately explicit that the
 * submission goes to a practitioner for review and that nothing is ordered or
 * prescribed automatically.
 */
export default function OnboardingSubmittedScreen() {
  return (
    <LinearGradient colors={[Colors.primary, Colors.primaryDark]} style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.content}>
          <View style={styles.iconWrap}>
            <CheckCircle2 color={Colors.textInverse} size={64} />
          </View>
          <Text style={styles.title}>Submitted for practitioner review</Text>
          <Text style={styles.body}>
            Your health screening has been securely saved and shared with your practitioner.
            Nothing is ordered, prescribed, or changed automatically.
          </Text>

          <View style={styles.steps}>
            <View style={styles.stepRow}>
              <ClipboardCheck color={Colors.textInverse} size={20} />
              <Text style={styles.stepText}>
                Your practitioner reviews your answers and screening patterns.
              </Text>
            </View>
            <View style={styles.stepRow}>
              <FlaskConical color={Colors.textInverse} size={20} />
              <Text style={styles.stepText}>
                They may suggest lab panels — those stay drafts until they decide.
              </Text>
            </View>
            <View style={styles.stepRow}>
              <MessageSquare color={Colors.textInverse} size={20} />
              <Text style={styles.stepText}>
                You&apos;ll hear from your care team about any next steps.
              </Text>
            </View>
          </View>
        </View>

        <TouchableOpacity
          style={styles.continueButton}
          onPress={() => router.replace('/(tabs)/insights')}
          testID="continue-to-app"
        >
          <Text style={styles.continueText}>Explore your screening summary</Text>
        </TouchableOpacity>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safe: {
    flex: 1,
    paddingHorizontal: 28,
    paddingBottom: 24,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  iconWrap: {
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700' as const,
    color: Colors.textInverse,
    marginBottom: 14,
    lineHeight: 36,
  },
  body: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.9)',
    lineHeight: 24,
    marginBottom: 32,
  },
  steps: {
    gap: 18,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  stepText: {
    flex: 1,
    fontSize: 14,
    color: 'rgba(255,255,255,0.9)',
    lineHeight: 20,
  },
  continueButton: {
    backgroundColor: Colors.textInverse,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  continueText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.primary,
  },
});
