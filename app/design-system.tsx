import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EditAction } from '../src/components/EditAction';
import { TopicPinIcon } from '../src/components/TopicPinIcon';
import { theme } from '../src/theme';

const colors = [
  ['背景', theme.colors.bg],
  ['卡片', theme.colors.card],
  ['正文', theme.colors.text],
  ['强调', theme.colors.accent],
  ['置顶', theme.colors.gold],
] as const;

export default function DesignSystemScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          style={styles.headerAction}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="返回"
        >
          <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
        </Pressable>
        <Text style={styles.title}>组件预览</Text>
        <View style={styles.headerAction} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Section title="核心颜色">
          <View style={styles.swatchRow}>
            {colors.map(([label, color]) => (
              <View key={label} style={styles.swatchItem}>
                <View style={[styles.swatch, { backgroundColor: color }]} />
                <Text style={styles.caption}>{label}</Text>
              </View>
            ))}
          </View>
        </Section>

        <Section title="文字层级">
          <TypeRow label="页面标题" sampleStyle={styles.typeTitle} meta="22 / Bold" />
          <TypeRow label="模块标题" sampleStyle={styles.typeHeading} meta="17 / Bold" />
          <TypeRow label="正文内容" sampleStyle={styles.typeBody} meta="15 / Regular" />
          <TypeRow label="辅助信息" sampleStyle={styles.typeSmall} meta="13 / Regular" />
        </Section>

        <Section title="编辑入口">
          <View style={styles.actionRow}>
            <View style={styles.actionDemo}><Text style={styles.caption}>浏览态</Text><EditAction editing={false} onPress={() => {}} /></View>
            <View style={styles.actionDemo}><Text style={styles.caption}>编辑态</Text><EditAction editing onPress={() => {}} /></View>
          </View>
        </Section>

        <Section title="聚合卡片">
          <TopicPreview pinned={false} topic="家庭采购" count={3} summary="明天购买 3 斤葡萄" />
          <TopicPreview pinned topic="生理周期记录" count={2} summary="8 月 26 日生理周期记录" />
          <Text style={styles.note}>唯一方向：钉帽右上、钉尖左下；可见 19×19，触控区 44×44。</Text>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text>{children}</View>;
}

function TypeRow({ label, sampleStyle, meta }: { label: string; sampleStyle: object; meta: string }) {
  return <View style={styles.typeRow}><Text style={sampleStyle}>{label}</Text><Text style={styles.caption}>{meta}</Text></View>;
}

function TopicPreview({ pinned, topic, count, summary }: { pinned: boolean; topic: string; count: number; summary: string }) {
  return (
    <View style={[styles.topicCard, pinned && styles.topicCardPinned]}>
      <View style={styles.topicHead}><Text style={styles.topicName}>#{topic}</Text><Text style={styles.caption}>{count} 条</Text></View>
      <View style={styles.pinHit}><TopicPinIcon pinned={pinned} /></View>
      <Text style={styles.typeBody}>{summary}</Text>
      <Text style={styles.caption}>最新 今天 10:30</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 },
  headerAction: { width: theme.touchTarget, height: theme.touchTarget, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: theme.font.heading, fontWeight: theme.fontWeight.bold, color: theme.colors.text },
  content: { padding: theme.spacing.md, paddingBottom: theme.spacing.xl, gap: theme.spacing.sm },
  section: { padding: 14, gap: theme.spacing.xs, borderRadius: theme.radius.input, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.card },
  sectionTitle: { fontSize: theme.font.heading, fontWeight: theme.fontWeight.bold, color: theme.colors.text, marginBottom: 2 },
  swatchRow: { flexDirection: 'row', gap: theme.spacing.xs },
  swatchItem: { flex: 1, gap: 4 },
  swatch: { height: 42, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border },
  caption: { fontSize: 11, color: theme.colors.textDim },
  typeRow: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
  typeTitle: { fontSize: theme.font.title, fontWeight: theme.fontWeight.bold, color: theme.colors.text },
  typeHeading: { fontSize: theme.font.heading, fontWeight: theme.fontWeight.bold, color: theme.colors.text },
  typeBody: { fontSize: theme.font.body, color: theme.colors.text },
  typeSmall: { fontSize: theme.font.small, color: theme.colors.textDim },
  actionRow: { flexDirection: 'row', gap: theme.spacing.lg },
  actionDemo: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs },
  topicCard: { position: 'relative', padding: theme.spacing.sm, gap: 4, borderRadius: theme.radius.input, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.card },
  topicCardPinned: { borderColor: theme.colors.gold, backgroundColor: theme.colors.goldSoft },
  topicHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 32 },
  topicName: { fontSize: theme.font.body, fontWeight: theme.fontWeight.bold, color: theme.colors.gold },
  pinHit: { position: 'absolute', right: 0, top: 0, width: theme.touchTarget, height: theme.touchTarget, alignItems: 'center', justifyContent: 'center' },
  note: { fontSize: 11, color: theme.colors.textDim, lineHeight: 16 },
});

