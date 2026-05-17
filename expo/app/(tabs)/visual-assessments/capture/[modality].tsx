import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Camera, ImagePlus, CheckCircle, RotateCcw } from 'lucide-react-native';

import Colors from '@/constants/colors';
import {
  analyzeVisualSession,
  type Angle,
  type Modality,
  type ModalityCapture,
} from '@/lib/visualAnalyzerClient';

interface ModalityGuide {
  modality: Modality;
  angle: Angle;
  title: string;
  instructions: string[];
  whiteBalanceTip: string;
}

const GUIDES: Record<string, ModalityGuide> = {
  skin: {
    modality: 'skin',
    angle: 'portrait',
    title: 'Facial skin — front portrait',
    instructions: [
      'Find even, indirect daylight or a single soft lamp.',
      'Remove makeup and avoid recent skincare (last 30 min).',
      'Face the camera straight on, neutral expression.',
      'Frame from forehead to chin, both ears visible.',
    ],
    whiteBalanceTip: 'If you have the printed white-balance reference card, hold it next to your face for the first shot.',
  },
  tongue: {
    modality: 'tongue',
    angle: 'tongue_extended',
    title: 'TCM tongue — extended',
    instructions: [
      'No food, drink, or brushing in the last 30 minutes.',
      'Avoid coffee, beets, blueberries, and other staining foods today.',
      'Open mouth wide, extend tongue fully, relaxed.',
      'Capture in natural daylight if possible (no yellow indoor bulbs).',
    ],
    whiteBalanceTip: 'Tongue coat color is interpreted relative to a white reference — include the card if you have it.',
  },
};

export default function CaptureScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ modality: string; baseline?: string }>();
  const modalityKey = params.modality ?? '';
  const isBaseline = params.baseline === '1';
  const guide = GUIDES[modalityKey];

  const [imageUri, setImageUri] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [phase, setPhase] = useState<string>('');

  if (!guide) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.errorText}>This modality is not yet available.</Text>
      </SafeAreaView>
    );
  }

  const pickFromCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera permission needed', 'Enable camera access in Settings to capture.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      base64: false,
    });
    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
    }
  };

  const pickFromLibrary = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Photo library permission needed', 'Enable photo access in Settings to choose an image.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      base64: false,
    });
    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
    }
  };

  const startAnalysis = async () => {
    if (!imageUri) return;
    setIsAnalyzing(true);
    setPhase('Uploading...');
    try {
      const capture: ModalityCapture = {
        modality: guide.modality,
        angle: guide.angle,
        fileUri: imageUri,
        mimeType: 'image/jpeg',
        fileName: `${guide.modality}_${Date.now()}.jpg`,
      };

      const result = await analyzeVisualSession(
        { captures: [capture], isBaseline },
        {
          onProgress: ({ phase: p, status }) => {
            if (p === 'upload') setPhase('Uploading image...');
            if (p === 'analyzing') setPhase(status ? `Status: ${status}` : 'Analyzing...');
            if (p === 'correlating') setPhase('Correlating findings...');
            if (p === 'complete') setPhase('Complete');
          },
        },
      );

      router.replace(`/(tabs)/visual-assessments/session/${result.sessionId}` as never);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log('[capture] analysis failed', msg);
      Alert.alert('Analysis failed', msg);
      setIsAnalyzing(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>{guide.title}</Text>

        <View style={styles.instructionsCard}>
          <Text style={styles.instructionsHeader}>How to capture</Text>
          {guide.instructions.map((line) => (
            <View key={line} style={styles.instructionRow}>
              <Text style={styles.bullet}>•</Text>
              <Text style={styles.instructionText}>{line}</Text>
            </View>
          ))}
          <Text style={styles.whiteBalanceTip}>{guide.whiteBalanceTip}</Text>
        </View>

        {imageUri ? (
          <View style={styles.previewCard}>
            <Image source={{ uri: imageUri }} style={styles.preview} resizeMode="cover" />
            <View style={styles.previewActions}>
              <TouchableOpacity
                style={[styles.btn, styles.btnSecondary]}
                onPress={() => setImageUri(null)}
                disabled={isAnalyzing}
              >
                <RotateCcw size={16} color={Colors.text} />
                <Text style={styles.btnSecondaryText}>Retake</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnPrimary, isAnalyzing && styles.btnDisabled]}
                onPress={startAnalysis}
                disabled={isAnalyzing}
              >
                {isAnalyzing ? (
                  <ActivityIndicator size="small" color={Colors.textInverse} />
                ) : (
                  <CheckCircle size={16} color={Colors.textInverse} />
                )}
                <Text style={styles.btnPrimaryText}>
                  {isAnalyzing ? phase || 'Analyzing...' : 'Analyze'}
                </Text>
              </TouchableOpacity>
            </View>
            {isAnalyzing && (
              <Text style={styles.phaseLine}>
                This usually takes 30-60 seconds. You can leave the screen and come back — the assessment will continue.
              </Text>
            )}
          </View>
        ) : (
          <View style={styles.captureCard}>
            <TouchableOpacity style={styles.captureBtn} onPress={pickFromCamera}>
              <Camera size={28} color={Colors.primary} />
              <Text style={styles.captureBtnText}>Take photo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.captureBtnSecondary} onPress={pickFromLibrary}>
              <ImagePlus size={18} color={Colors.textSecondary} />
              <Text style={styles.captureBtnSecondaryText}>Choose from library</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 16, paddingBottom: 48 },
  title: { fontSize: 20, fontWeight: '700', color: Colors.text, marginBottom: 12 },
  instructionsCard: {
    backgroundColor: Colors.surface,
    padding: 14,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  instructionsHeader: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  instructionRow: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  bullet: { color: Colors.primary, fontWeight: '700' },
  instructionText: { flex: 1, fontSize: 13, color: Colors.text, lineHeight: 18 },
  whiteBalanceTip: {
    marginTop: 8,
    fontSize: 12,
    color: Colors.textSecondary,
    fontStyle: 'italic',
    lineHeight: 16,
  },
  captureCard: {
    backgroundColor: Colors.surface,
    padding: 24,
    borderRadius: 12,
    alignItems: 'center',
    gap: 16,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  captureBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.primary + '15',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 12,
    width: '100%',
    justifyContent: 'center',
  },
  captureBtnText: { fontSize: 16, fontWeight: '600', color: Colors.primary },
  captureBtnSecondary: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  captureBtnSecondaryText: { fontSize: 14, color: Colors.textSecondary },
  previewCard: { backgroundColor: Colors.surface, padding: 12, borderRadius: 12, gap: 12 },
  preview: { width: '100%', aspectRatio: 1, borderRadius: 8, backgroundColor: Colors.surfaceSecondary },
  previewActions: { flexDirection: 'row', gap: 8 },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 8,
  },
  btnPrimary: { backgroundColor: Colors.primary },
  btnPrimaryText: { color: Colors.textInverse, fontWeight: '600', fontSize: 14 },
  btnSecondary: { backgroundColor: Colors.surfaceSecondary },
  btnSecondaryText: { color: Colors.text, fontWeight: '600', fontSize: 14 },
  btnDisabled: { opacity: 0.6 },
  phaseLine: { fontSize: 11, color: Colors.textSecondary, textAlign: 'center', lineHeight: 16 },
  errorText: { padding: 24, fontSize: 14, color: Colors.danger },
});
