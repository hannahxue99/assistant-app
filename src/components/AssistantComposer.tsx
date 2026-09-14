import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';

import { theme } from '../theme';

interface AssistantComposerProps {
  onSend: (content: string, source: 'text' | 'voice') => Promise<void>;
  disabled?: boolean;
}

export function AssistantComposer({ onSend, disabled = false }: AssistantComposerProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [recognitionError, setRecognitionError] = useState<string | null>(null);
  const baseTextRef = useRef('');
  const finalTextRef = useRef('');
  const pressingRef = useRef(false);
  const recognitionActiveRef = useRef(false);
  const usedVoiceRef = useRef(false);

  useEffect(() => () => {
    pressingRef.current = false;
    if (recognitionActiveRef.current) ExpoSpeechRecognitionModule.abort();
    recognitionActiveRef.current = false;
  }, []);

  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results?.[0]?.transcript?.trim();
    if (!transcript) return;
    if (event.isFinal) finalTextRef.current = joinText(finalTextRef.current, transcript);
    const spoken = event.isFinal
      ? finalTextRef.current
      : joinText(finalTextRef.current, transcript);
    setText(joinText(baseTextRef.current, spoken));
    usedVoiceRef.current = true;
  });

  useSpeechRecognitionEvent('end', () => {
    recognitionActiveRef.current = false;
    setListening(false);
  });

  useSpeechRecognitionEvent('error', (event) => {
    recognitionActiveRef.current = false;
    setListening(false);
    setRecognitionError(`语音识别暂不可用：${event.error ?? '未知错误'}`);
  });

  async function submit() {
    const content = text.trim();
    if (!content || sending || disabled) return;
    setSending(true);
    try {
      await onSend(content, usedVoiceRef.current ? 'voice' : 'text');
      setText('');
      usedVoiceRef.current = false;
      baseTextRef.current = '';
      finalTextRef.current = '';
    } finally {
      setSending(false);
    }
  }

  async function startListening() {
    if (listening || sending || disabled) return;
    try {
      setRecognitionError(null);
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
        setRecognitionError('当前设备不支持语音识别');
        return;
      }
      let permission = await ExpoSpeechRecognitionModule.getPermissionsAsync();
      if (!permission.granted) permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        setRecognitionError('需要麦克风权限：设置 → 私人助手 → 打开麦克风');
        return;
      }
      if (!pressingRef.current) return;
      baseTextRef.current = text.trim();
      finalTextRef.current = '';
      usedVoiceRef.current = false;
      recognitionActiveRef.current = true;
      setListening(true);
      ExpoSpeechRecognitionModule.start({ lang: 'zh-CN', interimResults: true, continuous: true });
    } catch {
      recognitionActiveRef.current = false;
      setListening(false);
      setRecognitionError('语音功能暂不可用');
    }
  }

  function stopListening() {
    pressingRef.current = false;
    if (!recognitionActiveRef.current) return;
    ExpoSpeechRecognitionModule.stop();
    recognitionActiveRef.current = false;
    setListening(false);
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.composer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={listening ? '松开结束语音输入' : '按住说话'}
          onPressIn={() => {
            pressingRef.current = true;
            void startListening();
          }}
          onPressOut={stopListening}
          disabled={sending || disabled}
          style={({ pressed }) => [
            styles.iconButton,
            listening && styles.micActive,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons
            name={listening ? 'mic' : 'mic-outline'}
            size={20}
            color={listening ? '#FFFFFF' : theme.colors.accent}
          />
        </Pressable>
        <TextInput
          value={text}
          onChangeText={setText}
          editable={!sending && !disabled}
          placeholder="告诉小知你在想什么…"
          placeholderTextColor={theme.colors.textDim}
          selectionColor={theme.colors.accent}
          multiline
          maxLength={2000}
          style={styles.input}
          accessibilityLabel="给小知发送消息"
        />
        {sending ? (
          <View style={styles.iconButton} accessibilityLabel="正在发送">
            <ActivityIndicator color={theme.colors.accent} />
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="发送消息"
            disabled={!text.trim() || disabled}
            onPress={() => { void submit(); }}
            style={({ pressed }) => [
              styles.sendButton,
              (!text.trim() || disabled) && styles.sendDisabled,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="arrow-up" size={20} color="#FFFFFF" />
          </Pressable>
        )}
      </View>
      {listening ? <Text style={styles.helper}>正在听，松开结束</Text> : null}
      {recognitionError ? <Text style={styles.error}>{recognitionError}</Text> : null}
    </View>
  );
}

function joinText(left: string, right: string): string {
  const first = left.trim();
  const second = right.trim();
  if (!first) return second;
  if (!second) return first;
  return `${first} ${second}`;
}

const styles = StyleSheet.create({
  wrap: { gap: 5 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 16,
    backgroundColor: theme.colors.card,
    padding: 5,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    paddingHorizontal: 6,
    paddingVertical: 9,
    color: theme.colors.text,
    fontSize: 16,
    lineHeight: 22,
  },
  iconButton: {
    width: theme.touchTarget,
    height: theme.touchTarget,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micActive: { backgroundColor: theme.colors.accent },
  sendButton: {
    width: theme.touchTarget,
    height: theme.touchTarget,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.accent,
  },
  sendDisabled: { opacity: 0.3 },
  pressed: { opacity: 0.72 },
  helper: { color: theme.colors.accent, fontSize: theme.font.small, paddingHorizontal: 4 },
  error: { color: theme.colors.red, fontSize: theme.font.small, paddingHorizontal: 4 },
});
