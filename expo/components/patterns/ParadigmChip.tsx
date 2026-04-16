import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Colors from '@/constants/colors';

export type Paradigm =
  | 'western' | 'functional' | 'naturopathic'
  | 'tcm' | 'ayurvedic' | 'biohacking' | 'synergistic';

export const PARADIGM_LABELS: Record<Paradigm, string> = {
  western: 'Western',
  functional: 'Functional',
  naturopathic: 'Naturopathic',
  tcm: 'TCM',
  ayurvedic: 'Ayurvedic',
  biohacking: 'Biohacking',
  synergistic: 'Synergistic',
};

export const PARADIGM_COLORS: Record<Paradigm, string> = {
  western: '#3B82F6',
  functional: '#10B981',
  naturopathic: '#059669',
  tcm: '#EC4899',
  ayurvedic: '#F59E0B',
  biohacking: '#8B5CF6',
  synergistic: Colors.primary,
};

export const ALL_PARADIGMS: Paradigm[] = [
  'western', 'functional', 'naturopathic', 'tcm', 'ayurvedic', 'biohacking', 'synergistic',
];

interface ChipProps {
  paradigm: Paradigm;
  filled?: boolean;
  onPress?: () => void;
  selected?: boolean;
  disabled?: boolean;
  compact?: boolean;
}

export default function ParadigmChip({ paradigm, filled, onPress, selected, disabled, compact }: ChipProps) {
  const color = PARADIGM_COLORS[paradigm];
  const label = PARADIGM_LABELS[paradigm];
  const visualFill = filled || selected;
  const Comp: any = onPress ? TouchableOpacity : View;

  return (
    <Comp
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.chip,
        compact && styles.chipCompact,
        visualFill
          ? { backgroundColor: color, borderColor: color }
          : { backgroundColor: 'transparent', borderColor: color + '80' },
        disabled && { opacity: 0.4 },
      ]}
    >
      <Text style={[
        styles.label,
        compact && styles.labelCompact,
        { color: visualFill ? '#fff' : color },
      ]}>
        {label}
      </Text>
    </Comp>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 18, borderWidth: 1.5,
  },
  chipCompact: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  label: { fontSize: 12, fontWeight: '700' },
  labelCompact: { fontSize: 10 },
});
