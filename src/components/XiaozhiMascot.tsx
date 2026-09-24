import { Image, StyleSheet, View } from 'react-native';

const xiaozhiMascotSource = require('../../assets/images/xiaozhi-mascot.png');

export function XiaozhiMascot({ size = 88 }: { size?: number }) {
  return (
    <View accessibilityLabel="小知" pointerEvents="none" style={[styles.wrap, { width: size, height: size }]}>
      <Image
        defaultSource={xiaozhiMascotSource}
        fadeDuration={0}
        resizeMode="contain"
        source={xiaozhiMascotSource}
        style={styles.image}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
});
