import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '../theme';

interface Props {
  kind: 'success' | 'error' | null;
  message: string;
  onClose: () => void;
  onRetry: () => void;
}

export function ImportFeedbackModal({ kind, message, onClose, onRetry }: Props) {
  const success = kind === 'success';
  return (
    <Modal
      animationType="slide"
      transparent
      visible={kind !== null}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.header}>
            <View style={[styles.iconWrap, success ? styles.successIcon : styles.errorIcon]}>
              <Ionicons
                name={success ? 'checkmark-circle-outline' : 'warning-outline'}
                size={22}
                color={success ? theme.colors.green : theme.colors.red}
              />
            </View>
            <Text style={styles.title}>{success ? '导入完成' : '无法导入这个文件'}</Text>
          </View>
          <Text style={success ? styles.message : styles.errorMessage}>{message}</Text>
          {success ? (
            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [styles.button, styles.primaryButton, pressed && styles.pressed]}
            >
              <Text style={styles.primaryText}>完成</Text>
            </Pressable>
          ) : (
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                onPress={onClose}
                style={({ pressed }) => [styles.button, styles.cancelButton, pressed && styles.pressed]}
              >
                <Text style={styles.cancelText}>取消</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={onRetry}
                style={({ pressed }) => [styles.button, styles.primaryButton, styles.retryButton, pressed && styles.pressed]}
              >
                <Text style={styles.primaryText}>重新选择</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(43, 38, 34, 0.42)',
    padding: 16,
  },
  sheet: { backgroundColor: theme.colors.card, borderRadius: 22, padding: 18, gap: 14 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconWrap: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  successIcon: { backgroundColor: '#E4F1EB' },
  errorIcon: { backgroundColor: '#F7E7E4' },
  title: { flex: 1, color: theme.colors.text, fontSize: theme.font.heading, fontWeight: '700' },
  message: { color: theme.colors.textDim, fontSize: theme.font.small, lineHeight: 20 },
  errorMessage: { color: theme.colors.red, fontSize: theme.font.small, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: 8 },
  button: { minHeight: theme.touchTarget, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cancelButton: { flex: 1, backgroundColor: theme.colors.bg },
  primaryButton: { backgroundColor: theme.colors.accent },
  retryButton: { flex: 1.65 },
  cancelText: { color: theme.colors.text, fontSize: theme.font.body, fontWeight: '600' },
  primaryText: { color: '#fff', fontSize: theme.font.body, fontWeight: '700' },
  pressed: { opacity: 0.72 },
});
