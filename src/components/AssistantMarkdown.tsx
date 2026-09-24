import { useMemo, type ReactNode } from 'react';
import { Keyboard, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import {
  ASSISTANT_MARKDOWN_CURSOR,
  parseAssistantMarkdown,
  safeAssistantMarkdownLink,
} from '../assistant/markdown';
import { theme } from '../theme';

interface AssistantMarkdownProps {
  content: string;
  streaming?: boolean;
}

interface MarkdownNode {
  type: string;
  value?: string;
  depth?: number;
  ordered?: boolean | null;
  start?: number | null;
  url?: string;
  alt?: string | null;
  lang?: string | null;
  children?: MarkdownNode[];
}

function textWithCursor(value: string, key: string): ReactNode {
  if (!value.includes(ASSISTANT_MARKDOWN_CURSOR)) return value;
  return value.split(ASSISTANT_MARKDOWN_CURSOR).map((part, index, all) => (
    index < all.length - 1 ? (
      <Text key={`${key}-cursor-${index}`}>
        {part}<Text style={styles.cursor}>▋</Text>
      </Text>
    ) : part
  ));
}

async function openSafeLink(value: string) {
  const safeUrl = safeAssistantMarkdownLink(value);
  if (!safeUrl) return;
  Keyboard.dismiss();
  try {
    await WebBrowser.openBrowserAsync(safeUrl);
  } catch {
    // The reply remains readable when the system browser cannot be opened.
  }
}

function renderInline(node: MarkdownNode, key: string): ReactNode {
  const children = node.children?.map((child, index) => renderInline(child, `${key}-${index}`)) ?? [];
  switch (node.type) {
    case 'text':
      return textWithCursor(node.value ?? '', key);
    case 'strong':
      return <Text key={key} style={styles.strong}>{children}</Text>;
    case 'emphasis':
      return <Text key={key} style={styles.emphasis}>{children}</Text>;
    case 'inlineCode':
      return <Text key={key} style={styles.inlineCode}>{textWithCursor(node.value ?? '', key)}</Text>;
    case 'break':
      return '\n';
    case 'link': {
      const safeUrl = safeAssistantMarkdownLink(node.url ?? '');
      if (!safeUrl) return <Text key={key}>{children}</Text>;
      return (
        <Text
          key={key}
          accessibilityRole="link"
          style={styles.link}
          onPress={() => { void openSafeLink(safeUrl); }}
        >
          {children}
        </Text>
      );
    }
    case 'image':
      return node.alt ? <Text key={key} style={styles.imageAlt}>[图片：{node.alt}]</Text> : null;
    case 'html':
      return null;
    default:
      return children;
  }
}

function renderParagraph(node: MarkdownNode, key: string, listItem = false) {
  return (
    <Text key={key} selectable style={[styles.body, listItem && styles.listParagraph]}>
      {node.children?.map((child, index) => renderInline(child, `${key}-${index}`))}
    </Text>
  );
}

function renderList(node: MarkdownNode, key: string): ReactNode {
  const start = node.start ?? 1;
  return (
    <View key={key} style={styles.list}>
      {(node.children ?? []).map((item, itemIndex) => (
        <View key={`${key}-item-${itemIndex}`} style={styles.listItem}>
          <Text
            style={[styles.listMarker, node.ordered && styles.orderedMarker]}
            accessibilityElementsHidden
          >
            {node.ordered ? `${start + itemIndex}.` : '•'}
          </Text>
          <View style={styles.listItemBody}>
            {(item.children ?? []).map((child, childIndex) => (
              child.type === 'paragraph'
                ? renderParagraph(child, `${key}-item-${itemIndex}-${childIndex}`, true)
                : renderBlock(child, `${key}-item-${itemIndex}-${childIndex}`)
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function renderBlock(node: MarkdownNode, key: string): ReactNode {
  switch (node.type) {
    case 'paragraph':
      return renderParagraph(node, key);
    case 'heading': {
      const headingStyle = node.depth === 1
        ? styles.heading1
        : node.depth === 2
          ? styles.heading2
          : styles.heading3;
      return (
        <Text key={key} selectable style={[styles.body, headingStyle]}>
          {node.children?.map((child, index) => renderInline(child, `${key}-${index}`))}
        </Text>
      );
    }
    case 'list':
      return renderList(node, key);
    case 'blockquote':
      return (
        <View key={key} style={styles.blockquote}>
          {node.children?.map((child, index) => renderBlock(child, `${key}-${index}`))}
        </View>
      );
    case 'code':
      return (
        <ScrollView
          key={key}
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
          style={styles.codeScroll}
          contentContainerStyle={styles.codeContent}
        >
          <Text selectable style={styles.codeText}>{textWithCursor(node.value ?? '', key)}</Text>
        </ScrollView>
      );
    case 'thematicBreak':
      return <View key={key} style={styles.divider} />;
    case 'html':
    case 'definition':
      return null;
    default:
      return node.children?.map((child, index) => renderBlock(child, `${key}-${index}`)) ?? null;
  }
}

export function AssistantMarkdown({ content, streaming = false }: AssistantMarkdownProps) {
  const root = useMemo(() => {
    try {
      return parseAssistantMarkdown(content, streaming) as unknown as MarkdownNode;
    } catch {
      return null;
    }
  }, [content, streaming]);
  if (!root) {
    return <Text selectable style={styles.body}>{content}</Text>;
  }
  return (
    <View style={styles.root}>
      {root.children?.map((node, index) => renderBlock(node, `block-${index}`))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: '100%', gap: 8 },
  body: { color: theme.colors.text, fontSize: 16, lineHeight: 23 },
  strong: { fontWeight: theme.fontWeight.semibold },
  emphasis: { fontStyle: 'italic' },
  heading1: { fontSize: 18, lineHeight: 25, fontWeight: theme.fontWeight.bold, marginTop: 1 },
  heading2: { fontSize: 17, lineHeight: 24, fontWeight: theme.fontWeight.semibold, marginTop: 1 },
  heading3: { fontSize: 16, lineHeight: 23, fontWeight: theme.fontWeight.semibold },
  list: { width: '100%', gap: 6 },
  listItem: { width: '100%', flexDirection: 'row', alignItems: 'flex-start' },
  listMarker: { width: 18, color: theme.colors.text, fontSize: 16, lineHeight: 23 },
  orderedMarker: { width: 28, paddingRight: 5, textAlign: 'right' },
  listItemBody: { flex: 1, minWidth: 0, gap: 5 },
  listParagraph: { flexShrink: 1 },
  blockquote: { width: '100%', gap: 6, paddingLeft: 11, paddingVertical: 2, borderLeftWidth: 3, borderLeftColor: theme.colors.border },
  inlineCode: { fontFamily: 'Menlo', fontSize: 13, color: theme.colors.text, backgroundColor: '#F4F1ED' },
  codeScroll: { width: '100%', borderRadius: 10, backgroundColor: '#F4F1ED' },
  codeContent: { paddingHorizontal: 11, paddingVertical: 9 },
  codeText: { color: theme.colors.text, fontFamily: 'Menlo', fontSize: 12, lineHeight: 18 },
  link: { color: theme.colors.accent, textDecorationLine: 'underline' },
  imageAlt: { color: theme.colors.textDim, fontStyle: 'italic' },
  divider: { height: StyleSheet.hairlineWidth, width: '100%', backgroundColor: theme.colors.border, marginVertical: 2 },
  cursor: { color: theme.colors.accent },
});
