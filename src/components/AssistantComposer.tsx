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
import { smoothVoiceLevel, voiceLevelBarHeights } from '../assistant/voice-level';
import { theme } from '../theme';

interface AssistantComposerProps {
  onSend: (content: string, source: 'text' | 'voice') => Promise<void>;
  disabled?: boolean;
  processing?: boolean;
}

function VoiceLevelBars({ level }: { level: number }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.voiceBars}>
      {voiceLevelBarHeights(level).map((height, index) => (
        <View key={index} style={[styles.voiceBar, { height }]} />
      ))}
    </View>
  );
}

export function AssistantComposer({
  onSend,
  disabled = false,
  processing = false,
}: AssistantComposerProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceLevel, setVoiceLevel] = useState(0);
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
    setVoiceLevel(0);
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
    setVoiceLevel(0);
  });

  useSpeechRecognitionEvent('error', (event) => {
    recognitionActiveRef.current = false;
    setListening(false);
    setVoiceLevel(0);
    setRecognitionError(`语音识别暂不可用：${event.error ?? '未知错误'}`);
  });

  useSpeechRecognitionEvent('volumechange', (event) => {
    if (!recognitionActiveRef.current) return;
    setVoiceLevel(current => smoothVoiceLevel(current, event.value));
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
      setVoiceLevel(0);
      Keyboard.dismiss();
      ExpoSpeechRecognitionModule.start({
        lang: 'zh-CN',
        interimResults: true,
        continuous: true,
        volumeChangeEventOptions: { enabled: true, intervalMillis: 100 },
      });
    } catch {
      recognitionActiveRef.current = false;
      setListening(false);
      setVoiceLevel(0);
      setRecognitionError('语音功能暂不可用');
    }
  }

  function stopListening() {
    if (!recognitionActiveRef.current) return;
    ExpoSpeechRecognitionModule.stop();
    recognitionActiveRef.current = false;
    setListening(false);
    setVoiceLevel(0);
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
          hitSlop={4}
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
        {listening ? <VoiceLevelBars level={voiceLevel} /> : null}
        <TextInput
          value={text}
          onChangeText={(value) => {
            setText(value);
            if (submitError) setSubmitError(null);
          }}
          editable={!unavailable && !listening}
          placeholder={listening ? '' : awaitingReply ? '小知回复后可继续输入' : '发消息给小知'}
          placeholderTextColor={theme.colors.textDim}
          selectionColor={theme.colors.accent}
          multiline
          maxLength={2000}
          style={styles.input}
          accessibilityLabel="给小知发送消息"
        />
        {listening ? <Text style={styles.listeningLabel}>正在听</Text> : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="发送消息"
            disabled={!canSend}
            onPress={() => { void submit(); }}
            hitSlop={4}
            style={({ pressed }) => [
              styles.sendButton,
              !canSend && styles.sendDisabled,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons
              name="arrow-up"
              size={19}
              color={!canSend ? theme.colors.textDim : '#FFFFFF'}
            />
          </Pressable>
        )}
      </View>
      {recognitionError ? <Text style={styles.error}>{recognitionError}</Text> : null}
      {submitError ? <Text style={styles.error}>{submitError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 4 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 25,
    backgroundColor: theme.colors.card,
    paddingHorizontal: 5,
    paddingVertical: 4,
    minHeight: 50,
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
    minHeight: 40,
    maxHeight: 116,
    paddingHorizontal: 7,
    paddingVertical: 8,
    color: theme.colors.text,
    fontSize: 16,
    lineHeight: 23,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.accentSoft,
  },
  micActive: { backgroundColor: theme.colors.accent },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.accent,
  },
  sendDisabled: { backgroundColor: '#D8D2CC' },
  voiceBars: { width: 32, height: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, alignSelf: 'center' },
  voiceBar: { width: 3, minHeight: 4, borderRadius: 2, backgroundColor: theme.colors.accent },
  listeningLabel: { color: theme.colors.textDim, fontSize: 12, alignSelf: 'center', marginRight: 8 },
  pressed: { opacity: 0.72 },
  error: { color: theme.colors.red, fontSize: theme.font.small, paddingHorizontal: 4 },
});
