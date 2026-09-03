import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text } from 'react-native';

import { theme } from '../theme';

type EditActionProps = {
  editing: boolean;
  onPress: () => void;
  level?: 'page' | 'module';
  disabled?: boolean;
  label?: string;
};

/** 全 App 统一编辑入口：浏览态铅笔，编辑态同位置显示“完成”。 */
export function EditAction({
  editing,
  onPress,
  level = 'page',
  disabled = false,
  label = '编辑',
}: EditActionProps) {
  const moduleLevel = level === 'module';
  return (
    <Pressable
      style={styles.hitArea}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={editing ? '完成编辑' : label}
      hitSlop={4}
    >
      {editing ? (
        <Text style={[styles.done, moduleLevel && styles.doneModule, disabled && styles.disabled]}>
          完成
        </Text>
      ) : (
        <Ionicons
          name="pencil-outline"
          size={moduleLevel ? 18 : 20}
          color={disabled ? theme.colors.textDim : theme.colors.accent}
        />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hitArea: {
    width: 44,
    height: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  done: { fontSize: theme.font.body, color: theme.colors.accent, fontWeight: '600' },
  doneModule: { fontSize: theme.font.small },
  disabled: { color: theme.colors.textDim },
});
