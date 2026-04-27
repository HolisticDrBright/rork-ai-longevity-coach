import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import {
  Plus,
  Search,
  Edit2,
  Trash2,
  X,
  ChevronDown,
  ChevronUp,
  Package,
  Link,
  AlertTriangle,
  Check,
} from 'lucide-react-native';

import Colors from '@/constants/colors';
import { useSupplements } from '@/providers/SupplementsProvider';
import { CuratedProduct, SupplementCategory, SupplementForm } from '@/types/supplements';

const FORM_OPTIONS: SupplementForm[] = [
  'capsule', 'softgel', 'liquid', 'powder', 'transdermal', 'liposomal', 'chewable', 'sublingual'
];

const CATEGORY_OPTIONS: SupplementCategory[] = [
  'fish_oil', 'blood_sugar', 'vitamin_d', 'fat_soluble_vitamins', 'liver_support',
  'glutathione', 'multi_foundation', 'nac', 'gut_health', 'sleep', 'stress',
  'energy', 'detox', 'immune', 'cognitive', 'hormone_support', 'joint_support', 'cardiovascular'
];

export default function SupplementsAdminScreen() {
  const { allProducts, addProduct, updateProduct, deleteProduct, getClickStats } = useSupplements();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<SupplementCategory | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<CuratedProduct | null>(null);
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);

  const filteredProducts = allProducts.filter(product => {
    const matchesSearch = product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      product.brand.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = !selectedCategory || product.categories.includes(selectedCategory);
    return matchesSearch && matchesCategory;
  });

  const handleDelete = useCallback((product: CuratedProduct) => {
    Alert.alert(
      'Delete Product',
      `Are you sure you want to delete "${product.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteProduct(product.id),
        },
      ]
    );
  }, [deleteProduct]);

  const stats = getClickStats();

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Supplements Admin' }} />
      
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Product Catalog</Text>
          <Text style={styles.headerSubtitle}>
            {allProducts.length} products • {stats.totalClicks} total clicks
          </Text>
        </View>

        <View style={styles.searchContainer}>
          <View style={styles.searchInputWrapper}>
            <Search color={Colors.textTertiary} size={18} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search products..."
              placeholderTextColor={Colors.textTertiary}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => setShowAddModal(true)}
          >
            <Plus color="#fff" size={20} />
          </TouchableOpacity>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterScroll}
          contentContainerStyle={styles.filterContainer}
        >
          <TouchableOpacity
            style={[styles.filterChip, !selectedCategory && styles.filterChipActive]}
            onPress={() => setSelectedCategory(null)}
          >
            <Text style={[styles.filterChipText, !selectedCategory && styles.filterChipTextActive]}>
              All
            </Text>
          </TouchableOpacity>
          {CATEGORY_OPTIONS.slice(0, 8).map(cat => (
            <TouchableOpacity
              key={cat}
              style={[styles.filterChip, selectedCategory === cat && styles.filterChipActive]}
              onPress={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
            >
              <Text style={[styles.filterChipText, selectedCategory === cat && styles.filterChipTextActive]}>
                {cat.replace(/_/g, ' ')}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </SafeAreaView>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {filteredProducts.map(product => (
          <ProductCard
            key={product.id}
            product={product}
            expanded={expandedProduct === product.id}
            onToggle={() => setExpandedProduct(expandedProduct === product.id ? null : product.id)}
            onEdit={() => setEditingProduct(product)}
            onDelete={() => handleDelete(product)}
            clickCount={getClickStats(product.id).totalClicks}
          />
        ))}

        {filteredProducts.length === 0 && (
          <View style={styles.emptyState}>
            <Package color={Colors.textTertiary} size={48} />
            <Text style={styles.emptyStateText}>No products found</Text>
            <Text style={styles.emptyStateSubtext}>
              {searchQuery ? 'Try a different search term' : 'Add your first product'}
            </Text>
          </View>
        )}
      </ScrollView>

      <ProductFormModal
        visible={showAddModal || !!editingProduct}
        product={editingProduct}
        onClose={() => {
          setShowAddModal(false);
          setEditingProduct(null);
        }}
        onSave={(data) => {
          if (editingProduct) {
            updateProduct(editingProduct.id, data);
          } else {
            const requiredData = data as Omit<CuratedProduct, 'id' | 'createdAt' | 'updatedAt'>;
            addProduct({
              ...requiredData,
              isActive: true,
            });
          }
          setShowAddModal(false);
          setEditingProduct(null);
        }}
      />
    </View>
  );
}

function ProductCard({
  product,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  clickCount,
}: {
  product: CuratedProduct;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  clickCount: number;
}) {
  return (
    <View style={styles.productCard}>
      <TouchableOpacity style={styles.productHeader} onPress={onToggle} activeOpacity={0.7}>
        <View style={styles.productInfo}>
          <View style={styles.productTitleRow}>
            <Text style={styles.productName}>{product.name}</Text>
            {product.isPreferredMulti && (
              <View style={styles.preferredBadge}>
                <Text style={styles.preferredBadgeText}>Preferred</Text>
              </View>
            )}
          </View>
          <Text style={styles.productBrand}>{product.brand}</Text>
          <View style={styles.productMeta}>
            <View style={styles.metaChip}>
              <Text style={styles.metaChipText}>{product.form}</Text>
            </View>
            <View style={styles.metaChip}>
              <Text style={styles.metaChipText}>Priority: {product.priority}</Text>
            </View>
            <View style={[styles.metaChip, styles.clickChip]}>
              <Text style={styles.clickChipText}>{clickCount} clicks</Text>
            </View>
          </View>
        </View>
        {expanded ? (
          <ChevronUp color={Colors.textTertiary} size={20} />
        ) : (
          <ChevronDown color={Colors.textTertiary} size={20} />
        )}
      </TouchableOpacity>

      {expanded && (
        <View style={styles.productDetails}>
          <Text style={styles.productDescription}>{product.description}</Text>

          <View style={styles.detailSection}>
            <Text style={styles.detailLabel}>Categories</Text>
            <View style={styles.tagsRow}>
              {product.categories.map(cat => (
                <View key={cat} style={styles.tagChip}>
                  <Text style={styles.tagChipText}>{cat.replace(/_/g, ' ')}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.detailSection}>
            <Text style={styles.detailLabel}>Use Case Tags</Text>
            <View style={styles.tagsRow}>
              {product.useCaseTags.slice(0, 6).map(tag => (
                <View key={tag} style={styles.tagChip}>
                  <Text style={styles.tagChipText}>{tag}</Text>
                </View>
              ))}
              {product.useCaseTags.length > 6 && (
                <View style={styles.tagChip}>
                  <Text style={styles.tagChipText}>+{product.useCaseTags.length - 6} more</Text>
                </View>
              )}
            </View>
          </View>

          <View style={styles.detailSection}>
            <Text style={styles.detailLabel}>Affiliate Links</Text>
            {product.affiliateUrls.fullscript_affiliate_url && (
              <View style={styles.linkRow}>
                <Link color={Colors.primary} size={14} />
                <Text style={styles.linkText} numberOfLines={1}>
                  Fullscript: {product.affiliateUrls.fullscript_affiliate_url}
                </Text>
              </View>
            )}
            {product.affiliateUrls.direct_affiliate_url && (
              <View style={styles.linkRow}>
                <Link color="#e67e22" size={14} />
                <Text style={styles.linkText} numberOfLines={1}>
                  Direct: {product.affiliateUrls.direct_affiliate_url}
                </Text>
              </View>
            )}
          </View>

          {product.contraindications.length > 0 && (
            <View style={styles.detailSection}>
              <Text style={styles.detailLabel}>Contraindications</Text>
              {product.contraindications.map((contra, idx) => (
                <View key={idx} style={styles.warningRow}>
                  <AlertTriangle color="#d32f2f" size={14} />
                  <Text style={styles.warningText}>
                    {contra.condition} ({contra.severity})
                  </Text>
                </View>
              ))}
            </View>
          )}

          <View style={styles.detailSection}>
            <Text style={styles.detailLabel}>Safety Flags</Text>
            <View style={styles.safetyRow}>
              <View style={[styles.safetyBadge, product.pregnancySafe ? styles.safeBadge : styles.unsafeBadge]}>
                <Text style={styles.safetyBadgeText}>
                  {product.pregnancySafe ? '✓' : '✗'} Pregnancy
                </Text>
              </View>
              <View style={[styles.safetyBadge, product.lactationSafe ? styles.safeBadge : styles.unsafeBadge]}>
                <Text style={styles.safetyBadgeText}>
                  {product.lactationSafe ? '✓' : '✗'} Lactation
                </Text>
              </View>
              <View style={[styles.safetyBadge, product.vegetarian ? styles.safeBadge : styles.neutralBadge]}>
                <Text style={styles.safetyBadgeText}>
                  {product.vegetarian ? '✓' : '-'} Vegetarian
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.actionButtons}>
            <TouchableOpacity style={styles.editButton} onPress={onEdit}>
              <Edit2 color="#fff" size={16} />
              <Text style={styles.editButtonText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.deleteButton} onPress={onDelete}>
              <Trash2 color="#fff" size={16} />
              <Text style={styles.deleteButtonText}>Delete</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

function ProductFormModal({
  visible,
  product,
  onClose,
  onSave,
}: {
  visible: boolean;
  product: CuratedProduct | null;
  onClose: () => void;
  onSave: (data: Partial<CuratedProduct>) => void;
}) {
  const [name, setName] = useState(product?.name || '');
  const [brand, setBrand] = useState(product?.brand || '');
  const [description, setDescription] = useState(product?.description || '');
  const [form, setForm] = useState<SupplementForm>(product?.form || 'capsule');
  const [servingSize, setServingSize] = useState(product?.servingSize || '');
  const [priority, setPriority] = useState(String(product?.priority || 5));
  const [isPreferredMulti, setIsPreferredMulti] = useState(product?.isPreferredMulti || false);
  const [fullscriptUrl, setFullscriptUrl] = useState(product?.affiliateUrls.fullscript_affiliate_url || '');
  const [directUrl, setDirectUrl] = useState(product?.affiliateUrls.direct_affiliate_url || '');
  const [suggestedDose, setSuggestedDose] = useState(product?.suggestedDose || '');
  const [timing, setTiming] = useState(product?.timing || '');
  const [useCaseTags, setUseCaseTags] = useState(product?.useCaseTags.join(', ') || '');
  const [categories, setCategories] = useState<SupplementCategory[]>(product?.categories || []);
  const [pregnancySafe, setPregnancySafe] = useState(product?.pregnancySafe || false);
  const [lactationSafe, setLactationSafe] = useState(product?.lactationSafe || false);
  const [vegetarian, setVegetarian] = useState(product?.vegetarian || false);

  const handleSave = () => {
    if (!name.trim() || !brand.trim()) {
      Alert.alert('Error', 'Name and brand are required');
      return;
    }

    onSave({
      name: name.trim(),
      brand: brand.trim(),
      description: description.trim(),
      form,
      servingSize: servingSize.trim() || '1 serving',
      priority: parseInt(priority) || 5,
      isPreferredMulti,
      affiliateUrls: {
        fullscript_affiliate_url: fullscriptUrl.trim() || undefined,
        direct_affiliate_url: directUrl.trim() || undefined,
        fallback_url: fullscriptUrl.trim() || directUrl.trim() || undefined,
      },
      suggestedDose: suggestedDose.trim() || undefined,
      timing: timing.trim() || undefined,
      useCaseTags: useCaseTags.split(',').map(t => t.trim()).filter(Boolean),
      categories: categories.length > 0 ? categories : ['energy'],
      pregnancySafe,
      lactationSafe,
      vegetarian,
      vegan: vegetarian,
      glutenFree: true,
      dairyFree: true,
      ingredients: product?.ingredients || [],
      ingredientCoverage: product?.ingredientCoverage || useCaseTags.split(',').map(t => t.trim()).filter(Boolean),
      contraindications: product?.contraindications || [],
      interactions: product?.interactions || [],
    });
  };

  const toggleCategory = (cat: SupplementCategory) => {
    setCategories(prev => 
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              {product ? 'Edit Product' : 'Add Product'}
            </Text>
            <TouchableOpacity onPress={onClose}>
              <X color={Colors.text} size={24} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalScroll}>
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Product Name *</Text>
              <TextInput
                style={styles.formInput}
                value={name}
                onChangeText={setName}
                placeholder="e.g., ProOmega 2000"
                placeholderTextColor={Colors.textTertiary}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Brand *</Text>
              <TextInput
                style={styles.formInput}
                value={brand}
                onChangeText={setBrand}
                placeholder="e.g., Nordic Naturals"
                placeholderTextColor={Colors.textTertiary}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Description</Text>
              <TextInput
                style={[styles.formInput, styles.formTextArea]}
                value={description}
                onChangeText={setDescription}
                placeholder="Product description..."
                placeholderTextColor={Colors.textTertiary}
                multiline
                numberOfLines={3}
              />
            </View>

            <View style={styles.formRow}>
              <View style={[styles.formGroup, { flex: 1 }]}>
                <Text style={styles.formLabel}>Form</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.formOptions}>
                    {FORM_OPTIONS.map(f => (
                      <TouchableOpacity
                        key={f}
                        style={[styles.formOption, form === f && styles.formOptionActive]}
                        onPress={() => setForm(f)}
                      >
                        <Text style={[styles.formOptionText, form === f && styles.formOptionTextActive]}>
                          {f}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              </View>
            </View>

            <View style={styles.formRow}>
              <View style={[styles.formGroup, { flex: 1, marginRight: 8 }]}>
                <Text style={styles.formLabel}>Serving Size</Text>
                <TextInput
                  style={styles.formInput}
                  value={servingSize}
                  onChangeText={setServingSize}
                  placeholder="e.g., 2 capsules"
                  placeholderTextColor={Colors.textTertiary}
                />
              </View>
              <View style={[styles.formGroup, { width: 100 }]}>
                <Text style={styles.formLabel}>Priority</Text>
                <TextInput
                  style={styles.formInput}
                  value={priority}
                  onChangeText={setPriority}
                  keyboardType="numeric"
                  placeholder="1-10"
                  placeholderTextColor={Colors.textTertiary}
                />
              </View>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Categories</Text>
              <View style={styles.categoriesGrid}>
                {CATEGORY_OPTIONS.map(cat => (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.categoryChip, categories.includes(cat) && styles.categoryChipActive]}
                    onPress={() => toggleCategory(cat)}
                  >
                    <Text style={[styles.categoryChipText, categories.includes(cat) && styles.categoryChipTextActive]}>
                      {cat.replace(/_/g, ' ')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Use Case Tags (comma separated)</Text>
              <TextInput
                style={[styles.formInput, styles.formTextArea]}
                value={useCaseTags}
                onChangeText={setUseCaseTags}
                placeholder="omega-3, fish oil, EPA, DHA, heart health"
                placeholderTextColor={Colors.textTertiary}
                multiline
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Fullscript Affiliate URL</Text>
              <TextInput
                style={styles.formInput}
                value={fullscriptUrl}
                onChangeText={setFullscriptUrl}
                placeholder="https://us.fullscript.com/..."
                placeholderTextColor={Colors.textTertiary}
                autoCapitalize="none"
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Direct Affiliate URL</Text>
              <TextInput
                style={styles.formInput}
                value={directUrl}
                onChangeText={setDirectUrl}
                placeholder="https://brand.com/product?ref=..."
                placeholderTextColor={Colors.textTertiary}
                autoCapitalize="none"
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Suggested Dose</Text>
              <TextInput
                style={styles.formInput}
                value={suggestedDose}
                onChangeText={setSuggestedDose}
                placeholder="e.g., 2 softgels daily"
                placeholderTextColor={Colors.textTertiary}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Timing Instructions</Text>
              <TextInput
                style={styles.formInput}
                value={timing}
                onChangeText={setTiming}
                placeholder="e.g., With meals for better absorption"
                placeholderTextColor={Colors.textTertiary}
              />
            </View>

            <View style={styles.switchGroup}>
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>Preferred Multi-Ingredient Formula</Text>
                <Switch
                  value={isPreferredMulti}
                  onValueChange={setIsPreferredMulti}
                  trackColor={{ false: Colors.borderLight, true: Colors.primary }}
                />
              </View>
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>Pregnancy Safe</Text>
                <Switch
                  value={pregnancySafe}
                  onValueChange={setPregnancySafe}
                  trackColor={{ false: Colors.borderLight, true: '#4caf50' }}
                />
              </View>
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>Lactation Safe</Text>
                <Switch
                  value={lactationSafe}
                  onValueChange={setLactationSafe}
                  trackColor={{ false: Colors.borderLight, true: '#4caf50' }}
                />
              </View>
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>Vegetarian</Text>
                <Switch
                  value={vegetarian}
                  onValueChange={setVegetarian}
                  trackColor={{ false: Colors.borderLight, true: '#4caf50' }}
                />
              </View>
            </View>
          </ScrollView>

          <View style={styles.modalFooter}>
            <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
              <Check color="#fff" size={18} />
              <Text style={styles.saveButtonText}>Save Product</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  safeArea: {
    backgroundColor: Colors.primary,
  },
  header: {
    padding: 20,
    paddingTop: 12,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: '#fff',
  },
  headerSubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 4,
  },
  searchContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 12,
  },
  searchInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 12,
    paddingHorizontal: 14,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    height: 44,
    color: '#fff',
    fontSize: 15,
  },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterScroll: {
    maxHeight: 44,
  },
  filterContainer: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    marginRight: 8,
  },
  filterChipActive: {
    backgroundColor: '#fff',
  },
  filterChipText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.9)',
    textTransform: 'capitalize' as const,
  },
  filterChipTextActive: {
    color: Colors.primary,
    fontWeight: '600' as const,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 120,
  },
  productCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    marginBottom: 12,
    overflow: 'hidden',
  },
  productHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  productInfo: {
    flex: 1,
  },
  productTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  productName: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  preferredBadge: {
    backgroundColor: '#e8f5e9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  preferredBadgeText: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: '#4caf50',
  },
  productBrand: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  productMeta: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  metaChip: {
    backgroundColor: Colors.surfaceSecondary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  metaChipText: {
    fontSize: 11,
    color: Colors.textSecondary,
    textTransform: 'capitalize' as const,
  },
  clickChip: {
    backgroundColor: '#e3f2fd',
  },
  clickChipText: {
    fontSize: 11,
    color: '#1976d2',
  },
  productDetails: {
    padding: 16,
    paddingTop: 0,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  productDescription: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: 16,
  },
  detailSection: {
    marginBottom: 16,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textTertiary,
    marginBottom: 8,
    textTransform: 'uppercase' as const,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tagChip: {
    backgroundColor: Colors.surfaceSecondary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  tagChipText: {
    fontSize: 12,
    color: Colors.textSecondary,
    textTransform: 'capitalize' as const,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  linkText: {
    fontSize: 12,
    color: Colors.textSecondary,
    flex: 1,
  },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  warningText: {
    fontSize: 13,
    color: '#d32f2f',
  },
  safetyRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  safetyBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  safeBadge: {
    backgroundColor: '#e8f5e9',
  },
  unsafeBadge: {
    backgroundColor: '#ffebee',
  },
  neutralBadge: {
    backgroundColor: Colors.surfaceSecondary,
  },
  safetyBadgeText: {
    fontSize: 11,
    color: Colors.textSecondary,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  editButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    paddingVertical: 10,
    borderRadius: 10,
  },
  editButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#fff',
  },
  deleteButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#d32f2f',
    paddingVertical: 10,
    borderRadius: 10,
  },
  deleteButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#fff',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyStateText: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: Colors.text,
    marginTop: 16,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 4,
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
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  modalScroll: {
    padding: 20,
    maxHeight: 500,
  },
  formGroup: {
    marginBottom: 16,
  },
  formLabel: {
    fontSize: 13,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
    marginBottom: 8,
  },
  formInput: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  formTextArea: {
    minHeight: 80,
    textAlignVertical: 'top' as const,
  },
  formRow: {
    flexDirection: 'row',
  },
  formOptions: {
    flexDirection: 'row',
    gap: 8,
  },
  formOption: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  formOptionActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  formOptionText: {
    fontSize: 13,
    color: Colors.textSecondary,
    textTransform: 'capitalize' as const,
  },
  formOptionTextActive: {
    color: '#fff',
  },
  categoriesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  categoryChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  categoryChipText: {
    fontSize: 12,
    color: Colors.textSecondary,
    textTransform: 'capitalize' as const,
  },
  categoryChipTextActive: {
    color: '#fff',
  },
  switchGroup: {
    marginTop: 8,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  switchLabel: {
    fontSize: 15,
    color: Colors.text,
  },
  modalFooter: {
    flexDirection: 'row',
    padding: 20,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: Colors.surfaceSecondary,
  },
  cancelButtonText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  saveButton: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.primary,
  },
  saveButtonText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: '#fff',
  },
});
