/**
 * 快速记录组件 — 零摩擦捕捉
 * 文字输入 + 按住说话语音输入（系统 STT，实时转写进输入框）
 *
 * v1.1 修复：
 * - 权限在组件挂载时预请求，避免按压手势被系统弹窗打断（首次"失效"的主因）
 * - 转写文本拼接在已有文字之后，不再覆盖手动输入
 * - 保存时正确标记来源（voice / text）
 */
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';

import { theme } from '../theme';

interface Props {
  onSave: (rawText: string, source: 'text' | 'voice') => Promise<void>;
  placeholder?: string;
}

export function Composer({ onSave, placeholder = '记点/改点什么…' }: Props) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [listening, setListening] = useState(false);
  const [recognitionErr, setRecognitionErr] = useState<string | null>(null);
  /** 开始录音时输入框里已有的文字（转写拼在它后面） */
  const baseTextRef = useRef('');
  /** 连续识别中已经确认的分段，临时结果只追加展示、不覆盖已确认内容 */
  const finalTextRef = useRef('');
  /** 手指是否仍按在麦克风上，防止权限请求结束后误启动录音 */
  const pressingRef = useRef(false);
  /** 避免 React 状态异步导致松手时漏掉 stop */
  const recognitionActiveRef = useRef(false);
  /** 本条记录是否动用过语音（决定保存时的 source 标记） */
  const usedVoiceRef = useRef(false);

  // 进入页面即预请求麦克风/语音识别权限，避免按住瞬间被系统弹窗打断
  useEffect(() => {
    (async () => {
      try {
        const perm = await ExpoSpeechRecognitionModule.getPermissionsAsync();
        if (!perm.granted) {
          await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        }
      } catch {
        // 静默：权限失败不影响文字输入，按住时再提示
      }
    })();
    return () => {
      pressingRef.current = false;
      if (recognitionActiveRef.current) {
        ExpoSpeechRecognitionModule.abort();
        recognitionActiveRef.current = false;
      }
    };
  }, []);

  // 实时转写：已有输入 + 已确认分段 + 当前临时分段
  useSpeechRecognitionEvent('result', (event) => {
    // results 是多个候选结果，不是连续语句；取置信度最高的第一个候选。
    const transcript = event.results?.[0]?.transcript?.trim();
    if (transcript) {
      if (event.isFinal) {
        finalTextRef.current = joinText(finalTextRef.current, transcript);
      }
      const base = baseTextRef.current;
      const spoken = event.isFinal
        ? finalTextRef.current
        : joinText(finalTextRef.current, transcript);
      setText(joinText(base, spoken));
      usedVoiceRef.current = true;
    }
  });

  useSpeechRecognitionEvent('end', () => {
    recognitionActiveRef.current = false;
    setListening(false);
  });

  useSpeechRecognitionEvent('error', (event) => {
    recognitionActiveRef.current = false;
    setListening(false);
    setRecognitionErr(`识别出错：${event.error ?? '未知'}`);
  });

  async function handleSubmit() {
    const v = text.trim();
    if (!v) return;
    setSaving(true);
    try {
      await onSave(v, usedVoiceRef.current ? 'voice' : 'text');
      setText('');
      usedVoiceRef.current = false;
      baseTextRef.current = '';
      finalTextRef.current = '';
    } finally {
      setSaving(false);
    }
  }

  async function startListening() {
    if (listening) return;
    try {
      setRecognitionErr(null);
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
        setRecognitionErr('当前设备不支持语音识别');
        return;
      }
      // 已授权直接用；未授权当场请求（首次进入页面时已预请求过，这里通常是秒过）
      let perm = await ExpoSpeechRecognitionModule.getPermissionsAsync();
      if (!perm.granted) {
        perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      }
      if (!perm.granted) {
        setRecognitionErr('需要麦克风权限：设置 → 私人助手 → 打开麦克风');
        return;
      }
      // 用户已松手时不再启动，避免权限弹窗造成“松手后反而开始录音”。
      if (!pressingRef.current) return;
      baseTextRef.current = text.trim();
      finalTextRef.current = '';
      usedVoiceRef.current = false;
      recognitionActiveRef.current = true;
      setListening(true);
      ExpoSpeechRecognitionModule.start({
        lang: 'zh-CN',
        interimResults: true,
        continuous: true,
      });
    } catch {
      recognitionActiveRef.current = false;
      setListening(false);
      setRecognitionErr('语音功能暂不可用');
    }
  }

  function handlePressIn() {
    pressingRef.current = true;
    void startListening();
  }

  function stopListening() {
    pressingRef.current = false;
    if (recognitionActiveRef.current) {
      ExpoSpeechRecognitionModule.stop();
      recognitionActiveRef.current = false;
      setListening(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.textDim}
          multiline
          maxLength={500}
        />
        <Pressable
          onPressIn={handlePressIn}
          onPressOut={stopListening}
          disabled={saving}
          style={[styles.iconBtn, styles.mic, listening && styles.micActive, saving && styles.disabled]}
        >
          <Ionicons name={listening ? 'mic' : 'mic-outline'} size={20} color={listening ? '#fff' : theme.colors.accent} />
        </Pressable>
        {saving ? (
          <ActivityIndicator color={theme.colors.accent} style={styles.iconBtn} />
        ) : text.trim() && !listening ? (
          <Pressable onPress={handleSubmit} style={styles.send}>
            <Ionicons name="arrow-up" size={20} color="#fff" />
          </Pressable>
        ) : null}
      </View>
      {listening && <Text style={styles.listening}>正在听，松开结束</Text>}
      {recognitionErr && <Text style={styles.err}>{recognitionErr}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.input,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: theme.font.body,
    color: theme.colors.text,
    borderWidth: 1,
    borderColor: theme.colors.textDim,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mic: { backgroundColor: theme.colors.accentSoft },
  micActive: { backgroundColor: theme.colors.accent },
  disabled: { opacity: 0.45 },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listening: { fontSize: theme.font.small, color: theme.colors.accent },
  err: { color: theme.colors.red, fontSize: theme.font.small, flexShrink: 1 },
});

function joinText(left: string, right: string): string {
  const a = left.trim();
  const b = right.trim();
  if (!a) return b;
  if (!b) return a;
  return `${a} ${b}`;
}
