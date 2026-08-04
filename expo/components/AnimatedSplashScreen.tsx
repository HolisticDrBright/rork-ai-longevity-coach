import React, { useEffect, useRef } from 'react';
import { Animated, Dimensions, Easing, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';

const SPLASH_IMAGE = require('@/assets/images/splash-icon.png');

// Matches the navy background baked into splash-icon.png so the square
// image blends into the overlay instead of showing as a boxed rectangle.
const SPLASH_BACKGROUND_COLOR = '#02051B';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const LOGO_SIZE = Math.min(SCREEN_WIDTH * 0.62, 320);

interface AnimatedSplashScreenProps {
  onAnimationFinish: () => void;
}

export default function AnimatedSplashScreen({ onAnimationFinish }: AnimatedSplashScreenProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.85)).current;
  const overlayOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 450,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.spring(scale, {
          toValue: 1,
          friction: 6,
          tension: 60,
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(450),
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: 350,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        onAnimationFinish();
      }
    });
  }, [onAnimationFinish, opacity, overlayOpacity, scale]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.container, { opacity: overlayOpacity }]}
    >
      <StatusBar style="light" />
      <Animated.Image
        source={SPLASH_IMAGE}
        resizeMode="contain"
        style={[styles.logo, { opacity, transform: [{ scale }] }]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: SPLASH_BACKGROUND_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
  },
});
