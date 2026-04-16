import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { AlertOctagon, Shield, ChevronRight, CheckCircle } from 'lucide-react-native';
import Colors from '@/constants/colors';

interface Props {
  reviewItems: string[];
  approved?: boolean;
  onRequestReview?: () => void;
  onDismiss?: () => void;
}

export default function PractitionerReviewBanner({ reviewItems, approved, onRequestReview }: Props) {
  if (reviewItems.length === 0 && !approved) return null;

  const hasCritical = reviewItems.some(i => /CRITICAL/i.test(i));

  if (approved) {
    return (
      <View style={[styles.container, styles.containerApproved]}>
        <CheckCircle color={Colors.success} size={22} />
        <View style={styles.content}>
          <Text style={[styles.title, { color: Colors.success }]}>Practitioner Approved</Text>
          <Text style={styles.subtitle}>Your protocol has been reviewed and approved by Dr. Bright.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, hasCritical ? styles.containerCritical : styles.containerWarning]}>
      {hasCritical ? (
        <AlertOctagon color={Colors.danger} size={22} />
      ) : (
        <Shield color={Colors.warning} size={22} />
      )}
      <View style={styles.content}>
        <Text style={[styles.title, { color: hasCritical ? Colors.danger : Colors.warning }]}>
          {hasCritical ? 'Critical Review Required' : 'Practitioner Review Required'}
        </Text>
        <Text style={styles.subtitle}>
          {reviewItems.length} item{reviewItems.length > 1 ? 's' : ''} require{reviewItems.length === 1 ? 's' : ''} your practitioner's review before starting.
        </Text>
        <View style={styles.itemList}>
          {reviewItems.slice(0, 3).map((item, i) => (
            <View key={i} style={styles.itemRow}>
              <View style={styles.bullet} />
              <Text style={styles.itemText}>{item}</Text>
            </View>
          ))}
          {reviewItems.length > 3 && (
            <Text style={styles.moreText}>+{reviewItems.length - 3} more items</Text>
          )}
        </View>
        {onRequestReview && (
          <TouchableOpacity style={styles.reviewButton} onPress={onRequestReview}>
            <Text style={styles.reviewButtonText}>Request Practitioner Review</Text>
            <ChevronRight color="#fff" size={16} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row', gap: 12,
    margin: 12, padding: 14, borderRadius: 12,
    borderWidth: 1,
  },
  containerCritical: { backgroundColor: Colors.danger + '10', borderColor: Colors.danger + '40' },
  containerWarning: { backgroundColor: Colors.warning + '10', borderColor: Colors.warning + '40' },
  containerApproved: { backgroundColor: Colors.success + '10', borderColor: Colors.success + '40', alignItems: 'center' },
  content: { flex: 1, gap: 6 },
  title: { fontSize: 14, fontWeight: '700' },
  subtitle: { fontSize: 12, color: Colors.textSecondary, lineHeight: 16 },
  itemList: { marginTop: 6, gap: 4 },
  itemRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  bullet: { width: 4, height: 4, borderRadius: 2, backgroundColor: Colors.textTertiary, marginTop: 6 },
  itemText: { flex: 1, fontSize: 12, color: Colors.text, lineHeight: 16 },
  moreText: { fontSize: 11, color: Colors.textTertiary, fontStyle: 'italic', marginTop: 2 },
  reviewButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: 10, paddingVertical: 10, borderRadius: 8,
    backgroundColor: Colors.primary,
  },
  reviewButtonText: { fontSize: 13, fontWeight: '600', color: '#fff' },
});
