import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  assistantWebSourceHost,
  assistantWebSourcesLabel,
  safeAssistantWebSourceUrl,
} from '../assistant/web-source-ui';
import type { AssistantWebSource } from '../assistant/types';
import { theme } from '../theme';

export function AssistantWebSources({ sources }: { sources: AssistantWebSource[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!sources.length) return null;

  async function openSource(source: AssistantWebSource) {
    const url = safeAssistantWebSourceUrl(source.url);
    if (!url) {
      Alert.alert('无法打开来源', '这个网页地址无效。');
      return;
    }
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      Alert.alert('暂时无法打开', '请稍后再试。');
    }
  }

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={expanded ? '收起搜索来源' : '展开搜索来源'}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(value => !value)}
        style={({ pressed }) => [styles.header, pressed && styles.pressed]}
      >
        <Ionicons name="globe-outline" size={15} color={theme.colors.textDim} />
        <Text style={styles.headerText}>{assistantWebSourcesLabel(sources.length)}</Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-forward'} size={15} color={theme.colors.textDim} />
      </Pressable>
      {expanded ? (
        <View style={styles.list} accessibilityLabel="搜索来源列表">
          {sources.map((source, index) => (
            <Pressable
              key={`${source.url}:${index}`}
              accessibilityRole="link"
              accessibilityLabel={`打开来源：${source.title}`}
              onPress={() => { void openSource(source); }}
              style={({ pressed }) => [styles.sourceRow, index > 0 && styles.divider, pressed && styles.pressed]}
            >
              <View style={styles.sourceCopy}>
                <Text numberOfLines={2} style={styles.sourceTitle}>{source.title}</Text>
                <Text numberOfLines={1} style={styles.sourceHost}>{assistantWebSourceHost(source)}</Text>
              </View>
              <Ionicons name="open-outline" size={15} color={theme.colors.textDim} />
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '86%', marginTop: 5 },
  header: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 11,
    borderRadius: 12,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  headerText: { flex: 1, color: theme.colors.textDim, fontSize: 12, fontWeight: '600' },
  list: {
    marginTop: 4,
    borderRadius: 12,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
  },
  sourceRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 11, paddingVertical: 8 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border },
  sourceCopy: { flex: 1, gap: 2 },
  sourceTitle: { color: theme.colors.text, fontSize: 13, lineHeight: 18 },
  sourceHost: { color: theme.colors.textDim, fontSize: 11 },
  pressed: { opacity: 0.62 },
});
