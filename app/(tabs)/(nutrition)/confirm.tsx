import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Plus, Trash2, ChevronDown, Search, Check, AlertCircle, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Colors from '@/constants/colors';
import { useNutrition } from '@/providers/NutritionProvider';
import { DetectedFoodItem, FoodLog, MealType } from '@/types';
import { trpc } from '@/lib/trpc';

const PORTION_UNITS = ['g', 'oz', 'cup', 'tbsp', 'tsp', 'piece', 'serving', 'slice', 'medium', 'large', 'small'];

interface EditableItem extends DetectedFoodItem {
  isEditing?: boolean;
}

export default function ConfirmFoods() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { pendingAnalysis, addFoodLog, dietProfile, setPendingMealAnalysis } = useNutrition();

  const [items, setItems] = useState<EditableItem[]>(pendingAnalysis?.detectedItems || []);
  const [isCalculating, setIsCalculating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [clarifyingAnswers, setClarifyingAnswers] = useState<Record<string, string>>({});

  const calculateMutation = trpc.nutrition.calculateNutrition.useMutation({
    onSuccess: (data) => {
      console.log('Calculation successful:', data.foodLogId);

      const foodLog: FoodLog = {
        id: data.foodLogId,
        userId: dietProfile.userId || 'user_default',
        createdAt: data.calculatedAt,
        mealType: pendingAnalysis?.mealType || 'snack',
        photoUrl: null,
        passioRawJson: {},
        confirmedItemsJson: items,
        totals: data.totals,
        compliance: data.compliance,
        suggestions: data.suggestions,
        items: data.items.map((item, index) => ({
          ...item,
          foodLogId: data.foodLogId,
          createdAt: data.calculatedAt,
        })),
        notes: '',
      };

      addFoodLog(foodLog);
      router.replace(`/(tabs)/(nutrition)/${data.foodLogId}`);
    },
    onError: (error) => {
      console.error('Calculation failed:', error);
      Alert.alert('Error', 'Failed to calculate nutrition. Please try again.');
    },
    onSettled: () => {
      setIsCalculating(false);
    },
  });

  const handleUpdateItem = useCallback((itemId: string, updates: Partial<EditableItem>) => {
    setItems(prev => prev.map(item =>
      item.id === itemId ? { ...item, ...updates } : item
    ));
  }, []);

  const handleRemoveItem = useCallback((itemId: string) => {
    setItems(prev => prev.filter(item => item.id !== itemId));
  }, []);

  const handleAddItem = useCallback(() => {
    if (!newItemName.trim()) return;

    const newItem: EditableItem = {
      id: `manual_${Date.now()}`,
      name: newItemName.trim(),
      passioFoodId: null,
      confidence: 1,
      portionQty: 1,
      portionUnit: 'serving',
      suggestedPortions: PORTION_UNITS,
    };

    setItems(prev => [...prev, newItem]);
    setNewItemName('');
    setShowAddModal(false);
  }, [newItemName]);

  const handleCalculate = useCallback(() => {
    if (items.length === 0) {
      Alert.alert('No Foods', 'Please add at least one food item.');
      return;
    }

    setIsCalculating(true);
    calculateMutation.mutate({
      foodLogId: pendingAnalysis?.foodLogId || `log_${Date.now()}`,
      confirmedItems: items.map(item => ({
        id: item.id,
        name: item.name,
        passioFoodId: item.passioFoodId,
        portionQty: item.portionQty,
        portionUnit: item.portionUnit,
      })),
      activeDiets: dietProfile.activeDiets || [],
      userId: dietProfile.userId || 'user_default',
    });
  }, [items, pendingAnalysis, dietProfile, calculateMutation]);

  const handleCancel = useCallback(() => {
    Alert.alert(
      'Discard Changes?',
      'Are you sure you want to discard this meal?',
      [
        { text: 'Keep Editing', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            setPendingMealAnalysis(null);
            router.back();
          },
        },
      ]
    );
  }, [setPendingMealAnalysis, router]);

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return Colors.success;
    if (confidence >= 0.6) return Colors.warning;
    return Colors.danger;
  };

  const renderItem = (item: EditableItem, index: number) => {
    const confidenceColor = getConfidenceColor(item.confidence);

    return (
      <View key={item.id} style={styles.itemCard}>
        <View style={styles.itemHeader}>
          <View style={styles.itemNameRow}>
            <TextInput
              style={styles.itemNameInput}
              value={item.name}
              onChangeText={(text) => handleUpdateItem(item.id, { name: text })}
              placeholder="Food name"
              placeholderTextColor={Colors.textTertiary}
            />
            {item.confidence < 1 && (
              <View style={[styles.confidenceBadge, { backgroundColor: confidenceColor + '20' }]}>
                <Text style={[styles.confidenceText, { color: confidenceColor }]}>
                  {Math.round(item.confidence * 100)}%
                </Text>
              </View>
            )}
          </View>
          <TouchableOpacity
            style={styles.removeButton}
            onPress={() => handleRemoveItem(item.id)}
          >
            <Trash2 size={18} color={Colors.danger} />
          </TouchableOpacity>
        </View>

        <View style={styles.portionRow}>
          <View style={styles.portionQtyContainer}>
            <TextInput
              style={styles.portionQtyInput}
              value={String(item.portionQty)}
              onChangeText={(text) => {
                const num = parseFloat(text) || 0;
                handleUpdateItem(item.id, { portionQty: num });
              }}
              keyboardType="decimal-pad"
              placeholder="1"
              placeholderTextColor={Colors.textTertiary}
            />
          </View>
          <TouchableOpacity
            style={styles.portionUnitButton}
            onPress={() => {
              const currentIndex = PORTION_UNITS.indexOf(item.portionUnit);
              const nextIndex = (currentIndex + 1) % PORTION_UNITS.length;
              handleUpdateItem(item.id, { portionUnit: PORTION_UNITS[nextIndex] });
            }}
          >
            <Text style={styles.portionUnitText}>{item.portionUnit}</Text>
            <ChevronDown size={16} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  if (!pendingAnalysis) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Confirm Foods' }} />
        <View style={styles.emptyState}>
          <AlertCircle size={48} color={Colors.textTertiary} />
          <Text style={styles.emptyText}>No meal analysis in progress</Text>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Confirm Foods',
          headerLeft: () => (
            <TouchableOpacity onPress={handleCancel} style={styles.headerButton}>
              <X size={24} color={Colors.text} />
            </TouchableOpacity>
          ),
        }}
      />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.mealTypeHeader}>
          <Text style={styles.mealTypeLabel}>
            {pendingAnalysis.mealType.charAt(0).toUpperCase() + pendingAnalysis.mealType.slice(1)}
          </Text>
          <Text style={styles.itemCount}>
            {items.length} item{items.length !== 1 ? 's' : ''}
          </Text>
        </View>

        {items.length === 0 ? (
          <View style={styles.noItemsCard}>
            <Text style={styles.noItemsText}>No foods detected</Text>
            <Text style={styles.noItemsSubtext}>Add foods manually below</Text>
          </View>
        ) : (
          <View style={styles.itemsList}>
            {items.map(renderItem)}
          </View>
        )}

        <TouchableOpacity
          style={styles.addItemButton}
          onPress={() => setShowAddModal(true)}
          activeOpacity={0.7}
        >
          <Plus size={20} color={Colors.primary} />
          <Text style={styles.addItemText}>Add Food Item</Text>
        </TouchableOpacity>

        {dietProfile.activeDiets && dietProfile.activeDiets.length > 0 && (
          <View style={styles.dietsNote}>
            <AlertCircle size={16} color={Colors.textSecondary} />
            <Text style={styles.dietsNoteText}>
              Tracking compliance for: {dietProfile.activeDiets.join(', ')}
            </Text>
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 20 }]}>
        <TouchableOpacity
          style={[
            styles.calculateButton,
            (items.length === 0 || isCalculating) && styles.calculateButtonDisabled,
          ]}
          onPress={handleCalculate}
          disabled={items.length === 0 || isCalculating}
          activeOpacity={0.8}
        >
          {isCalculating ? (
            <>
              <ActivityIndicator color={Colors.textInverse} size="small" />
              <Text style={styles.calculateButtonText}>Calculating...</Text>
            </>
          ) : (
            <>
              <Check size={20} color={Colors.textInverse} />
              <Text style={styles.calculateButtonText}>Calculate & Save</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <Modal
        visible={showAddModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAddModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Food Item</Text>
              <TouchableOpacity onPress={() => setShowAddModal(false)}>
                <X size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.searchContainer}>
              <Search size={20} color={Colors.textTertiary} />
              <TextInput
                style={styles.searchInput}
                value={newItemName}
                onChangeText={setNewItemName}
                placeholder="Search or type food name..."
                placeholderTextColor={Colors.textTertiary}
                autoFocus
              />
            </View>

            <TouchableOpacity
              style={[
                styles.addModalButton,
                !newItemName.trim() && styles.addModalButtonDisabled,
              ]}
              onPress={handleAddItem}
              disabled={!newItemName.trim()}
              activeOpacity={0.8}
            >
              <Plus size={20} color={Colors.textInverse} />
              <Text style={styles.addModalButtonText}>Add "{newItemName || '...'}"</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  headerButton: {
    padding: 8,
  },
  mealTypeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  mealTypeLabel: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  itemCount: {
    fontSize: 14,
    color: Colors.textSecondary,
    backgroundColor: Colors.surfaceSecondary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  itemsList: {
    gap: 12,
    marginBottom: 16,
  },
  itemCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  itemNameRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  itemNameInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
    padding: 0,
  },
  confidenceBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  confidenceText: {
    fontSize: 11,
    fontWeight: '600' as const,
  },
  removeButton: {
    padding: 4,
    marginLeft: 8,
  },
  portionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  portionQtyContainer: {
    width: 80,
  },
  portionQtyInput: {
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: Colors.text,
    textAlign: 'center',
  },
  portionUnitButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  portionUnitText: {
    fontSize: 15,
    color: Colors.text,
  },
  noItemsCard: {
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    marginBottom: 16,
  },
  noItemsText: {
    fontSize: 16,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  noItemsSubtext: {
    fontSize: 14,
    color: Colors.textTertiary,
  },
  addItemButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary + '10',
    borderRadius: 14,
    padding: 16,
    gap: 8,
    borderWidth: 2,
    borderColor: Colors.primary + '30',
    borderStyle: 'dashed',
  },
  addItemText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  dietsNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 20,
    padding: 14,
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 12,
  },
  dietsNoteText: {
    flex: 1,
    fontSize: 13,
    color: Colors.textSecondary,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.background,
    paddingHorizontal: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  calculateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 14,
    padding: 16,
    gap: 8,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  calculateButtonDisabled: {
    backgroundColor: Colors.textTertiary,
    shadowOpacity: 0,
  },
  calculateButtonText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.textInverse,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    fontSize: 16,
    color: Colors.textSecondary,
    marginTop: 16,
    marginBottom: 24,
  },
  backButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: Colors.primary,
    borderRadius: 12,
  },
  backButtonText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.textInverse,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: Colors.text,
    paddingVertical: 14,
    paddingLeft: 10,
  },
  addModalButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 14,
    padding: 16,
    gap: 8,
  },
  addModalButtonDisabled: {
    backgroundColor: Colors.textTertiary,
  },
  addModalButtonText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.textInverse,
  },
});
