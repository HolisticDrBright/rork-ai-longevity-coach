import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  FlaskConical,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Calendar,
  Plus,
  Upload,
  X,
  FileText,
  Sparkles,
  Loader,
  ExternalLink,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';

import Colors from '@/constants/colors';
import { useLabs, LabAnalysisResult } from '@/providers/LabsProvider';
import { useUser } from '@/providers/UserProvider';
import { Biomarker } from '@/types';

const statusColors = {
  optimal: Colors.success,
  normal: Colors.primary,
  suboptimal: Colors.warning,
  critical: Colors.danger,
};

const statusLabels = {
  optimal: 'Optimal',
  normal: 'Normal',
  suboptimal: 'Needs Attention',
  critical: 'Critical',
};

export default function LabsScreen() {
  const {
    latestPanel,
    biomarkersByCategory,
    flaggedBiomarkers,
    optimalBiomarkers,
    getBiomarkerTrend,
    isLoading,
    pickLabDocument,
    addLabPanel,
    analyzeLab,
    isAnalyzing,
    sendLabsWebhook,
    sendLabUploadStartedWebhook,
  } = useLabs();
  const { userProfile } = useUser();

  const [expandedCategories, setExpandedCategories] = useState<string[]>(['Metabolic', 'Inflammation']);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadedDocument, setUploadedDocument] = useState<{ uri: string; name: string; mimeType: string } | null>(null);
  const [labName, setLabName] = useState('');
  const [labDate, setLabDate] = useState(new Date().toISOString().split('T')[0]);
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<LabAnalysisResult | null>(null);
  const [pendingPanelId, setPendingPanelId] = useState<string | null>(null);

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev =>
      prev.includes(category)
        ? prev.filter(c => c !== category)
        : [...prev, category]
    );
  };

  const handleUploadDocument = async () => {
    const doc = await pickLabDocument();
    if (doc) {
      setUploadedDocument(doc);
      if (!labName.trim()) {
        const nameWithoutExt = doc.name.replace(/\.[^/.]+$/, '');
        setLabName(nameWithoutExt);
      }
      sendLabUploadStartedWebhook(
        userProfile?.id || 'anonymous',
        userProfile?.email || '',
      );
    }
  };

  const handleSaveLabUpload = () => {
    if (!labName.trim()) {
      Alert.alert('Error', 'Please enter a name for your lab panel');
      return;
    }

    if (!uploadedDocument) {
      Alert.alert('Error', 'Please upload a lab document first');
      return;
    }

    const biomarkers = analysisResult?.biomarkers || [];
    
    if (biomarkers.length === 0) {
      Alert.alert(
        'No Biomarkers',
        'No biomarkers have been extracted. Would you like to analyze the document with AI first?',
        [
          { text: 'Analyze First', onPress: handleAnalyzeLab },
          { 
            text: 'Save Anyway', 
            style: 'destructive',
            onPress: () => saveLabWithoutBiomarkers()
          },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
      return;
    }

    saveLabWithBiomarkers(biomarkers);
  };

  const saveLabWithoutBiomarkers = () => {
    console.log('[Labs UI] Saving lab without biomarkers');
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    
    const panelId = `panel_${Date.now()}`;
    
    addLabPanel({
      id: panelId,
      name: labName,
      date: labDate,
      source: 'upload',
      fileUrl: uploadedDocument?.uri || undefined,
      biomarkers: [],
      notes: `Uploaded: ${uploadedDocument?.name || 'No file'} (not analyzed)`,
    });

    resetUploadState();
    Alert.alert('Lab Uploaded', 'Your lab has been uploaded. You can analyze it later to extract biomarkers.');
  };

  const saveLabWithBiomarkers = (biomarkers: Biomarker[]) => {
    console.log('[Labs UI] Saving lab with', biomarkers.length, 'biomarkers');
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    
    const panelId = `panel_${Date.now()}`;
    
    addLabPanel({
      id: panelId,
      name: labName,
      date: labDate,
      source: 'upload',
      fileUrl: uploadedDocument?.uri || undefined,
      biomarkers: biomarkers,
      notes: `Uploaded: ${uploadedDocument?.name || 'No file'}`,
    });

    resetUploadState();
    Alert.alert('Lab Uploaded', `Your lab has been uploaded with ${biomarkers.length} biomarkers extracted.`);
  };

  const resetUploadState = () => {
    setShowUploadModal(false);
    setShowAnalysisModal(false);
    setUploadedDocument(null);
    setLabName('');
    setLabDate(new Date().toISOString().split('T')[0]);
    setAnalysisResult(null);
    setPendingPanelId(null);
  };

  const handleAnalyzeLab = async () => {
    if (!uploadedDocument) {
      Alert.alert('No File', 'Please upload a lab document first to analyze.');
      return;
    }

    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      console.log('[Labs UI] Starting analysis for:', uploadedDocument.name);
      
      const result = await analyzeLab({
        fileUri: uploadedDocument.uri,
        mimeType: uploadedDocument.mimeType,
        panelId: pendingPanelId || undefined,
      });
      
      console.log('[Labs UI] Analysis completed, biomarkers:', result.biomarkers.length);
      setAnalysisResult(result);
      
      if (result.biomarkers.length > 0) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setShowAnalysisModal(true);
      } else {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Alert.alert(
          'No Biomarkers Found',
          'AI could not extract biomarkers from this document. The image may be unclear or the format unrecognized. You can still save the document for reference.',
          [
            { text: 'Try Again', onPress: handleAnalyzeLab },
            { text: 'Save Anyway', onPress: saveLabWithoutBiomarkers },
            { text: 'Cancel', style: 'cancel' },
          ]
        );
      }
    } catch (error) {
      console.error('[Labs UI] Analysis error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unable to analyze the lab document.';
      
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        'Analysis Failed',
        errorMessage + '\n\nYou can try again or save the document without analysis.',
        [
          { text: 'Try Again', onPress: handleAnalyzeLab },
          { text: 'Save Without Analysis', onPress: saveLabWithoutBiomarkers },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
    }
  };

  const handleSaveAnalysisResults = () => {
    if (!analysisResult || analysisResult.biomarkers.length === 0) {
      Alert.alert('No Results', 'No biomarkers were extracted. Please try again with a clearer image.');
      return;
    }

    const panelName = labName.trim() || `Lab Results ${new Date().toLocaleDateString()}`;
    setLabName(panelName);
    
    console.log('[Labs UI] Saving analysis results with', analysisResult.biomarkers.length, 'biomarkers');
    saveLabWithBiomarkers(analysisResult.biomarkers);

    if (analysisResult.supplements.length > 0 || analysisResult.herbs.length > 0) {
      sendLabsWebhook(
        userProfile?.id || 'unknown',
        userProfile?.email || '',
        'comprehensive_panel',
        [...analysisResult.supplements, ...analysisResult.herbs],
      );
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  const renderUploadModal = () => (
    <Modal
      visible={showUploadModal}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setShowUploadModal(false)}
    >
      <SafeAreaView style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={() => setShowUploadModal(false)}>
            <X color={Colors.text} size={24} />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>Upload Lab Results</Text>
          <TouchableOpacity onPress={handleSaveLabUpload}>
            <Text style={styles.saveText}>Save</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.modalContent}>
          <Text style={styles.inputLabel}>Lab Panel Name</Text>
          <TextInput
            style={styles.textInput}
            value={labName}
            onChangeText={setLabName}
            placeholder="e.g., Comprehensive Metabolic Panel"
            placeholderTextColor={Colors.textTertiary}
          />

          <Text style={styles.inputLabel}>Date of Test</Text>
          <TextInput
            style={styles.textInput}
            value={labDate}
            onChangeText={setLabDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={Colors.textTertiary}
          />

          <Text style={styles.inputLabel}>Lab Report (PDF or Image)</Text>
          <TouchableOpacity
            style={styles.imageUploadArea}
            onPress={handleUploadDocument}
          >
            {uploadedDocument ? (
              <View style={styles.imageUploaded}>
                <CheckCircle color={Colors.success} size={32} />
                <Text style={styles.imageUploadedText}>File Selected</Text>
                <Text style={styles.imageUploadedHint} numberOfLines={1}>{uploadedDocument.name}</Text>
                <Text style={styles.imageUploadedHint}>Tap to change</Text>
              </View>
            ) : (
              <View style={styles.imageUploadPlaceholder}>
                <FileText color={Colors.textTertiary} size={40} />
                <Text style={styles.imageUploadText}>Tap to select file</Text>
                <Text style={styles.imageUploadHint}>PDF files or images of lab results</Text>
              </View>
            )}
          </TouchableOpacity>

          {uploadedDocument && (
            <TouchableOpacity
              style={[styles.analyzeButton, isAnalyzing && styles.analyzeButtonDisabled]}
              onPress={handleAnalyzeLab}
              disabled={isAnalyzing}
            >
              {isAnalyzing ? (
                <Loader color={Colors.textInverse} size={20} />
              ) : (
                <Sparkles color={Colors.textInverse} size={20} />
              )}
              <Text style={styles.analyzeButtonText}>
                {isAnalyzing ? 'Analyzing...' : 'Analyze with AI'}
              </Text>
            </TouchableOpacity>
          )}

          <View style={styles.infoCard}>
            <Sparkles color={Colors.primary} size={20} />
            <Text style={styles.infoText}>
              Upload your labs and use AI to get a comprehensive functional medicine analysis including patterns, root causes, and personalized recommendations.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );

  if (!latestPanel) {
    return (
      <View style={styles.container}>
        <SafeAreaView edges={['top']} style={styles.emptyContainer}>
          <FlaskConical color={Colors.textTertiary} size={48} />
          <Text style={styles.emptyTitle}>No Lab Results</Text>
          <Text style={styles.emptySubtitle}>
            Upload your lab results or have your practitioner enter them.
          </Text>
          <TouchableOpacity
            style={styles.uploadButton}
            onPress={() => setShowUploadModal(true)}
          >
            <Upload color={Colors.textInverse} size={20} />
            <Text style={styles.uploadButtonText}>Upload Labs</Text>
          </TouchableOpacity>
        </SafeAreaView>
        {renderUploadModal()}
        {renderAnalysisModal()}
      </View>
    );
  
  function renderAnalysisModal() {
    return (
      <Modal
        visible={showAnalysisModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowAnalysisModal(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowAnalysisModal(false)}>
              <X color={Colors.text} size={24} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Lab Analysis</Text>
            <TouchableOpacity onPress={handleSaveAnalysisResults}>
              <Text style={styles.saveText}>Save</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.analysisContent} showsVerticalScrollIndicator={false}>
            {analysisResult ? (
              <>
                <View style={styles.summarySection}>
                  <Text style={styles.summaryTitle}>What Needs Attention</Text>
                  <Text style={styles.summaryText}>
                    {analysisResult.biomarkers.filter(b => b.status === 'suboptimal' || b.status === 'critical').length > 0
                      ? analysisResult.biomarkers
                          .filter(b => b.status === 'suboptimal' || b.status === 'critical')
                          .map(b => `• ${b.name}: ${b.value} ${b.unit}`)
                          .join('\n')
                      : 'All markers within optimal range!'}
                  </Text>
                </View>

                {analysisResult.priorityActions.length > 0 && (
                  <View style={styles.prioritySectionClean}>
                    <Text style={styles.priorityTitleClean}>Top Priorities</Text>
                    {analysisResult.priorityActions.slice(0, 3).map((action, idx) => (
                      <View key={idx} style={styles.priorityItemClean}>
                        <View style={styles.priorityNumberClean}>
                          <Text style={styles.priorityNumberTextClean}>{idx + 1}</Text>
                        </View>
                        <Text style={styles.priorityTextClean}>{action}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {(analysisResult.supplements.length > 0 || analysisResult.herbs.length > 0) && (
                  <View style={styles.supplementPlanSection}>
                    <Text style={styles.supplementPlanTitle}>Recommended Supplements</Text>
                    
                    {analysisResult.supplements.map((supp, idx) => (
                      <View key={`supp-${idx}`} style={styles.supplementItemClean}>
                        <View style={styles.supplementHeaderClean}>
                          <Text style={styles.supplementNameClean}>{supp.name}</Text>
                          <Text style={styles.supplementDoseClean}>{supp.dose}</Text>
                        </View>
                        <Text style={styles.supplementTimingClean}>{supp.timing}</Text>
                        {supp.affiliateLink && (
                          <TouchableOpacity
                            style={styles.shopButtonClean}
                            onPress={() => Linking.openURL(supp.affiliateLink!.url)}
                          >
                            <ExternalLink color="#fff" size={12} />
                            <Text style={styles.shopButtonText}>Shop</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    ))}

                    {analysisResult.herbs.map((herb, idx) => (
                      <View key={`herb-${idx}`} style={styles.supplementItemClean}>
                        <View style={styles.supplementHeaderClean}>
                          <Text style={styles.supplementNameClean}>{herb.name}</Text>
                          <Text style={styles.supplementDoseClean}>{herb.dose}</Text>
                        </View>
                        <Text style={styles.supplementTimingClean}>{herb.timing}</Text>
                        {herb.affiliateLink && (
                          <TouchableOpacity
                            style={styles.shopButtonClean}
                            onPress={() => Linking.openURL(herb.affiliateLink!.url)}
                          >
                            <ExternalLink color="#fff" size={12} />
                            <Text style={styles.shopButtonText}>Shop</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    ))}
                  </View>
                )}

                <View style={styles.disclaimerCardClean}>
                  <AlertTriangle color={Colors.warning} size={16} />
                  <Text style={styles.disclaimerTextClean}>
                    For educational purposes only. Consult your healthcare provider.
                  </Text>
                </View>

                {analysisResult && analysisResult.biomarkers.length > 0 && (
                  <TouchableOpacity
                    style={styles.saveResultsButton}
                    onPress={handleSaveAnalysisResults}
                  >
                    <CheckCircle color={Colors.textInverse} size={20} />
                    <Text style={styles.saveResultsButtonText}>
                      Save {analysisResult.biomarkers.length} Biomarkers
                    </Text>
                  </TouchableOpacity>
                )}
              </>
            ) : (
              <View style={styles.analysisLoading}>
                <Loader color={Colors.primary} size={24} />
                <Text style={styles.analysisLoadingText}>Analyzing...</Text>
              </View>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    );
  }
}

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[Colors.primaryDark, Colors.primary]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={['top']}>
          <View style={styles.header}>
            <View style={styles.headerTop}>
              <View style={styles.headerTitleRow}>
                <FlaskConical color={Colors.textInverse} size={24} />
                <Text style={styles.headerTitle}>Lab Results</Text>
              </View>
              <TouchableOpacity
                style={styles.addButton}
                onPress={() => setShowUploadModal(true)}
              >
                <Plus color={Colors.textInverse} size={20} />
              </TouchableOpacity>
            </View>
            <View style={styles.panelInfo}>
              <Calendar color="rgba(255,255,255,0.7)" size={14} />
              <Text style={styles.panelDate}>
                {new Date(latestPanel.date).toLocaleDateString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </Text>
            </View>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <View style={[styles.statIcon, { backgroundColor: `${Colors.success}30` }]}>
                <CheckCircle color={Colors.success} size={18} />
              </View>
              <Text style={styles.statValue}>{optimalBiomarkers.length}</Text>
              <Text style={styles.statLabel}>Optimal</Text>
            </View>
            <View style={styles.statCard}>
              <View style={[styles.statIcon, { backgroundColor: `${Colors.warning}30` }]}>
                <AlertTriangle color={Colors.warning} size={18} />
              </View>
              <Text style={styles.statValue}>{flaggedBiomarkers.length}</Text>
              <Text style={styles.statLabel}>Flagged</Text>
            </View>
            <View style={styles.statCard}>
              <View style={[styles.statIcon, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
                <FlaskConical color={Colors.textInverse} size={18} />
              </View>
              <Text style={styles.statValue}>{latestPanel.biomarkers.length}</Text>
              <Text style={styles.statLabel}>Total</Text>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {flaggedBiomarkers.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Needs Attention</Text>
            {flaggedBiomarkers.map(biomarker => (
              <BiomarkerCard
                key={biomarker.id}
                biomarker={biomarker}
                trend={getBiomarkerTrend(biomarker.id)}
                highlighted
              />
            ))}
          </View>
        )}

        {Object.entries(biomarkersByCategory).map(([category, biomarkers]) => {
          if (biomarkers.length === 0) return null;
          const isExpanded = expandedCategories.includes(category);

          return (
            <View key={category} style={styles.categorySection}>
              <TouchableOpacity
                style={styles.categoryHeader}
                onPress={() => toggleCategory(category)}
              >
                <Text style={styles.categoryTitle}>{category}</Text>
                <View style={styles.categoryMeta}>
                  <Text style={styles.categoryCount}>{biomarkers.length} markers</Text>
                  {isExpanded ? (
                    <ChevronUp color={Colors.textTertiary} size={20} />
                  ) : (
                    <ChevronDown color={Colors.textTertiary} size={20} />
                  )}
                </View>
              </TouchableOpacity>

              {isExpanded && (
                <View style={styles.categoryContent}>
                  {biomarkers.map(biomarker => (
                    <BiomarkerCard
                      key={biomarker.id}
                      biomarker={biomarker}
                      trend={getBiomarkerTrend(biomarker.id)}
                    />
                  ))}
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
      {renderUploadModal()}
      {renderAnalysisModal()}
    </View>
  );

  function renderAnalysisModal() {
    return (
      <Modal
        visible={showAnalysisModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowAnalysisModal(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowAnalysisModal(false)}>
              <X color={Colors.text} size={24} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Lab Analysis</Text>
            <TouchableOpacity onPress={handleSaveAnalysisResults}>
              <Text style={styles.saveText}>Save</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.analysisContent} showsVerticalScrollIndicator={false}>
            {analysisResult ? (
              <>
                <View style={styles.summarySection}>
                  <Text style={styles.summaryTitle}>What Needs Attention</Text>
                  <Text style={styles.summaryText}>
                    {analysisResult.biomarkers.filter(b => b.status === 'suboptimal' || b.status === 'critical').length > 0
                      ? analysisResult.biomarkers
                          .filter(b => b.status === 'suboptimal' || b.status === 'critical')
                          .map(b => `• ${b.name}: ${b.value} ${b.unit}`)
                          .join('\n')
                      : 'All markers within optimal range!'}
                  </Text>
                </View>

                {analysisResult.priorityActions.length > 0 && (
                  <View style={styles.prioritySectionClean}>
                    <Text style={styles.priorityTitleClean}>Top Priorities</Text>
                    {analysisResult.priorityActions.slice(0, 3).map((action, idx) => (
                      <View key={idx} style={styles.priorityItemClean}>
                        <View style={styles.priorityNumberClean}>
                          <Text style={styles.priorityNumberTextClean}>{idx + 1}</Text>
                        </View>
                        <Text style={styles.priorityTextClean}>{action}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {(analysisResult.supplements.length > 0 || analysisResult.herbs.length > 0) && (
                  <View style={styles.supplementPlanSection}>
                    <Text style={styles.supplementPlanTitle}>Recommended Supplements</Text>
                    
                    {analysisResult.supplements.map((supp, idx) => (
                      <View key={`supp-${idx}`} style={styles.supplementItemClean}>
                        <View style={styles.supplementHeaderClean}>
                          <Text style={styles.supplementNameClean}>{supp.name}</Text>
                          <Text style={styles.supplementDoseClean}>{supp.dose}</Text>
                        </View>
                        <Text style={styles.supplementTimingClean}>{supp.timing}</Text>
                        {supp.affiliateLink && (
                          <TouchableOpacity
                            style={styles.shopButtonClean}
                            onPress={() => Linking.openURL(supp.affiliateLink!.url)}
                          >
                            <ExternalLink color="#fff" size={12} />
                            <Text style={styles.shopButtonText}>Shop</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    ))}

                    {analysisResult.herbs.map((herb, idx) => (
                      <View key={`herb-${idx}`} style={styles.supplementItemClean}>
                        <View style={styles.supplementHeaderClean}>
                          <Text style={styles.supplementNameClean}>{herb.name}</Text>
                          <Text style={styles.supplementDoseClean}>{herb.dose}</Text>
                        </View>
                        <Text style={styles.supplementTimingClean}>{herb.timing}</Text>
                        {herb.affiliateLink && (
                          <TouchableOpacity
                            style={styles.shopButtonClean}
                            onPress={() => Linking.openURL(herb.affiliateLink!.url)}
                          >
                            <ExternalLink color="#fff" size={12} />
                            <Text style={styles.shopButtonText}>Shop</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    ))}
                  </View>
                )}

                <View style={styles.disclaimerCardClean}>
                  <AlertTriangle color={Colors.warning} size={16} />
                  <Text style={styles.disclaimerTextClean}>
                    For educational purposes only. Consult your healthcare provider.
                  </Text>
                </View>
              </>
            ) : (
              <View style={styles.analysisLoading}>
                <Loader color={Colors.primary} size={24} />
                <Text style={styles.analysisLoadingText}>Analyzing...</Text>
              </View>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    );
  }
}

function BiomarkerCard({
  biomarker,
  trend,
  highlighted = false,
}: {
  biomarker: Biomarker;
  trend: 'up' | 'down' | 'stable' | null;
  highlighted?: boolean;
}) {
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  const statusColor = statusColors[biomarker.status];

  const valuePosition =
    ((biomarker.value - biomarker.referenceRange.min) /
      (biomarker.referenceRange.max - biomarker.referenceRange.min)) *
    100;

  const clampedPosition = Math.max(0, Math.min(100, valuePosition));

  return (
    <View style={[styles.biomarkerCard, highlighted && styles.biomarkerCardHighlighted]}>
      <View style={styles.biomarkerHeader}>
        <View style={styles.biomarkerInfo}>
          <Text style={styles.biomarkerName}>{biomarker.name}</Text>
          <View style={[styles.statusBadge, { backgroundColor: `${statusColor}20` }]}>
            <Text style={[styles.statusText, { color: statusColor }]}>
              {statusLabels[biomarker.status]}
            </Text>
          </View>
        </View>
        <View style={styles.biomarkerValue}>
          <Text style={[styles.valueText, { color: statusColor }]}>
            {biomarker.value.toFixed(1)}
          </Text>
          <Text style={styles.unitText}>{biomarker.unit}</Text>
          {trend && (
            <TrendIcon
              color={
                trend === 'up'
                  ? Colors.success
                  : trend === 'down'
                  ? Colors.danger
                  : Colors.textTertiary
              }
              size={16}
            />
          )}
        </View>
      </View>

      <View style={styles.rangeContainer}>
        <View style={styles.rangeBar}>
          <View
            style={[
              styles.functionalRange,
              {
                left: `${((biomarker.functionalRange.min - biomarker.referenceRange.min) /
                  (biomarker.referenceRange.max - biomarker.referenceRange.min)) *
                  100}%`,
                width: `${((biomarker.functionalRange.max - biomarker.functionalRange.min) /
                  (biomarker.referenceRange.max - biomarker.referenceRange.min)) *
                  100}%`,
              },
            ]}
          />
          <View
            style={[
              styles.valueMarker,
              {
                left: `${clampedPosition}%`,
                backgroundColor: statusColor,
              },
            ]}
          />
        </View>
        <View style={styles.rangeLabels}>
          <Text style={styles.rangeValue}>{biomarker.referenceRange.min}</Text>
          <Text style={styles.rangeLabel}>Reference Range</Text>
          <Text style={styles.rangeValue}>{biomarker.referenceRange.max}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  loadingText: {
    fontSize: 16,
    color: Colors.textSecondary,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600' as const,
    color: Colors.text,
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
  },
  uploadButtonText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.textInverse,
  },
  headerGradient: {
    paddingBottom: 20,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: Colors.textInverse,
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  panelInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  panelDate: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginTop: 16,
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
  },
  statIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '700' as const,
    color: Colors.textInverse,
  },
  statLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 2,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 120,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 12,
  },
  categorySection: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    marginBottom: 12,
    overflow: 'hidden',
  },
  categoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  categoryTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  categoryMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  categoryCount: {
    fontSize: 13,
    color: Colors.textTertiary,
  },
  categoryContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  biomarkerCard: {
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  biomarkerCardHighlighted: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.warning,
  },
  biomarkerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  biomarkerInfo: {
    flex: 1,
  },
  biomarkerName: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 6,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600' as const,
  },
  biomarkerValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  valueText: {
    fontSize: 20,
    fontWeight: '700' as const,
  },
  unitText: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginRight: 4,
  },
  rangeContainer: {
    marginTop: 8,
  },
  rangeBar: {
    height: 8,
    backgroundColor: Colors.border,
    borderRadius: 4,
    position: 'relative',
    overflow: 'visible',
  },
  functionalRange: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: `${Colors.success}40`,
    borderRadius: 4,
  },
  valueMarker: {
    position: 'absolute',
    top: -4,
    width: 16,
    height: 16,
    borderRadius: 8,
    marginLeft: -8,
    borderWidth: 3,
    borderColor: Colors.surface,
  },
  rangeLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  rangeValue: {
    fontSize: 11,
    color: Colors.textTertiary,
  },
  rangeLabel: {
    fontSize: 11,
    color: Colors.textTertiary,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  saveText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  modalContent: {
    flex: 1,
    padding: 20,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.text,
    marginBottom: 8,
    marginTop: 16,
  },
  textInput: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: Colors.text,
  },
  imageUploadArea: {
    backgroundColor: Colors.surface,
    borderWidth: 2,
    borderColor: Colors.border,
    borderStyle: 'dashed',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  imageUploadPlaceholder: {
    alignItems: 'center',
  },
  imageUploadText: {
    fontSize: 16,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
    marginTop: 12,
  },
  imageUploadHint: {
    fontSize: 13,
    color: Colors.textTertiary,
    marginTop: 4,
  },
  imageUploaded: {
    alignItems: 'center',
  },
  imageUploadedText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.success,
    marginTop: 12,
  },
  imageUploadedHint: {
    fontSize: 13,
    color: Colors.textTertiary,
    marginTop: 4,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: `${Colors.warning}15`,
    borderRadius: 12,
    padding: 16,
    marginTop: 24,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 19,
  },
  analyzeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    marginTop: 16,
  },
  analyzeButtonDisabled: {
    opacity: 0.7,
  },
  analyzeButtonText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.textInverse,
  },
  analysisContent: {
    flex: 1,
    padding: 20,
  },
  analysisHeader: {
    alignItems: 'center',
    marginBottom: 24,
  },
  analysisIconContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: `${Colors.primary}15`,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  analysisTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 6,
  },
  analysisSubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  analysisResultContainer: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
  },
  analysisResultText: {
    fontSize: 15,
    color: Colors.text,
    lineHeight: 24,
  },
  analysisLoading: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  analysisLoadingText: {
    fontSize: 15,
    color: Colors.textSecondary,
    marginTop: 12,
  },
  disclaimerCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: `${Colors.warning}10`,
    borderRadius: 12,
    padding: 16,
    marginBottom: 40,
  },
  disclaimerText: {
    flex: 1,
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  extractedSection: {
    backgroundColor: `${Colors.success}10`,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  extractedTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.success,
    marginBottom: 12,
  },
  extractedList: {
    gap: 8,
  },
  extractedItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: `${Colors.success}20`,
  },
  extractedName: {
    fontSize: 14,
    color: Colors.text,
    flex: 1,
  },
  extractedValue: {
    fontSize: 14,
    fontWeight: '600' as const,
  },
  extractedMore: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontStyle: 'italic',
    marginTop: 8,
    textAlign: 'center',
  },
  recommendationsSection: {
    marginBottom: 20,
  },
  recommendationsTitle: {
    fontSize: 17,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 12,
  },
  recommendationCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderLeftWidth: 3,
    borderLeftColor: Colors.primary,
  },
  recommendationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  recommendationName: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  recommendationDose: {
    fontSize: 13,
    fontWeight: '500' as const,
    color: Colors.primary,
    backgroundColor: `${Colors.primary}15`,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  recommendationTiming: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 6,
  },
  recommendationReason: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 19,
  },
  affiliateLinkButton: {
    marginTop: 12,
    backgroundColor: `${Colors.primary}10`,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: `${Colors.primary}30`,
  },
  affiliateLinkContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  affiliateLinkText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  discountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    backgroundColor: `${Colors.success}15`,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  discountText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.success,
  },
  prioritySection: {
    backgroundColor: `${Colors.warning}10`,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  priorityTitle: {
    fontSize: 17,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 12,
  },
  priorityItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 10,
  },
  priorityNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.warning,
    alignItems: 'center',
    justifyContent: 'center',
  },
  priorityNumberText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.textInverse,
  },
  priorityText: {
    flex: 1,
    fontSize: 14,
    color: Colors.text,
    lineHeight: 20,
  },
  analysisSectionTitle: {
    fontSize: 17,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 12,
  },
  summarySection: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
  },
  summaryTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 16,
  },
  summaryText: {
    fontSize: 15,
    color: Colors.text,
    lineHeight: 26,
  },
  prioritySectionClean: {
    backgroundColor: '#FEF3C7',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
  },
  priorityTitleClean: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: '#92400E',
    marginBottom: 16,
  },
  priorityItemClean: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    marginBottom: 14,
  },
  priorityNumberClean: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#F59E0B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  priorityNumberTextClean: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: '#fff',
  },
  priorityTextClean: {
    flex: 1,
    fontSize: 15,
    color: '#78350F',
    lineHeight: 22,
  },
  supplementPlanSection: {
    backgroundColor: '#ECFDF5',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
  },
  supplementPlanTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: '#065F46',
    marginBottom: 16,
  },
  supplementItemClean: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  supplementHeaderClean: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  supplementNameClean: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
    flex: 1,
  },
  supplementDoseClean: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#059669',
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  supplementTimingClean: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 10,
  },
  shopButtonClean: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#059669',
    paddingVertical: 10,
    borderRadius: 8,
  },
  shopButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#fff',
  },
  disclaimerCardClean: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 12,
    padding: 14,
    marginBottom: 30,
  },
  disclaimerTextClean: {
    flex: 1,
    fontSize: 13,
    color: Colors.textTertiary,
  },
  saveResultsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: Colors.success,
    borderRadius: 14,
    paddingVertical: 16,
    marginBottom: 20,
  },
  saveResultsButtonText: {
    fontSize: 17,
    fontWeight: '600' as const,
    color: Colors.textInverse,
  },
});
