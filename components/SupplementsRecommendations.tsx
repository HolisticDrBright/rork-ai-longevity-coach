import { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Modal,
  ScrollView,
} from 'react-native';
import {
  ShoppingBag,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  AlertTriangle,
  Info,
  Clock,
  Shield,
  Star,
  X,
  Sparkles,
} from 'lucide-react-native';

import Colors from '@/constants/colors';
import { useSupplements } from '@/providers/SupplementsProvider';
import { useUser } from '@/providers/UserProvider';
import {
  SupplementRecommendation,
  RecommendationBundle,
  PatientSupplementNeeds,
  FTC_DISCLOSURE,
  MEDICAL_DISCLAIMER,
} from '@/types/supplements';

interface SupplementsRecommendationsProps {
  patientId?: string;
  compact?: boolean;
}

export default function SupplementsRecommendations({
  patientId,
  compact = false,
}: SupplementsRecommendationsProps) {
  const { getRecommendations, trackClick } = useSupplements();
  const { userProfile, contraindications } = useUser();
  const [expanded, setExpanded] = useState(!compact);
  const [selectedProduct, setSelectedProduct] = useState<SupplementRecommendation | null>(null);
  const [showDisclosure, setShowDisclosure] = useState(false);

  const needs: PatientSupplementNeeds = useMemo(() => ({
    goals: userProfile?.goals || [],
    conditions: contraindications?.conditions || [],
    labDeficiencies: [],
    medications: contraindications?.medications || [],
    allergies: contraindications?.allergies || [],
    preferences: {
      pregnantOrNursing: contraindications?.pregnant || contraindications?.nursing,
      maxProducts: 5,
    },
  }), [userProfile, contraindications]);

  const bundle: RecommendationBundle = useMemo(() => {
    console.log('[SupplementsRec] Generating recommendations for:', needs);
    return getRecommendations(needs);
  }, [needs, getRecommendations]);

  const handlePurchaseClick = useCallback((rec: SupplementRecommendation) => {
    const effectivePatientId = patientId || userProfile?.id || 'anonymous';
    
    trackClick(
      effectivePatientId,
      rec.product.id,
      rec.affiliateChannel,
      rec.affiliateUrl,
      'protocol_recommendations',
      'protocol_tab'
    );

    console.log('[SupplementsRec] Opening affiliate link:', rec.affiliateUrl);
    Linking.openURL(rec.affiliateUrl).catch(err => {
      console.error('[SupplementsRec] Error opening link:', err);
    });
  }, [patientId, userProfile, trackClick]);

  if (bundle.products.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Info color={Colors.textTertiary} size={32} />
        <Text style={styles.emptyText}>
          Complete your profile to get personalized supplement recommendations.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.header}
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.7}
      >
        <View style={styles.headerLeft}>
          <View style={styles.iconContainer}>
            <Sparkles color="#e67e22" size={20} />
          </View>
          <View>
            <Text style={styles.headerTitle}>Recommended Supplements</Text>
            <Text style={styles.headerSubtitle}>
              {bundle.totalProducts} products • Personalized for you
            </Text>
          </View>
        </View>
        {expanded ? (
          <ChevronUp color={Colors.textTertiary} size={20} />
        ) : (
          <ChevronDown color={Colors.textTertiary} size={20} />
        )}
      </TouchableOpacity>

      {expanded && (
        <View style={styles.content}>
          <View style={styles.bundleInfo}>
            <Text style={styles.bundleRationale}>{bundle.bundleRationale}</Text>
          </View>

          {bundle.products.map((rec, index) => (
            <ProductRecommendationCard
              key={rec.product.id}
              recommendation={rec}
              rank={index + 1}
              onPurchase={() => handlePurchaseClick(rec)}
              onDetails={() => setSelectedProduct(rec)}
            />
          ))}

          <TouchableOpacity
            style={styles.disclosureButton}
            onPress={() => setShowDisclosure(true)}
          >
            <Info color={Colors.textTertiary} size={14} />
            <Text style={styles.disclosureButtonText}>
              Affiliate Disclosure & Medical Disclaimer
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <ProductDetailModal
        visible={!!selectedProduct}
        recommendation={selectedProduct}
        onClose={() => setSelectedProduct(null)}
        onPurchase={() => {
          if (selectedProduct) {
            handlePurchaseClick(selectedProduct);
          }
        }}
      />

      <DisclosureModal
        visible={showDisclosure}
        onClose={() => setShowDisclosure(false)}
      />
    </View>
  );
}

