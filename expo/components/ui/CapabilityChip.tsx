import { View, Text, StyleSheet } from 'react-native';
import Colors from '@/constants/colors';
import type { MetricAvailability } from '@/constants/wearableCapabilities';

/**
 * Small pill showing a metric a provider can supply.
 * - 'live'     → primary styling (data is flowing)
 * - 'expected' → muted styling (connected, awaiting first sync)
 * - 'locked'   → neutral styling (used in the device catalog, where nothing
 *                is connected yet)
 */
export default function CapabilityChip({ label, availability }: {
  label: string;
  availability?: MetricAvailability;
}) {
  const isLive = availability === 'live';
  const isExpected = availability === 'expected';
  return (
    <View
      style={[
        styles.chip,
        isLive && styles.chipLive,
        isExpected && styles.chipExpected,
      ]}
    >
      <Text
        style={[
          styles.chipText,
          isLive && styles.chipTextLive,
          isExpected && styles.chipTextExpected,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: Colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  chipLive: {
    backgroundColor: Colors.primary + '14',
    borderColor: Colors.primary + '40',
  },
  chipExpected: {
    backgroundColor: Colors.surfaceSecondary,
    borderColor: Colors.border,
    opacity: 0.75,
  },
  chipText: { fontSize: 10, fontWeight: '600' as const, color: Colors.textTertiary },
  chipTextLive: { color: Colors.primary },
  chipTextExpected: { color: Colors.textTertiary },
});
