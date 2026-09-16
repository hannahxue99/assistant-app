import type { AssistantDateProposal } from './action-types';

export type AssistantEventDeltaChangeType =
  | 'fact'
  | 'decision'
  | 'result'
  | 'blocker'
  | 'plan'
  | 'correction';

export type AssistantEventDeltaTarget =
  | { action: 'update_existing'; eventId: string }
  | { action: 'create_new'; eventRef: string; title: string }
  | { action: 'none' }
  | { action: 'clarify' };

export type AssistantEventDeltaState =
  | { action: 'keep' }
  | {
    action: 'replace';
    changeType: AssistantEventDeltaChangeType;
    value: string;
  };

export interface AssistantEventDeltaProgress {
  type: AssistantEventDeltaChangeType;
  content: string;
}

export type AssistantEventDeltaTodoMutation =
  | ({ action: 'create'; todoRef: string; text: string } & AssistantDateProposal)
  | ({ action: 'update'; todoId: string; text?: string } & Partial<AssistantDateProposal>)
  | { action: 'complete'; todoId: string };

export interface AssistantEventDelta {
  key: string;
  target: AssistantEventDeltaTarget;
  evidence: string[];
  state: AssistantEventDeltaState;
  progress: AssistantEventDeltaProgress[];
  todos: AssistantEventDeltaTodoMutation[];
}