function ProductRecommendationCard({
  recommendation,
  rank,
  onPurchase,
  onDetails,
}: {
  recommendation: SupplementRecommendation;
  rank: number;
  onPurchase: () => void;
  onDetails: () => void;
}) {
  const { product, matchScore, matchedNeeds, safetyFlags, howToTake } = recommendation;

  const hasWarnings = safetyFlags.length > 0;
  const hasMajorWarning = safetyFlags.some(f => f.includes('MAJOR') || f.includes('CONTRAINDICATED'));

  return (
    <View style={[styles.productCard, hasWarnings && styles.productCardWarning]}>
      <TouchableOpacity style={styles.productHeader} onPress={onDetails} activeOpacity={0.7}>
        <View style={styles.rankBadge}>
          <Text style={styles.rankText}>#{rank}</Text>
        </View>
        <View style={styles.productInfo}>
          <Text style={styles.productName}>{product.name}</Text>
          <Text style={styles.productBrand}>{product.brand}</Text>
        </View>
        <View style={styles.matchBadge}>
          <Star color="#f5a623" size={12} />
          <Text style={styles.matchText}>{Math.round(matchScore * 100)}%</Text>
        </View>
      </TouchableOpacity>

      <View style={styles.rationaleContainer}>
        <Text style={styles.rationaleText} numberOfLines={2}>
          {recommendation.rationale}
        </Text>
      </View>

      <View style={styles.tagsRow}>
        {matchedNeeds.slice(0, 3).map(need => (
          <View key={need} style={styles.needTag}>
            <Text style={styles.needTagText}>{need}</Text>
          </View>
        ))}
      </View>

      <View style={styles.howToTakeContainer}>
        <Clock color={Colors.textTertiary} size={14} />
        <Text style={styles.howToTakeText}>{howToTake}</Text>
      </View>

      {hasWarnings && (
        <View style={[styles.warningContainer, hasMajorWarning && styles.majorWarning]}>
          <AlertTriangle color={hasMajorWarning ? '#d32f2f' : '#e67e22'} size={14} />
          <Text style={[styles.warningText, hasMajorWarning && styles.majorWarningText]}>
            {safetyFlags[0]}
          </Text>
        </View>
      )}

      <TouchableOpacity
        style={[styles.purchaseButton, hasMajorWarning && styles.purchaseButtonDisabled]}
        onPress={onPurchase}
        disabled={hasMajorWarning}
      >
        <ShoppingBag color="#fff" size={16} />
        <Text style={styles.purchaseButtonText}>Purchase</Text>
        <ExternalLink color="#fff" size={14} />
      </TouchableOpacity>

      <Text style={styles.affiliateNote}>
        * Affiliate link - see disclosure
      </Text>
    </View>
  );
}

