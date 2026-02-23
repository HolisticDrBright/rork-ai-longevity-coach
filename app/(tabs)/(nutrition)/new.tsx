import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Camera, Image as ImageIcon, Barcode, Coffee, Sun, Moon, Apple, ChevronRight } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Colors from '@/constants/colors';
import { useNutrition } from '@/providers/NutritionProvider';
import { MealType } from '@/types';
import { trpc } from '@/lib/trpc';

const MEAL_OPTIONS: { type: MealType; label: string; icon: React.ReactNode; time: string }[] = [
  { type: 'breakfast', label: 'Breakfast', icon: <Coffee size={24} color={Colors.chartOrange} />, time: '6am - 10am' },
  { type: 'lunch', label: 'Lunch', icon: <Sun size={24} color={Colors.chartBlue} />, time: '11am - 2pm' },
  { type: 'dinner', label: 'Dinner', icon: <Moon size={24} color={Colors.chartPurple} />, time: '5pm - 9pm' },
  { type: 'snack', label: 'Snack', icon: <Apple size={24} color={Colors.success} />, time: 'Anytime' },
];

export default function NewMealCapture() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { setPendingMealAnalysis, dietProfile } = useNutrition();

  const [selectedMeal, setSelectedMeal] = useState<MealType | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

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

  const handleAnalyze = useCallback(async () => {
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

  const handleSkipPhoto = useCallback(() => {
    if (!selectedMeal) {
      Alert.alert('Select Meal Type', 'Please select whether this is breakfast, lunch, dinner, or a snack.');
      return;
    }

    const foodLogId = `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    setPendingMealAnalysis({
      foodLogId,
      detectedItems: [],
      mealType: selectedMeal,
      photoBase64: null,
    });
    router.push('/(tabs)/(nutrition)/confirm' as any);
  }, [selectedMeal, setPendingMealAnalysis, router]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Log Meal' }} />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>What meal is this?</Text>
          <View style={styles.mealGrid}>
            {MEAL_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.type}
                style={[
                  styles.mealCard,
                  selectedMeal === option.type && styles.mealCardSelected,
                ]}
                onPress={() => setSelectedMeal(option.type)}
                activeOpacity={0.7}
              >
                <View style={[
                  styles.mealIconContainer,
                  selectedMeal === option.type && styles.mealIconContainerSelected,
                ]}>
                  {option.icon}
                </View>
                <Text style={[
                  styles.mealLabel,
                  selectedMeal === option.type && styles.mealLabelSelected,
                ]}>
                  {option.label}
                </Text>
                <Text style={styles.mealTime}>{option.time}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Add Photo</Text>
          <Text style={styles.sectionSubtitle}>
            Take or upload a photo and we'll identify the foods automatically
          </Text>

          {photoUri ? (
            <View style={styles.photoPreviewContainer}>
              <Image source={{ uri: photoUri }} style={styles.photoPreview} />
              <TouchableOpacity
                style={styles.changePhotoButton}
                onPress={() => {
                  setPhotoUri(null);
                  setPhotoBase64(null);
                }}
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
              >
                <View style={styles.photoButtonIcon}>
                  <Camera size={28} color={Colors.primary} />
                </View>
                <Text style={styles.photoButtonLabel}>Take Photo</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.photoButton}
                onPress={() => pickImage(false)}
                activeOpacity={0.7}
              >
                <View style={styles.photoButtonIcon}>
                  <ImageIcon size={28} color={Colors.primary} />
                </View>
                <Text style={styles.photoButtonLabel}>Upload Photo</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <TouchableOpacity
          style={[
            styles.analyzeButton,
            (!selectedMeal || !photoBase64) && styles.analyzeButtonDisabled,
          ]}
          onPress={handleAnalyze}
          disabled={isAnalyzing || !selectedMeal || !photoBase64}
          activeOpacity={0.8}
        >
          {isAnalyzing ? (
            <>
              <ActivityIndicator color={Colors.textInverse} size="small" />
              <Text style={styles.analyzeButtonText}>Analyzing...</Text>
            </>
          ) : (
            <>
              <Text style={styles.analyzeButtonText}>Analyze Photo</Text>
              <ChevronRight size={20} color={Colors.textInverse} />
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.skipButton}
          onPress={handleSkipPhoto}
          activeOpacity={0.7}
        >
          <Text style={styles.skipButtonText}>Skip photo & add foods manually</Text>
        </TouchableOpacity>

        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        <TouchableOpacity
          style={styles.barcodeButton}
          onPress={() => {
            Alert.alert(
              'Barcode Scanner',
              'Enter the UPC barcode number to look up packaged foods.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Enter Barcode',
                  onPress: () => {
                    Alert.prompt?.(
                      'Enter Barcode',
                      'Type or paste the UPC barcode number',
                      (barcode) => {
                        if (barcode) {
                          console.log('Barcode entered:', barcode);
                        }
                      }
                    );
                  },
                },
              ]
            );
          }}
          activeOpacity={0.7}
        >
          <Barcode size={22} color={Colors.textSecondary} />
          <Text style={styles.barcodeButtonText}>Scan Barcode</Text>
        </TouchableOpacity>
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
    marginBottom: 28,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 16,
  },
  mealGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 12,
  },
  mealCard: {
    width: '47%',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  mealCardSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '08',
  },
  mealIconContainer: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: Colors.surfaceSecondary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  mealIconContainerSelected: {
    backgroundColor: Colors.primary + '15',
  },
  mealLabel: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 2,
  },
  mealLabelSelected: {
    color: Colors.primary,
  },
  mealTime: {
    fontSize: 12,
    color: Colors.textTertiary,
  },
  photoButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  photoButton: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.borderLight,
    borderStyle: 'dashed',
  },
  photoButtonIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primary + '10',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  photoButtonLabel: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.text,
  },
  photoPreviewContainer: {
    alignItems: 'center',
  },
  photoPreview: {
    width: '100%',
    height: 220,
    borderRadius: 16,
    backgroundColor: Colors.surfaceSecondary,
  },
  changePhotoButton: {
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 8,
  },
  changePhotoText: {
    fontSize: 14,
    color: Colors.primary,
    fontWeight: '500' as const,
  },
  analyzeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 14,
    padding: 16,
    gap: 8,
    marginBottom: 12,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  analyzeButtonDisabled: {
    backgroundColor: Colors.textTertiary,
    shadowOpacity: 0,
  },
  analyzeButtonText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.textInverse,
  },
  skipButton: {
    alignItems: 'center',
    padding: 12,
  },
  skipButtonText: {
    fontSize: 14,
    color: Colors.primary,
    fontWeight: '500' as const,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.borderLight,
  },
  dividerText: {
    fontSize: 13,
    color: Colors.textTertiary,
    marginHorizontal: 16,
  },
  barcodeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  barcodeButtonText: {
    fontSize: 15,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
  },
});
