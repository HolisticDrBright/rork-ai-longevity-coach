import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
  TextInput,
  Animated,
  Easing,
  Platform,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import {
  Camera,
  Image as ImageIcon,
  Coffee,
  Sun,
  Moon,
  Apple,
  ChevronRight,
  Type,
  Mic,
  Square,
  Sparkles,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
} from 'expo-audio';

import Colors from '@/constants/colors';
import { useNutrition } from '@/providers/NutritionProvider';
import { MealType } from '@/types';
import { trpc } from '@/lib/trpc';
import { parseMealText } from '@/utils/nutrition/parseMealText';
import { transcribeAudio } from '@/utils/nutrition/transcribeAudio';

type InputMode = 'photo' | 'text' | 'voice';

const MEAL_OPTIONS: { type: MealType; label: string; icon: React.ReactNode; time: string }[] = [
  { type: 'breakfast', label: 'Breakfast', icon: <Coffee size={22} color={Colors.chartOrange} />, time: '6 - 10am' },
  { type: 'lunch', label: 'Lunch', icon: <Sun size={22} color={Colors.chartBlue} />, time: '11 - 2pm' },
  { type: 'dinner', label: 'Dinner', icon: <Moon size={22} color={Colors.chartPurple} />, time: '5 - 9pm' },
  { type: 'snack', label: 'Snack', icon: <Apple size={22} color={Colors.success} />, time: 'Anytime' },
];

const MODE_OPTIONS: { mode: InputMode; label: string; icon: React.ReactNode; sub: string }[] = [
  { mode: 'photo', label: 'Photo', icon: <Camera size={18} color={Colors.text} />, sub: 'Snap your plate' },
  { mode: 'text', label: 'Text', icon: <Type size={18} color={Colors.text} />, sub: 'Type what you ate' },
  { mode: 'voice', label: 'Voice', icon: <Mic size={18} color={Colors.text} />, sub: 'Say it out loud' },
];

