import { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { AlertTriangle, Check, ChevronLeft, ChevronRight, ShieldCheck } from 'lucide-react-native';

import Colors from '@/constants/colors';
import { useUser } from '@/providers/UserProvider';
import { questionnaireCategories } from '@/mocks/questionnaire';
import { CONSENTS, QUESTIONNAIRE } from '@/registry';

/**
 * Review + attestation before submission. Shows completeness per section —
 * sections under the registry's completeness floor are flagged as "needs more
 * answers" because they will report insufficient data rather than a score.
 * Submission is what freezes the answers; until then everything is editable.
 */
export default function OnboardingReviewScreen() {
  const { questionnaireResponses, completeOnboarding } = useUser();
  const [attested, setAttested] = useState(false);

  const floor = QUESTIONNAIRE.interpretation.insufficientDataBelowCompleteness;

  const sections = useMemo(
    () =>
      questionnaireCategories.map((cat) => {
        const responses = questionnaireResponses.filter((r) => r.categoryId === cat.id);
        const special = responses.filter((r) => r.special).length;
        const rated = responses.length - special;
        const total = cat.questions.length;
        const completeness = total > 0 ? rated / total : 0;
        return {
          id: cat.id,
          name: cat.name,
          total,
          rated,
          special,
          unanswered: total - responses.length,
          belowFloor: completeness < floor,
        };
      }),
    [questionnaireResponses, floor],
  );

  const totals = useMemo(
    () =>
      sections.reduce(
        (acc, s) => ({
          rated: acc.rated + s.rated,
          special: acc.special + s.special,
          unanswered: acc.unanswered + s.unanswered,
          total: acc.total + s.total,
        }),
        { rated: 0, special: 0, unanswered: 0, total: 0 },
      ),
    [sections],
  );

  const requiredConsents = CONSENTS.filter((c) => c.required);

  const handleSubmit = () => {
    if (!attested) return;
    completeOnboarding();
    router.replace('/onboarding/submitted');
  };

  return (
    <View style={styles.container}>
      <LinearGradient colors={[Colors.primary, Colors.primaryDark]} style={styles.headerGradient}>
        <SafeAreaView edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
              <ChevronLeft color={Colors.textInverse} size={24} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Review your answers</Text>
            <Text style={styles.headerSubtitle}>
              {totals.rated} rated · {totals.special} marked NA/unsure · {totals.unanswered} unanswered
            </Text>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.sectionHeading}>Sections</Text>
        {sections.map((s) => (
          <TouchableOpacity
            key={s.id}
            style={styles.sectionRow}
            onPress={() =>
              router.push({ pathname: '/onboarding/questionnaire', params: { category: s.id } })
            }
            testID={`review-section-${s.id}`}
          >
            <View style={styles.sectionInfo}>
              <Text style={styles.sectionName}>{s.name}</Text>
              <Text style={styles.sectionCounts}>
                {s.rated} of {s.total} rated
                {s.special > 0 ? ` · ${s.special} NA/unsure` : ''}
                {s.unanswered > 0 ? ` · ${s.unanswered} unanswered` : ''}
              </Text>
              {s.belowFloor && (
                <View style={styles.floorWarning}>
                  <AlertTriangle color={Colors.warning} size={14} />
                  <Text style={styles.floorWarningText}>
                    Needs more answers for a reliable screen — this section will show
                    &ldquo;insufficient data&rdquo; instead of a score.
                  </Text>
                </View>
              )}
            </View>
            <ChevronRight color={Colors.textTertiary} size={18} />
          </TouchableOpacity>
        ))}

        <View style={styles.consentCard}>
          <View style={styles.consentHeader}>
            <ShieldCheck color={Colors.primary} size={18} />
            <Text style={styles.consentTitle}>What submitting means</Text>
          </View>
          <Text style={styles.consentBody}>
            Your answers are locked once submitted and sent to your practitioner for review.
            Screening scores are symptom-pattern screens, not a diagnosis. Nothing is ordered,
            prescribed, or changed automatically — your practitioner reviews everything first.
          </Text>
          <Text style={styles.consentVersions}>
            Acknowledged documents:{' '}
            {requiredConsents.map((c) => `${c.title} (${c.version})`).join(' · ')}
          </Text>
        </View>

        <TouchableOpacity
          style={styles.attestRow}
          onPress={() => setAttested((v) => !v)}
          testID="attestation-toggle"
        >
          <View style={[styles.checkbox, attested && styles.checkboxChecked]}>
            {attested && <Check color={Colors.textInverse} size={16} />}
          </View>
          <Text style={styles.attestText}>
            I confirm these answers are accurate to the best of my knowledge and I understand my
            practitioner will review them before any next steps.
          </Text>
        </TouchableOpacity>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <TouchableOpacity
          style={[styles.submitButton, !attested && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={!attested}
          testID="submit-assessment"
        >
          <Text style={styles.submitText}>Submit for practitioner review</Text>
        </TouchableOpacity>
        <Text style={styles.footerHint}>
          You can keep editing answers until you submit.
        </Text>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  headerGradient: {
    paddingBottom: 20,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: Colors.textInverse,
    marginBottom: 6,
  },
  headerSubtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 160,
  },
  sectionHeading: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    marginBottom: 12,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  sectionInfo: {
    flex: 1,
    gap: 4,
  },
  sectionName: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  sectionCounts: {
    fontSize: 13,
    color: Colors.textTertiary,
  },
  floorWarning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 4,
  },
  floorWarningText: {
    flex: 1,
    fontSize: 12,
    color: Colors.warning,
    lineHeight: 16,
  },
  consentCard: {
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 14,
    padding: 16,
    marginTop: 16,
    gap: 8,
  },
  consentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  consentTitle: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  consentBody: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 19,
  },
  consentVersions: {
    fontSize: 12,
    color: Colors.textTertiary,
    lineHeight: 17,
  },
  attestRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginTop: 20,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxChecked: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  attestText: {
    flex: 1,
    fontSize: 14,
    color: Colors.text,
    lineHeight: 20,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.background,
    paddingHorizontal: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  submitButton: {
    borderRadius: 14,
    backgroundColor: Colors.success,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 8,
  },
  submitButtonDisabled: {
    opacity: 0.4,
  },
  submitText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.textInverse,
  },
  footerHint: {
    fontSize: 12,
    color: Colors.textTertiary,
    textAlign: 'center',
  },
});
