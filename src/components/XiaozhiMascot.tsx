import { Image, StyleSheet, View } from 'react-native';

export function XiaozhiMascot({ size = 88 }: { size?: number }) {
  return (
    <View accessibilityLabel="小知" style={[styles.wrap, { width: size, height: size }]}>
      <Image
        source={require('../../assets/images/xiaozhi-mascot.png')}
        resizeMode="contain"
        style={styles.image}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
});
