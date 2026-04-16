import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { AlertTriangle, Star, Info } from 'lucide-react-native';
import Colors from '@/constants/colors';
import ParadigmChip, { PARADIGM_COLORS, type Paradigm } from './ParadigmChip';

interface Hypothesis {
  id?: string;
  paradigm: Paradigm;
  mechanism: string;
  rationale: string;
  safety_concerns?: string[];
  supporting_references?: string[];
  referenced_paradigms?: string[];
  paradigm_conflicts?: string;
  recommended_lens_weighting?: Record<string, number>;
  safety_override?: string | null;
  llm_confidence?: number;
}

interface Props {
  hypothesis: Hypothesis;
  currentScore?: number;
  onScore?: (score: number) => void;
}

export default function HypothesisCard({ hypothesis, currentScore, onScore }: Props) {
  const isSynergistic = hypothesis.paradigm === 'synergistic';
  const color = PARADIGM_COLORS[hypothesis.paradigm];

  return (
    <View style={[
      styles.card,
      isSynergistic && styles.cardSynergistic,
      { borderLeftColor: color },
    ]}>
      <View style={styles.header}>
        <ParadigmChip paradigm={hypothesis.paradigm} filled />
        {hypothesis.llm_confidence != null && (
          <View style={styles.confidence}>
            <Text style={styles.confidenceLabel}>confidence</Text>
            <Text style={[styles.confidenceValue, { color }]}>
              {Math.round(hypothesis.llm_confidence * 100)}%
            </Text>
          </View>
        )}
      </View>

      {hypothesis.safety_override && (
        <View style={styles.safetyOverride}>
          <AlertTriangle color={Colors.danger} size={14} />
          <Text style={styles.safetyOverrideText}>
            Safety override: {hypothesis.safety_override}
          </Text>
        </View>
      )}

      <Text style={styles.label}>Mechanism</Text>
      <Text style={styles.mechanism}>{hypothesis.mechanism}</Text>

      <Text style={styles.label}>Rationale</Text>
      <Text style={styles.rationale}>{hypothesis.rationale}</Text>

      {isSynergistic && hypothesis.referenced_paradigms && hypothesis.referenced_paradigms.length > 0 && (
        <>
          <Text style={styles.label}>References</Text>
          <View style={styles.refChips}>
            {hypothesis.referenced_paradigms.map(p => (
              <ParadigmChip key={p} paradigm={p as Paradigm} compact />
            ))}
          </View>
        </>
      )}

      {isSynergistic && hypothesis.paradigm_conflicts && (
        <>
          <Text style={[styles.label, { color: Colors.warning }]}>Conflicts</Text>
          <Text style={styles.conflict}>{hypothesis.paradigm_conflicts}</Text>
        </>
      )}

      {isSynergistic && hypothesis.recommended_lens_weighting && (
        <>
          <Text style={styles.label}>Recommended lens weighting</Text>
          <View style={styles.weightingRow}>
            {Object.entries(hypothesis.recommended_lens_weighting).map(([p, w]) => {
              const weight = Number(w);
              return (
                <View key={p} style={styles.weightCell}>
                  <Text style={[styles.weightName, { color: PARADIGM_COLORS[p as Paradigm] ?? Colors.primary }]}>
                    {p}
                  </Text>
                  <View style={styles.weightBarBg}>
                    <View style={[
                      styles.weightBar,
                      {
                        width: `${Math.min(100, Math.max(0, weight * 100))}%`,
                        backgroundColor: PARADIGM_COLORS[p as Paradigm] ?? Colors.primary,
                      },
                    ]} />
                  </View>
                  <Text style={styles.weightValue}>{(weight * 100).toFixed(0)}%</Text>
                </View>
              );
            })}
          </View>
        </>
      )}

      {hypothesis.safety_concerns && hypothesis.safety_concerns.length > 0 && (
        <View style={styles.safetyBlock}>
          <View style={styles.safetyHeader}>
            <AlertTriangle color={Colors.warning} size={14} />
            <Text style={styles.safetyTitle}>Safety concerns</Text>
          </View>
          {hypothesis.safety_concerns.map((s, i) => (
            <Text key={i} style={styles.safetyItem}>• {s}</Text>
          ))}
        </View>
      )}

      {hypothesis.supporting_references && hypothesis.supporting_references.length > 0 && (
        <View style={styles.refsBlock}>
          <View style={styles.safetyHeader}>
            <Info color={Colors.textTertiary} size={12} />
            <Text style={styles.refsTitle}>References (qualitative)</Text>
          </View>
          {hypothesis.supporting_references.map((r, i) => (
            <Text key={i} style={styles.refItem}>{r}</Text>
          ))}
        </View>
      )}

      {onScore && (
        <View style={styles.scoreRow}>
          <Text style={styles.scoreLabel}>Quality score:</Text>
          {[1, 2, 3, 4, 5].map(n => (
            <TouchableOpacity key={n} onPress={() => onScore(n)}>
              <Star
                color={n <= (currentScore ?? 0) ? Colors.warning : Colors.borderLight}
                fill={n <= (currentScore ?? 0) ? Colors.warning : 'none'}
                size={18}
              />
            </TouchableOpacity>
          ))}
          {currentScore ? <Text style={styles.scoreValue}>{currentScore}/5</Text> : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
    borderLeftWidth: 4, padding: 14, gap: 8,
    minWidth: 280, maxWidth: 360,
  },
  cardSynergistic: {
    borderLeftWidth: 6,
    minWidth: 320, maxWidth: 480,
    backgroundColor: Colors.primary + '05',
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  confidence: { alignItems: 'flex-end' },
  confidenceLabel: { fontSize: 9, color: Colors.textTertiary, textTransform: 'uppercase' },
  confidenceValue: { fontSize: 13, fontWeight: '800' },
  safetyOverride: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.danger + '15', borderRadius: 6,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  safetyOverrideText: { flex: 1, fontSize: 12, color: Colors.danger, fontWeight: '600' },
  label: { fontSize: 10, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', marginTop: 4 },
  mechanism: { fontSize: 13, color: Colors.text, fontWeight: '600', lineHeight: 18 },
  rationale: { fontSize: 12, color: Colors.textSecondary, lineHeight: 18 },
  conflict: { fontSize: 12, color: Colors.text, lineHeight: 18, fontStyle: 'italic' },
  refChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  weightingRow: { gap: 4 },
  weightCell: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  weightName: { width: 80, fontSize: 11, fontWeight: '600' },
  weightBarBg: { flex: 1, height: 6, backgroundColor: Colors.borderLight, borderRadius: 3 },
  weightBar: { height: 6, borderRadius: 3 },
  weightValue: { width: 36, fontSize: 11, fontWeight: '700', color: Colors.textSecondary, textAlign: 'right' },
  safetyBlock: { marginTop: 6, padding: 10, backgroundColor: Colors.warning + '10', borderRadius: 8, gap: 4 },
  safetyHeader: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  safetyTitle: { fontSize: 11, fontWeight: '700', color: Colors.warning, textTransform: 'uppercase' },
  safetyItem: { fontSize: 12, color: Colors.text, lineHeight: 18 },
  refsBlock: { marginTop: 4, padding: 8, backgroundColor: Colors.surfaceSecondary, borderRadius: 6, gap: 3 },
  refsTitle: { fontSize: 10, fontWeight: '700', color: Colors.textTertiary, textTransform: 'uppercase' },
  refItem: { fontSize: 11, color: Colors.textSecondary, lineHeight: 16 },
  scoreRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 8, paddingTop: 8,
    borderTopWidth: 1, borderTopColor: Colors.borderLight,
  },
  scoreLabel: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, marginRight: 4 },
  scoreValue: { fontSize: 12, fontWeight: '700', color: Colors.primary, marginLeft: 4 },
});
