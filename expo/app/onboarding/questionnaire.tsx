import { useState, useMemo } from 'react';
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
import {
  ChevronRight,
  ChevronLeft,
  ClipboardList,
  Stethoscope,
  Activity,
  Zap,
  Thermometer,
  Droplet,
  TrendingUp,
  Shield,
  Bug,
  Target,
  CloudRain,
  Atom,
  Dna,
  Wifi,
  AlertCircle,
} from 'lucide-react-native';

import Colors from '@/constants/colors';
import { useUser } from '@/providers/UserProvider';
import { questionnaireCategories } from '@/mocks/questionnaire';


const iconMap: Record<string, any> = {
  Thermometer,
  Zap,
  Activity,
  Stethoscope,
  Droplet,
  TrendingUp,
  Shield,
  Bug,
  Target,
  CloudRain,
  Atom,
  Dna,
  Wifi,
  AlertCircle,
};

const severityLabels = ['None', 'Mild', 'Moderate', 'Significant', 'Severe'];

export default function OnboardingQuestionnaireScreen() {
  const { saveQuestionnaireResponse, questionnaireResponses, completeOnboarding } = useUser();
  const [currentCategoryIndex, setCurrentCategoryIndex] = useState(0);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);

  const currentCategory = questionnaireCategories[currentCategoryIndex];
  const currentQuestion = currentCategory?.questions[currentQuestionIndex];

  const currentResponse = useMemo(() => {
    if (!currentQuestion) return null;
    return questionnaireResponses.find(r => r.questionId === currentQuestion.id);
  }, [currentQuestion, questionnaireResponses]);

  const totalQuestions = questionnaireCategories.reduce(
    (sum, cat) => sum + cat.questions.length,
    0
  );

  const currentQuestionNumber = useMemo(() => {
    let count = 0;
    for (let i = 0; i < currentCategoryIndex; i++) {
      count += questionnaireCategories[i].questions.length;
    }
    return count + currentQuestionIndex + 1;
  }, [currentCategoryIndex, currentQuestionIndex]);

  const progress = totalQuestions > 0 ? (currentQuestionNumber / totalQuestions) * 100 : 0;

  const handleSeveritySelect = (severity: number) => {
    if (!currentQuestion || !currentCategory) return;

    console.log(`Answering question ${currentQuestionIndex + 1}/${currentCategory.questions.length} in category ${currentCategoryIndex + 1}/${questionnaireCategories.length}`);

    saveQuestionnaireResponse({
      questionId: currentQuestion.id,
      categoryId: currentCategory.id,
      severity,
      timestamp: new Date().toISOString(),
    });

    const isLastQuestionInCategory = currentQuestionIndex >= currentCategory.questions.length - 1;
    const isLastCategory = currentCategoryIndex >= questionnaireCategories.length - 1;

    if (!isLastQuestionInCategory) {
      console.log('Moving to next question in category');
      setCurrentQuestionIndex(currentQuestionIndex + 1);
    } else if (!isLastCategory) {
      console.log(`Moving to next category: ${questionnaireCategories[currentCategoryIndex + 1]?.name}`);
      setCurrentCategoryIndex(currentCategoryIndex + 1);
      setCurrentQuestionIndex(0);
    } else {
      console.log('Reached last question of questionnaire');
    }
  };

  const handlePrevious = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(prev => prev - 1);
    } else if (currentCategoryIndex > 0) {
      const prevCategory = questionnaireCategories[currentCategoryIndex - 1];
      setCurrentCategoryIndex(prev => prev - 1);
      setCurrentQuestionIndex(prevCategory.questions.length - 1);
    }
  };

  const handleComplete = () => {
    completeOnboarding();
    router.replace('/(tabs)/insights');
  };

  const isLastQuestion =
    currentCategoryIndex === questionnaireCategories.length - 1 &&
    currentQuestionIndex === currentCategory?.questions.length - 1;

  const canGoBack = currentCategoryIndex > 0 || currentQuestionIndex > 0;

  const IconComponent = iconMap[currentCategory?.icon] || ClipboardList;

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[Colors.primary, Colors.primaryDark]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => router.back()}
            >
              <ChevronLeft color={Colors.textInverse} size={24} />
            </TouchableOpacity>

            <View style={styles.progressContainer}>
              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${progress}%` }]} />
              </View>
              <Text style={styles.progressText}>
                {currentQuestionNumber} / {totalQuestions} questions
              </Text>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.categoryBadge}>
          <IconComponent color={Colors.primary} size={18} />
          <Text style={styles.categoryName}>{currentCategory?.name}</Text>
        </View>

        <Text style={styles.questionNumber}>
          Question {currentQuestionIndex + 1} of {currentCategory?.questions.length}
        </Text>

        <Text style={styles.questionText}>{currentQuestion?.text}</Text>

        <View style={styles.severityContainer}>
          {severityLabels.map((label, index) => {
            const isSelected = currentResponse?.severity === index;
            const colorIntensity = index / 4;

            return (
              <TouchableOpacity
                key={label}
                style={[
                  styles.severityOption,
                  isSelected && styles.severityOptionSelected,
                  isSelected && {
                    backgroundColor:
                      index <= 1
                        ? Colors.success
                        : index === 2
                        ? Colors.warning
                        : Colors.coral,
                  },
                ]}
                onPress={() => handleSeveritySelect(index)}
              >
                <View
                  style={[
                    styles.severityIndicator,
                    {
                      backgroundColor: isSelected
                        ? Colors.textInverse
                        : index <= 1
                        ? Colors.success
                        : index === 2
                        ? Colors.warning
                        : Colors.coral,
                      opacity: isSelected ? 1 : 0.3 + colorIntensity * 0.7,
                    },
                  ]}
                />
                <Text
                  style={[
                    styles.severityLabel,
                    isSelected && styles.severityLabelSelected,
                  ]}
                >
                  {label}
                </Text>
                <Text
                  style={[
                    styles.severityScore,
                    isSelected && styles.severityScoreSelected,
                  ]}
                >
                  {index}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.categoryProgress}>
          <Text style={styles.categoryProgressTitle}>Categories</Text>
          <View style={styles.categoryDots}>
            {questionnaireCategories.map((cat, index) => {
              const catResponses = questionnaireResponses.filter(
                r => r.categoryId === cat.id
              );
              const isComplete = catResponses.length === cat.questions.length;
              const isCurrent = index === currentCategoryIndex;

              return (
                <View
                  key={cat.id}
                  style={[
                    styles.categoryDot,
                    isComplete && styles.categoryDotComplete,
                    isCurrent && styles.categoryDotCurrent,
                  ]}
                />
              );
            })}
          </View>
        </View>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <View style={styles.footerButtons}>
          {canGoBack && (
            <TouchableOpacity style={styles.prevButton} onPress={handlePrevious}>
              <ChevronLeft color={Colors.primary} size={20} />
              <Text style={styles.prevText}>Previous</Text>
            </TouchableOpacity>
          )}

          {isLastQuestion && currentResponse && (
            <TouchableOpacity
              style={styles.completeButton}
              onPress={handleComplete}
            >
              <Text style={styles.completeText}>Complete</Text>
              <ChevronRight color={Colors.textInverse} size={20} />
            </TouchableOpacity>
          )}
        </View>

        <Text style={styles.skipHint}>
          Select a severity level to continue
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
    marginBottom: 20,
  },
  progressContainer: {
    gap: 8,
  },
  progressBar: {
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.accent,
    borderRadius: 3,
  },
  progressText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.8)',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 140,
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.surfaceSecondary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    alignSelf: 'flex-start',
    marginBottom: 16,
  },
  categoryName: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  questionNumber: {
    fontSize: 13,
    color: Colors.textTertiary,
    marginBottom: 8,
  },
  questionText: {
    fontSize: 22,
    fontWeight: '600' as const,
    color: Colors.text,
    lineHeight: 30,
    marginBottom: 32,
  },
  severityContainer: {
    gap: 12,
  },
  severityOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 18,
  },
  severityOptionSelected: {
    borderColor: 'transparent',
  },
  severityIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 14,
  },
  severityLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500' as const,
    color: Colors.text,
  },
  severityLabelSelected: {
    color: Colors.textInverse,
  },
  severityScore: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.textTertiary,
  },
  severityScoreSelected: {
    color: 'rgba(255,255,255,0.8)',
  },
  categoryProgress: {
    marginTop: 32,
    paddingTop: 24,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  categoryProgressTitle: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
    marginBottom: 12,
  },
  categoryDots: {
    flexDirection: 'row',
    gap: 8,
  },
  categoryDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.border,
  },
  categoryDotComplete: {
    backgroundColor: Colors.success,
  },
  categoryDotCurrent: {
    backgroundColor: Colors.primary,
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
  footerButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  prevButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: Colors.surfaceSecondary,
  },
  prevText: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.primary,
  },
  completeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    backgroundColor: Colors.success,
    gap: 8,
  },
  completeText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.textInverse,
  },
  skipHint: {
    fontSize: 13,
    color: Colors.textTertiary,
    textAlign: 'center',
  },
});
