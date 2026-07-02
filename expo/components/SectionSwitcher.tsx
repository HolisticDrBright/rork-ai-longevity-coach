import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { router, type Href } from 'expo-router';

import Colors from '@/constants/colors';

export interface SectionSwitcherItem {
  key: string;
  label: string;
  route: string;
}

export const HEALTH_SECTIONS: SectionSwitcherItem[] = [
  { key: 'insights', label: 'Insights', route: '/(tabs)/(health)/insights' },
  { key: 'analysis', label: 'Analysis', route: '/(tabs)/(health)/analysis' },
  { key: 'labs', label: 'Labs', route: '/(tabs)/(health)/labs' },
  { key: 'wearables', label: 'Wearables', route: '/(tabs)/(health)/(wearables)/dashboard' },
];

export const LOG_SECTIONS: SectionSwitcherItem[] = [
  { key: 'tracking', label: 'Track', route: '/(tabs)/(log)/tracking' },
  { key: 'nutrition', label: 'Nutrition', route: '/(tabs)/(log)/(nutrition)/dashboard' },
];

interface SectionSwitcherProps {
  items: SectionSwitcherItem[];
  activeKey: string;
}

export default function SectionSwitcher({ items, activeKey }: SectionSwitcherProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.container}
      contentContainerStyle={styles.content}
      testID="section-switcher"
    >
      {items.map(item => {
        const isActive = item.key === activeKey;
        return (
          <TouchableOpacity
            key={item.key}
            style={[styles.pill, isActive ? styles.pillActive : styles.pillInactive]}
            onPress={() => {
              if (!isActive) {
                router.replace(item.route as Href);
              }
            }}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: isActive }}
            testID={`section-${item.key}`}
          >
            <Text style={[styles.pillText, isActive ? styles.pillTextActive : styles.pillTextInactive]}>
              {item.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 0,
  },
  content: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  pill: {
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  pillActive: {
    backgroundColor: Colors.primary,
  },
  pillInactive: {
    backgroundColor: Colors.surfaceSecondary,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '600' as const,
  },
  pillTextActive: {
    color: Colors.textInverse,
  },
  pillTextInactive: {
    color: Colors.textSecondary,
  },
});
