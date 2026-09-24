import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  AppState,
  type AppStateStatus,
  Easing,
  StyleSheet,
  View,
} from 'react-native';

import { theme } from '../theme';

type XiaozhiEyesIconProps = {
  size: number;
  focused: boolean;
};

const GAZE_POSITIONS = [
  { x: -3.5, y: 0 },
  { x: 0, y: -2 },
  { x: 3.5, y: 0 },
  { x: 2, y: 2 },
  { x: -2, y: 2 },
] as const;

function randomDelay(min: number, max: number) {
  return Math.round(min + Math.random() * (max - min));
}

export function XiaozhiEyesIcon({ size, focused }: XiaozhiEyesIconProps) {
  const gazeX = useRef(new Animated.Value(0)).current;
  const gazeY = useRef(new Animated.Value(0)).current;
  const blink = useRef(new Animated.Value(1)).current;
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const [reduceMotion, setReduceMotion] = useState(true);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (mounted) setReduceMotion(value);
    });
    const motionSubscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    const appStateSubscription = AppState.addEventListener('change', setAppState);
    return () => {
      mounted = false;
      motionSubscription.remove();
      appStateSubscription.remove();
    };
  }, []);

  useEffect(() => {
    let gazeTimer: ReturnType<typeof setTimeout> | undefined;
    let blinkTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const reset = () => {
      gazeX.stopAnimation();
      gazeY.stopAnimation();
      blink.stopAnimation();
      gazeX.setValue(0);
      gazeY.setValue(0);
      blink.setValue(1);
    };

    if (reduceMotion || appState !== 'active') {
      reset();
      return reset;
    }

    const scheduleGaze = () => {
      gazeTimer = setTimeout(() => {
        if (cancelled) return;
        const target = GAZE_POSITIONS[Math.floor(Math.random() * GAZE_POSITIONS.length)];
        Animated.parallel([
          Animated.timing(gazeX, {
            toValue: target.x,
            duration: 260,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(gazeY, {
            toValue: target.y,
            duration: 260,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]).start(({ finished }) => {
          if (finished && !cancelled) scheduleGaze();
        });
      }, randomDelay(900, 1500));
    };

    const scheduleBlink = () => {
      blinkTimer = setTimeout(() => {
        if (cancelled) return;
        Animated.sequence([
          Animated.timing(blink, {
            toValue: 0.12,
            duration: 70,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(blink, {
            toValue: 1,
            duration: 90,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]).start(({ finished }) => {
          if (finished && !cancelled) scheduleBlink();
        });
      }, randomDelay(5000, 8000));
    };

    scheduleGaze();
    scheduleBlink();

    return () => {
      cancelled = true;
      if (gazeTimer) clearTimeout(gazeTimer);
      if (blinkTimer) clearTimeout(blinkTimer);
      reset();
    };
  }, [appState, blink, gazeX, gazeY, reduceMotion]);

  const faceSize = Math.max(24, Math.round(size + (focused ? 8 : 4)));
  const slotSize = Math.max(faceSize, Math.round(size + 10));
  const eyeWidth = Math.max(5, Math.round(faceSize * 0.18));
  const eyeHeight = Math.max(7, Math.round(faceSize * 0.27));
  const eyeStyle = {
    width: eyeWidth,
    height: eyeHeight,
    backgroundColor: focused ? '#FFF7F2' : theme.colors.graphite,
    transform: [
      { translateX: gazeX },
      { translateY: gazeY },
      { scaleY: blink },
    ],
  };

  return (
    <View
      style={[
        styles.slot,
        {
          width: slotSize,
          height: slotSize,
          transform: [{ translateY: focused ? -3 : 0 }],
        },
      ]}
    >
      <View
        style={[
          styles.face,
          {
            width: faceSize,
            height: faceSize,
            borderRadius: faceSize / 2,
            backgroundColor: focused ? theme.colors.accent : theme.colors.fog,
          },
        ]}
      >
        <View style={styles.eyes}>
          <Animated.View style={[styles.eye, eyeStyle]} />
          <Animated.View style={[styles.eye, eyeStyle]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  face: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyes: {
    flexDirection: 'row',
    gap: 5,
    transform: [{ translateY: -2 }],
  },
  eye: {
    borderRadius: 5,
  },
});