export default function NewMealCapture() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { setPendingMealAnalysis, dietProfile } = useNutrition();

  const [selectedMeal, setSelectedMeal] = useState<MealType | null>(null);
  const [mode, setMode] = useState<InputMode>('photo');

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const [mealText, setMealText] = useState('');
  const [isParsingText, setIsParsingText] = useState(false);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 250);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [transcript, setTranscript] = useState<string>('');

  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (recorderState.isRecording) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.25,
            duration: 700,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: Platform.OS !== 'web',
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 700,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: Platform.OS !== 'web',
          }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [recorderState.isRecording, pulseAnim]);

  const analyzePhotoMutation = trpc.nutrition.analyzePhoto.useMutation({
    onSuccess: (data) => {
      console.log('Analysis successful:', data.foodLogId);
      setPendingMealAnalysis({
        foodLogId: data.foodLogId,
        detectedItems: data.detectedItems,
        mealType: selectedMeal!,
        photoBase64,
      });
      router.push('/(tabs)/(nutrition)/confirm' as any);
    },
    onError: (error) => {
      console.error('Analysis failed:', error);
      Alert.alert('Analysis Failed', 'Could not analyze the photo. Please try again.');
    },
    onSettled: () => {
      setIsAnalyzing(false);
    },
  });

  const pickImage = useCallback(async (useCamera: boolean) => {
    try {
      const permissionResult = useCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permissionResult.granted) {
        Alert.alert('Permission Required', `Please grant ${useCamera ? 'camera' : 'photo library'} access to continue.`);
        return;
      }

      const result = useCamera
        ? await ImagePicker.launchCameraAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true,
            aspect: [4, 3],
            quality: 0.8,
            base64: true,
          })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true,
            aspect: [4, 3],
            quality: 0.8,
            base64: true,
          });

      if (!result.canceled && result.assets[0]) {
        setPhotoUri(result.assets[0].uri);
        setPhotoBase64(result.assets[0].base64 || null);
      }
    } catch (error) {
      console.error('Image picker error:', error);
      Alert.alert('Error', 'Failed to capture image. Please try again.');
    }
  }, []);

  const handleAnalyzePhoto = useCallback(async () => {
    if (!selectedMeal) {
      Alert.alert('Select Meal Type', 'Please select whether this is breakfast, lunch, dinner, or a snack.');
      return;
    }
    if (!photoBase64) {
      Alert.alert('Add Photo', 'Please take or upload a photo of your meal.');
      return;
    }
    setIsAnalyzing(true);
    analyzePhotoMutation.mutate({
      photoBase64,
      mealType: selectedMeal,
      userId: dietProfile.userId || 'user_default',
    });
  }, [selectedMeal, photoBase64, dietProfile.userId, analyzePhotoMutation]);

  const goToConfirm = useCallback(
    (items: Awaited<ReturnType<typeof parseMealText>>) => {
      const foodLogId = `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      setPendingMealAnalysis({
        foodLogId,
        detectedItems: items,
        mealType: selectedMeal!,
        photoBase64: null,
      });
      router.push('/(tabs)/(nutrition)/confirm' as any);
    },
    [selectedMeal, setPendingMealAnalysis, router]
  );

  const handleParseText = useCallback(async () => {
    if (!selectedMeal) {
      Alert.alert('Select Meal Type', 'Please choose which meal this is.');
      return;
    }
    if (!mealText.trim()) {
      Alert.alert('Describe your meal', 'Type what you ate so we can break it down.');
      return;
    }

    setIsParsingText(true);
    try {
      const items = await parseMealText(mealText.trim());
      goToConfirm(items);
    } catch (error) {
      console.error('Parse text failed:', error);
      Alert.alert('Could not parse', 'Try rephrasing what you ate or use the photo option.');
    } finally {
      setIsParsingText(false);
    }
  }, [mealText, selectedMeal, goToConfirm]);

  const handleStartRecording = useCallback(async () => {
    if (!selectedMeal) {
      Alert.alert('Select Meal Type', 'Please choose which meal this is first.');
      return;
    }
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Microphone Required', 'Please grant microphone access to log meals by voice.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setTranscript('');
    } catch (error) {
      console.error('Start recording failed:', error);
      Alert.alert('Recording Error', 'Could not start the recording. Please try again.');
    }
  }, [recorder, selectedMeal]);

  const handleStopAndProcess = useCallback(async () => {
    setIsProcessingVoice(true);
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
      const uri = recorder.uri;
      if (!uri) throw new Error('No recording produced');

      const text = await transcribeAudio(uri);
      setTranscript(text);
      if (!text.trim()) {
        Alert.alert('No speech detected', 'We could not hear anything. Try recording again.');
        setIsProcessingVoice(false);
        return;
      }
      const items = await parseMealText(text);
      goToConfirm(items);
    } catch (error) {
      console.error('Voice processing failed:', error);
      Alert.alert('Voice Logging Failed', 'Could not understand the recording. Please try again.');
    } finally {
      setIsProcessingVoice(false);
    }
  }, [recorder, goToConfirm]);

  const handleSkipPhoto = useCallback(() => {
    if (!selectedMeal) {
      Alert.alert('Select Meal Type', 'Please select whether this is breakfast, lunch, dinner, or a snack.');
      return;
    }
    goToConfirm([]);
  }, [selectedMeal, goToConfirm]);

  const renderPhotoMode = () => (
    <View style={styles.modePanel}>
      <Text style={styles.panelTitle}>Snap your meal</Text>
      <Text style={styles.panelSubtitle}>We'll identify the foods automatically</Text>

      {photoUri ? (
        <View style={styles.photoPreviewContainer}>
          <Image source={{ uri: photoUri }} style={styles.photoPreview} />
          <TouchableOpacity
            style={styles.changePhotoButton}
            onPress={() => {
              setPhotoUri(null);
              setPhotoBase64(null);
            }}
            testID="change-photo"
          >
            <Text style={styles.changePhotoText}>Change Photo</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.photoButtons}>
          <TouchableOpacity
            style={styles.photoButton}
            onPress={() => pickImage(true)}
            activeOpacity={0.7}
            testID="take-photo"
          >
            <View style={styles.photoButtonIcon}>
              <Camera size={26} color={Colors.primary} />
            </View>
            <Text style={styles.photoButtonLabel}>Take Photo</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.photoButton}
            onPress={() => pickImage(false)}
            activeOpacity={0.7}
            testID="upload-photo"
          >
            <View style={styles.photoButtonIcon}>
              <ImageIcon size={26} color={Colors.primary} />
            </View>
            <Text style={styles.photoButtonLabel}>Upload Photo</Text>
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity
        style={[
          styles.primaryButton,
          (!selectedMeal || !photoBase64 || isAnalyzing) && styles.primaryButtonDisabled,
        ]}
        onPress={handleAnalyzePhoto}
        disabled={isAnalyzing || !selectedMeal || !photoBase64}
        activeOpacity={0.85}
        testID="analyze-photo"
      >
        {isAnalyzing ? (
          <>
            <ActivityIndicator color={Colors.textInverse} size="small" />
            <Text style={styles.primaryButtonText}>Analyzing...</Text>
          </>
        ) : (
          <>
            <Sparkles size={18} color={Colors.textInverse} />
            <Text style={styles.primaryButtonText}>Analyze Photo</Text>
            <ChevronRight size={18} color={Colors.textInverse} />
          </>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={styles.skipButton} onPress={handleSkipPhoto} activeOpacity={0.7}>
        <Text style={styles.skipButtonText}>Skip and add foods manually</Text>
      </TouchableOpacity>
    </View>
  );

  const renderTextMode = () => (
    <View style={styles.modePanel}>
      <Text style={styles.panelTitle}>Type what you ate</Text>
      <Text style={styles.panelSubtitle}>
        Plain English works — e.g. "2 eggs, half avocado on sourdough toast and a coffee"
      </Text>

      <TextInput
        style={styles.textArea}
        value={mealText}
        onChangeText={setMealText}
        placeholder="What did you eat?"
        placeholderTextColor={Colors.textTertiary}
        multiline
        textAlignVertical="top"
        editable={!isParsingText}
        testID="meal-text-input"
      />

      <View style={styles.suggestionRow}>
        {[
          'Greek yogurt with berries and honey',
          'Grilled salmon, brown rice, broccoli',
          'Chicken caesar salad',
        ].map((suggestion) => (
          <TouchableOpacity
            key={suggestion}
            style={styles.suggestionChip}
            onPress={() => setMealText(suggestion)}
            activeOpacity={0.7}
          >
            <Text style={styles.suggestionText} numberOfLines={1}>
              {suggestion}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        style={[
          styles.primaryButton,
          (!selectedMeal || !mealText.trim() || isParsingText) && styles.primaryButtonDisabled,
        ]}
        onPress={handleParseText}
        disabled={isParsingText || !selectedMeal || !mealText.trim()}
        activeOpacity={0.85}
        testID="parse-text"
      >
        {isParsingText ? (
          <>
            <ActivityIndicator color={Colors.textInverse} size="small" />
            <Text style={styles.primaryButtonText}>Reading your meal...</Text>
          </>
        ) : (
          <>
            <Sparkles size={18} color={Colors.textInverse} />
            <Text style={styles.primaryButtonText}>Log This Meal</Text>
            <ChevronRight size={18} color={Colors.textInverse} />
          </>
        )}
      </TouchableOpacity>
    </View>
  );

  const renderVoiceMode = () => {
    const isRecording = recorderState.isRecording;
    const seconds = Math.floor((recorderState.durationMillis ?? 0) / 1000);
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
    const ss = String(seconds % 60).padStart(2, '0');

    return (
      <View style={styles.modePanel}>
        <Text style={styles.panelTitle}>Tell me what you ate</Text>
        <Text style={styles.panelSubtitle}>
          Tap the mic and speak naturally. We'll transcribe and break down the macros.
        </Text>

        <View style={styles.voiceContainer}>
          <Animated.View
            style={[
              styles.voicePulse,
              isRecording && styles.voicePulseActive,
              { transform: [{ scale: pulseAnim }] },
            ]}
          />
          <TouchableOpacity
            style={[styles.voiceButton, isRecording && styles.voiceButtonActive]}
            onPress={isRecording ? handleStopAndProcess : handleStartRecording}
            disabled={isProcessingVoice}
            activeOpacity={0.85}
            testID="voice-record"
          >
            {isProcessingVoice ? (
              <ActivityIndicator color={Colors.textInverse} size="large" />
            ) : isRecording ? (
              <Square size={32} color={Colors.textInverse} fill={Colors.textInverse} />
            ) : (
              <Mic size={36} color={Colors.textInverse} />
            )}
          </TouchableOpacity>

          <Text style={styles.voiceTimer}>
            {isProcessingVoice ? 'Processing…' : isRecording ? `${mm}:${ss}` : 'Tap to record'}
          </Text>
          <Text style={styles.voiceHint}>
            {isRecording ? 'Tap again to stop and analyze' : 'Try: "I had a turkey sandwich and an apple"'}
          </Text>
        </View>

        {transcript.length > 0 && !isProcessingVoice && (
          <View style={styles.transcriptCard}>
            <Text style={styles.transcriptLabel}>Heard you say</Text>
            <Text style={styles.transcriptText}>{transcript}</Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Log Meal' }} />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>What meal is this?</Text>
          <View style={styles.mealRow}>
            {MEAL_OPTIONS.map((option) => {
              const selected = selectedMeal === option.type;
              return (
                <TouchableOpacity
                  key={option.type}
                  style={[styles.mealChip, selected && styles.mealChipSelected]}
                  onPress={() => setSelectedMeal(option.type)}
                  activeOpacity={0.8}
                  testID={`meal-${option.type}`}
                >
                  <View style={styles.mealChipIcon}>{option.icon}</View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.mealChipLabel, selected && styles.mealChipLabelSelected]}>
                      {option.label}
                    </Text>
                    <Text style={styles.mealChipTime}>{option.time}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>How are you logging it?</Text>
          <View style={styles.modeSwitch}>
            {MODE_OPTIONS.map((opt) => {
              const active = mode === opt.mode;
              return (
                <TouchableOpacity
                  key={opt.mode}
                  style={[styles.modeTab, active && styles.modeTabActive]}
                  onPress={() => setMode(opt.mode)}
                  activeOpacity={0.85}
                  testID={`mode-${opt.mode}`}
                >
                  <View style={styles.modeTabIcon}>
                    {React.cloneElement(opt.icon as React.ReactElement, {
                      color: active ? Colors.primary : Colors.textSecondary,
                    })}
                  </View>
                  <Text style={[styles.modeTabLabel, active && styles.modeTabLabelActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {mode === 'photo' && renderPhotoMode()}
        {mode === 'text' && renderTextMode()}
        {mode === 'voice' && renderVoiceMode()}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 20,
  },
  section: {
    marginBottom: 22,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.6,
    marginBottom: 12,
  },
  mealRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  mealChip: {
    width: '47.5%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  mealChipSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '0D',
  },
  mealChipIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.surfaceSecondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mealChipLabel: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  mealChipLabelSelected: {
    color: Colors.primary,
  },
  mealChipTime: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 1,
  },
  modeSwitch: {
    flexDirection: 'row',
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 14,
    padding: 4,
    gap: 4,
  },
  modeTab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    gap: 4,
  },
  modeTabActive: {
    backgroundColor: Colors.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  modeTabIcon: {
    height: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modeTabLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  modeTabLabelActive: {
    color: Colors.primary,
  },
  modePanel: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  panelTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 4,
  },
  panelSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 16,
    lineHeight: 18,
  },
  photoButtons: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  photoButton: {
    flex: 1,
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 14,
    paddingVertical: 22,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.borderLight,
    borderStyle: 'dashed' as const,
  },
  photoButtonIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: Colors.primary + '15',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  photoButtonLabel: {
    fontSize: 13,
    fontWeight: '500' as const,
    color: Colors.text,
  },
  photoPreviewContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  photoPreview: {
    width: '100%',
    height: 200,
    borderRadius: 14,
    backgroundColor: Colors.surfaceSecondary,
  },
  changePhotoButton: {
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 8,
  },
  changePhotoText: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '500' as const,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 14,
    padding: 15,
    gap: 8,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryButtonDisabled: {
    backgroundColor: Colors.textTertiary,
    shadowOpacity: 0,
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.textInverse,
  },
  skipButton: {
    alignItems: 'center',
    paddingTop: 12,
  },
  skipButtonText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500' as const,
  },
  textArea: {
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 14,
    padding: 14,
    fontSize: 15,
    color: Colors.text,
    minHeight: 110,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  suggestionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  suggestionChip: {
    backgroundColor: Colors.primary + '10',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    maxWidth: '100%',
  },
  suggestionText: {
    fontSize: 12,
    color: Colors.primary,
    fontWeight: '500' as const,
  },
  voiceContainer: {
    alignItems: 'center',
    paddingVertical: 24,
    position: 'relative' as const,
  },
  voicePulse: {
    position: 'absolute' as const,
    top: 24,
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: Colors.primary + '20',
    opacity: 0,
  },
  voicePulseActive: {
    opacity: 1,
  },
  voiceButton: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 8,
  },
  voiceButtonActive: {
    backgroundColor: Colors.danger,
    shadowColor: Colors.danger,
  },
  voiceTimer: {
    marginTop: 18,
    fontSize: 22,
    fontWeight: '700' as const,
    color: Colors.text,
    fontVariant: ['tabular-nums'] as const,
  },
  voiceHint: {
    marginTop: 4,
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center' as const,
  },
  transcriptCard: {
    marginTop: 8,
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 12,
    padding: 14,
    borderLeftWidth: 3,
    borderLeftColor: Colors.primary,
  },
  transcriptLabel: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.textTertiary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  transcriptText: {
    fontSize: 14,
    color: Colors.text,
    lineHeight: 20,
  },
});
