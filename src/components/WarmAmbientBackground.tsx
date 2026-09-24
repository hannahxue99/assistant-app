import { StyleSheet, View } from 'react-native';

export function WarmAmbientBackground() {
  return (
    <View pointerEvents="none" style={styles.layer}>
      <View style={[styles.glow, styles.topGlow]} />
      <View style={[styles.glow, styles.middleGlow]} />
      <View style={[styles.glow, styles.bottomGlow]} />
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'hidden' },
  glow: { position: 'absolute', borderRadius: 999, backgroundColor: '#F7B77F' },
  topGlow: { width: 260, height: 260, top: -92, right: -110, opacity: 0.13 },
  middleGlow: { width: 220, height: 220, top: '37%', left: -145, opacity: 0.07 },
  bottomGlow: { width: 300, height: 300, bottom: -190, right: -120, opacity: 0.09 },
});
