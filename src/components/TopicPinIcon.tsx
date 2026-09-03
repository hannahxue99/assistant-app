import { SymbolView } from 'expo-symbols';
import { StyleSheet } from 'react-native';

import { theme } from '../theme';

type TopicPinIconProps = {
  pinned: boolean;
  size?: number;
};

/** 聚合主题唯一图钉：钉帽右上、钉尖左下。 */
export function TopicPinIcon({ pinned, size = 19 }: TopicPinIconProps) {
  return (
    <SymbolView
      name={{
        ios: pinned ? 'pin.fill' : 'pin',
        android: 'push_pin',
        web: 'push_pin',
      }}
      size={size}
      weight="regular"
      tintColor={pinned ? theme.colors.gold : theme.colors.textDim}
      resizeMode="scaleAspectFit"
      style={styles.icon}
    />
  );
}

const styles = StyleSheet.create({
  // Vertical source symbol -> cap upper-right and point lower-left.
  icon: { transform: [{ rotate: '45deg' }] },
});

