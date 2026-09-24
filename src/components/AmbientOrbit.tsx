import type { StyleProp, ViewStyle } from 'react-native';
import { StyleSheet, View } from 'react-native';

export function AmbientOrbit({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.stage, style]}
    >
      <View style={[styles.orbit, styles.coral]} />
      <View style={[styles.orbit, styles.cyan]} />
      <View style={[styles.orbit, styles.lilac]} />
      <View style={styles.signal} />
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 190,
    overflow: 'hidden',
  },
  orbit: {
    position: 'absolute',
    width: 430,
    height: 108,
    borderRadius: 220,
    borderWidth: StyleSheet.hairlineWidth,
    transform: [{ rotate: '-8deg' }],
  },
  coral: {
    top: 35,
    left: -54,
    borderColor: 'rgba(233, 120, 61, 0.18)',
  },
  cyan: {
    top: 40,
    left: -48,
    borderColor: 'rgba(95, 169, 218, 0.20)',
    transform: [{ rotate: '-6deg' }],
  },
  lilac: {
    top: 31,
    left: -61,
    borderColor: 'rgba(145, 118, 214, 0.16)',
    transform: [{ rotate: '-10deg' }],
  },
  signal: {
    position: 'absolute',
    top: 79,
    right: 31,
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(233, 120, 61, 0.72)',
  },
});
