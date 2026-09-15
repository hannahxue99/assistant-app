import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
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

import {
  assistantComposerMode,
  canSendAssistantComposer,
  joinAssistantComposerText,
} from '../assistant/composer-state';
import { theme } from '../theme';

interface AssistantComposerProps {
  onSend: (content: string, source: 'text' | 'voice') => Promise<void>;
  disabled?: boolean;
  processing?: boolean;
}

export function AssistantComposer({
  onSend,
  disabled = false,
  processing = false,
}: AssistantComposerProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [recognitionError, setRecognitionError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const baseTextRef = useRef('');
  const finalTextRef = useRef('');
  const recognitionActiveRef = useRef(false);
  const usedVoiceRef = useRef(false);

  useEffect(() => () => {
    if (recognitionActiveRef.current) ExpoSpeechRecognitionModule.abort();
    recognitionActiveRef.current = false;
  }, []);

  useEffect(() => {
    if (!disabled && !processing) return;
    if (recognitionActiveRef.current) ExpoSpeechRecognitionModule.abort();
    recognitionActiveRef.current = false;
    setListening(false);
  }, [disabled, processing]);

  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results?.[0]?.transcript?.trim();
    if (!transcript) return;
    if (event.isFinal) {
      finalTextRef.current = joinAssistantComposerText(finalTextRef.current, transcript);
    }
    const spoken = event.isFinal
      ? finalTextRef.current
      : joinAssistantComposerText(finalTextRef.current, transcript);
    setText(joinAssistantComposerText(baseTextRef.current, spoken));
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
    const unavailable = sending || disabled || processing;
    if (!canSendAssistantComposer({ text: content, listening, unavailable })) return;
    const source = usedVoiceRef.current ? 'voice' : 'text';
    setSending(true);
    setSubmitError(null);
    setText('');
    usedVoiceRef.current = false;
    baseTextRef.current = '';
    finalTextRef.current = '';
    Keyboard.dismiss();
    try {
      await onSend(content, source);
    } catch {
      setText(current => current.trim() ? current : content);
      usedVoiceRef.current = source === 'voice';
      setSubmitError('消息没有发出，内容已为你保留');
    } finally {
      setSending(false);
    }
  }

  async function startListening() {
    if (recognitionActiveRef.current || sending || disabled || processing) return;
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
      baseTextRef.current = text.trim();
      finalTextRef.current = '';
      usedVoiceRef.current = false;
      recognitionActiveRef.current = true;
      setListening(true);
      Keyboard.dismiss();
      ExpoSpeechRecognitionModule.start({ lang: 'zh-CN', interimResults: true, continuous: true });
    } catch {
      recognitionActiveRef.current = false;
      setListening(false);
      setRecognitionError('语音功能暂不可用');
    }
  }

  function stopListening() {
    if (!recognitionActiveRef.current) return;
    ExpoSpeechRecognitionModule.stop();
    recognitionActiveRef.current = false;
    setListening(false);
  }

  function toggleListening() {
    if (recognitionActiveRef.current || listening) {
      stopListening();
      return;
    }
    void startListening();
  }

  const unavailable = sending || disabled || processing;
  const awaitingReply = sending || processing;
  const mode = assistantComposerMode({ text, listening, unavailable });
  const canSend = canSendAssistantComposer({ text, listening, unavailable });

  return (
    <View style={styles.wrap}>
      <View
        style={[
          styles.composer,
          mode === 'listening' && styles.composerListening,
          mode === 'processing' && styles.composerDisabled,
        ]}
        accessibilityState={{ disabled: unavailable, busy: awaitingReply }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={listening ? '停止语音输入' : '开始语音输入'}
          accessibilityState={{ selected: listening, disabled: unavailable }}
          onPress={toggleListening}
          disabled={unavailable}
          style={({ pressed }) => [
            styles.iconButton,
            listening && styles.micActive,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons
            name={listening ? 'stop' : 'mic-outline'}
            size={listening ? 17 : 20}
            color={listening ? '#FFFFFF' : unavailable ? theme.colors.textDim : theme.colors.accent}
          />
        </Pressable>
        <TextInput
          value={text}
          onChangeText={(value) => {
            setText(value);
            if (submitError) setSubmitError(null);
          }}
          editable={!unavailable && !listening}
          placeholder={awaitingReply ? '小知回复后可继续输入' : '发消息给小知'}
          placeholderTextColor={theme.colors.textDim}
          selectionColor={theme.colors.accent}
          multiline
          maxLength={2000}
          style={styles.input}
          accessibilityLabel="给小知发送消息"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="发送消息"
          disabled={!canSend}
          onPress={() => { void submit(); }}
          style={({ pressed }) => [
            styles.sendButton,
            !canSend && styles.sendDisabled,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons
            name="arrow-up"
            size={20}
            color={!canSend ? theme.colors.textDim : '#FFFFFF'}
          />
        </Pressable>
      </View>
      {listening ? <Text style={styles.helper}>正在听，再点一下结束</Text> : null}
      {recognitionError ? <Text style={styles.error}>{recognitionError}</Text> : null}
      {submitError ? <Text style={styles.error}>{submitError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 26,
    backgroundColor: theme.colors.card,
    paddingHorizontal: 6,
    paddingVertical: 6,
    minHeight: 58,
    ...theme.shadow,
  },
  composerListening: {
    borderColor: theme.colors.accent,
    backgroundColor: '#FFFCFA',
  },
  composerDisabled: {
    borderColor: '#DED8D2',
    backgroundColor: '#ECE8E4',
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 124,
    paddingHorizontal: 8,
    paddingVertical: 10,
    color: theme.colors.text,
    fontSize: 16,
    lineHeight: 23,
  },
  iconButton: {
    width: theme.touchTarget,
    height: theme.touchTarget,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.accentSoft,
  },
  micActive: { backgroundColor: theme.colors.accent },
  sendButton: {
    width: theme.touchTarget,
    height: theme.touchTarget,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.accent,
  },
  sendDisabled: { backgroundColor: '#D8D2CC' },
  pressed: { opacity: 0.72 },
  helper: { color: theme.colors.accent, fontSize: theme.font.small, paddingHorizontal: 10 },
  error: { color: theme.colors.red, fontSize: theme.font.small, paddingHorizontal: 4 },
});