function ProductDetailModal({
  visible,
  recommendation,
  onClose,
  onPurchase,
}: {
  visible: boolean;
  recommendation: SupplementRecommendation | null;
  onClose: () => void;
  onPurchase: () => void;
}) {
  if (!recommendation) return null;

  const { product, matchedNeeds, safetyFlags, howToTake, rationale } = recommendation;
  const hasMajorWarning = safetyFlags.some(f => f.includes('MAJOR') || f.includes('CONTRAINDICATED'));

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalTitle}>{product.name}</Text>
              <Text style={styles.modalSubtitle}>{product.brand}</Text>
            </View>
            <TouchableOpacity onPress={onClose}>
              <X color={Colors.text} size={24} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalScroll}>
            <View style={styles.detailSection}>
              <Text style={styles.detailLabel}>Why This Is Recommended</Text>
              <Text style={styles.detailText}>{rationale}</Text>
            </View>

            <View style={styles.detailSection}>
              <Text style={styles.detailLabel}>Addresses These Needs</Text>
              <View style={styles.needsGrid}>
                {matchedNeeds.map(need => (
                  <View key={need} style={styles.needChip}>
                    <Text style={styles.needChipText}>{need}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.detailSection}>
              <Text style={styles.detailLabel}>How To Take</Text>
              <View style={styles.howToTakeDetail}>
                <Clock color={Colors.primary} size={18} />
                <Text style={styles.howToTakeDetailText}>{howToTake}</Text>
              </View>
            </View>

            {product.ingredients.length > 0 && (
              <View style={styles.detailSection}>
                <Text style={styles.detailLabel}>Key Ingredients</Text>
                {product.ingredients.slice(0, 5).map((ing, idx) => (
                  <View key={idx} style={styles.ingredientRow}>
                    <Text style={styles.ingredientName}>{ing.name}</Text>
                    {ing.amount && (
                      <Text style={styles.ingredientAmount}>
                        {ing.amount} {ing.unit}
                      </Text>
                    )}
                  </View>
                ))}
              </View>
            )}

            {safetyFlags.length > 0 && (
              <View style={styles.detailSection}>
                <Text style={styles.detailLabel}>Safety Information</Text>
                {safetyFlags.map((flag, idx) => (
                  <View key={idx} style={styles.safetyFlagRow}>
                    <AlertTriangle 
                      color={flag.includes('MAJOR') || flag.includes('CONTRAINDICATED') ? '#d32f2f' : '#e67e22'} 
                      size={16} 
                    />
                    <Text style={styles.safetyFlagText}>{flag}</Text>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.detailSection}>
              <Text style={styles.detailLabel}>Product Details</Text>
              <View style={styles.productDetailsGrid}>
                <View style={styles.productDetailItem}>
                  <Text style={styles.productDetailLabel}>Form</Text>
                  <Text style={styles.productDetailValue}>{product.form}</Text>
                </View>
                <View style={styles.productDetailItem}>
                  <Text style={styles.productDetailLabel}>Serving</Text>
                  <Text style={styles.productDetailValue}>{product.servingSize}</Text>
                </View>
                <View style={styles.productDetailItem}>
                  <Text style={styles.productDetailLabel}>Vegetarian</Text>
                  <Text style={styles.productDetailValue}>{product.vegetarian ? 'Yes' : 'No'}</Text>
                </View>
                <View style={styles.productDetailItem}>
                  <Text style={styles.productDetailLabel}>Gluten-Free</Text>
                  <Text style={styles.productDetailValue}>{product.glutenFree ? 'Yes' : 'No'}</Text>
                </View>
              </View>
            </View>
          </ScrollView>

          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={[styles.modalPurchaseButton, hasMajorWarning && styles.purchaseButtonDisabled]}
              onPress={() => {
                onPurchase();
                onClose();
              }}
              disabled={hasMajorWarning}
            >
              <ShoppingBag color="#fff" size={18} />
              <Text style={styles.modalPurchaseText}>Purchase Now</Text>
              <ExternalLink color="#fff" size={16} />
            </TouchableOpacity>
            <Text style={styles.modalAffiliateNote}>
              * This is an affiliate link. See disclosure for details.
            </Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function DisclosureModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.disclosureModal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Important Information</Text>
            <TouchableOpacity onPress={onClose}>
              <X color={Colors.text} size={24} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.disclosureScroll}>
            <View style={styles.disclosureSection}>
              <View style={styles.disclosureTitleRow}>
                <Shield color={Colors.primary} size={20} />
                <Text style={styles.disclosureSectionTitle}>Affiliate Disclosure</Text>
              </View>
              <Text style={styles.disclosureText}>{FTC_DISCLOSURE}</Text>
            </View>

            <View style={styles.disclosureSection}>
              <View style={styles.disclosureTitleRow}>
                <AlertTriangle color="#e67e22" size={20} />
                <Text style={styles.disclosureSectionTitle}>Medical Disclaimer</Text>
              </View>
              <Text style={styles.disclosureText}>{MEDICAL_DISCLAIMER}</Text>
            </View>
          </ScrollView>

          <TouchableOpacity style={styles.disclosureCloseButton} onPress={onClose}>
            <Text style={styles.disclosureCloseText}>I Understand</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    marginBottom: 16,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 18,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#fef3e2',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  headerSubtitle: {
    fontSize: 13,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  content: {
    paddingHorizontal: 18,
    paddingBottom: 18,
  },
  bundleInfo: {
    backgroundColor: '#fef3e2',
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
  },
  bundleRationale: {
    fontSize: 13,
    color: '#b36b00',
    lineHeight: 19,
  },
  productCard: {
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
  },
  productCardWarning: {
    borderWidth: 1,
    borderColor: '#ffcdd2',
  },
  productHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  rankBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rankText: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: '#fff',
  },
  productInfo: {
    flex: 1,
  },
  productName: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  productBrand: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  matchBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#fff8e1',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  matchText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: '#f5a623',
  },
  rationaleContainer: {
    marginBottom: 10,
  },
  rationaleText: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 19,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  needTag: {
    backgroundColor: '#e8f5f1',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  needTagText: {
    fontSize: 11,
    color: '#2d8a6e',
    fontWeight: '500' as const,
    textTransform: 'capitalize' as const,
  },
  howToTakeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.surface,
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
  },
  howToTakeText: {
    fontSize: 12,
    color: Colors.textSecondary,
    flex: 1,
  },
  warningContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff8e1',
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
  },
  majorWarning: {
    backgroundColor: '#ffebee',
  },
  warningText: {
    fontSize: 12,
    color: '#e67e22',
    flex: 1,
  },
  majorWarningText: {
    color: '#d32f2f',
  },
  purchaseButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    paddingVertical: 12,
    borderRadius: 10,
  },
  purchaseButtonDisabled: {
    backgroundColor: Colors.textTertiary,
  },
  purchaseButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#fff',
  },
  affiliateNote: {
    fontSize: 10,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: 8,
    fontStyle: 'italic' as const,
  },
  disclosureButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    marginTop: 4,
  },
  disclosureButtonText: {
    fontSize: 12,
    color: Colors.textTertiary,
    textDecorationLine: 'underline' as const,
  },
  emptyContainer: {
    alignItems: 'center',
    padding: 32,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 12,
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
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  modalSubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  modalScroll: {
    padding: 20,
  },
  detailSection: {
    marginBottom: 20,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textTertiary,
    marginBottom: 8,
    textTransform: 'uppercase' as const,
  },
  detailText: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 21,
  },
  needsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  needChip: {
    backgroundColor: '#e8f5f1',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  needChipText: {
    fontSize: 13,
    color: '#2d8a6e',
    fontWeight: '500' as const,
    textTransform: 'capitalize' as const,
  },
  howToTakeDetail: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: Colors.surface,
    padding: 14,
    borderRadius: 12,
  },
  howToTakeDetailText: {
    fontSize: 14,
    color: Colors.text,
    flex: 1,
    lineHeight: 21,
  },
  ingredientRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  ingredientName: {
    fontSize: 14,
    color: Colors.text,
  },
  ingredientAmount: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontWeight: '500' as const,
  },
  safetyFlagRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#fff8e1',
    padding: 12,
    borderRadius: 10,
    marginBottom: 8,
  },
  safetyFlagText: {
    fontSize: 13,
    color: Colors.text,
    flex: 1,
    lineHeight: 19,
  },
  productDetailsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  productDetailItem: {
    width: '45%',
    backgroundColor: Colors.surface,
    padding: 12,
    borderRadius: 10,
  },
  productDetailLabel: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginBottom: 4,
  },
  productDetailValue: {
    fontSize: 14,
    color: Colors.text,
    fontWeight: '500' as const,
    textTransform: 'capitalize' as const,
  },
  modalFooter: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  modalPurchaseButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: Colors.primary,
    paddingVertical: 16,
    borderRadius: 14,
  },
  modalPurchaseText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: '#fff',
  },
  modalAffiliateNote: {
    fontSize: 11,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: 10,
    fontStyle: 'italic' as const,
  },
  disclosureModal: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
  },
  disclosureScroll: {
    padding: 20,
  },
  disclosureSection: {
    marginBottom: 24,
  },
  disclosureTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  disclosureSectionTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  disclosureText: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 22,
  },
  disclosureCloseButton: {
    margin: 20,
    marginTop: 0,
    backgroundColor: Colors.primary,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  disclosureCloseText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: '#fff',
  },
});
