export type AssistantComposerMode = 'idle' | 'input' | 'listening' | 'processing';

interface AssistantComposerState {
  text: string;
  listening: boolean;
  unavailable: boolean;
}

export function joinAssistantComposerText(left: string, right: string): string {
  const first = left.trim();
  const second = right.trim();
  if (!first) return second;
  if (!second) return first;
  return `${first} ${second}`;
}

export function assistantComposerMode(state: AssistantComposerState): AssistantComposerMode {
  if (state.unavailable) return 'processing';
  if (state.listening) return 'listening';
  return state.text.trim() ? 'input' : 'idle';
}

export function canSendAssistantComposer(state: AssistantComposerState): boolean {
  return Boolean(state.text.trim()) && !state.listening && !state.unavailable;
}
