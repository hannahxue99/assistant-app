import type { AssistantOperation } from './action-types';

export type AssistantRole = 'user' | 'assistant';
export type AssistantMessageStatus = 'saved' | 'sending' | 'failed' | 'streaming';
export type AssistantMessageSource = 'text' | 'voice' | 'legacy' | 'contextual' | 'assistant';
export type AssistantRequestStatus = 'pending' | 'succeeded' | 'failed';
export type AssistantEngineStatus = 'configured' | 'unconfigured' | 'unknown';
export type AssistantInitialLoadStatus = 'loading' | 'ready' | 'error';
export type AssistantOlderLoadStatus = 'idle' | 'loading' | 'error';

export interface AssistantMessage {
  id: string;
  requestId: string;
  role: AssistantRole;
  content: string;
  source: AssistantMessageSource;
  status: AssistantMessageStatus;
  segmentId: string;
  createdAt: number;
  updatedAt: number;
  legacyEntryId: string | null;
  errorCode: string | null;
  operations?: AssistantOperation[];
}

export interface AssistantMessageCursor {
  id: string;
  createdAt: number;
}

export interface ConversationSegment {
  id: string;
  summary: string;
  status: 'current' | 'closed';
  startedAt: number;
  endedAt: number | null;
  updatedAt: number;
}

export interface AssistantSegmentDecision {
  action: 'continue' | 'split_before_user';
  /** 当前分段的滚动摘要；仅在确有新增事实时返回。 */
  summary?: string;
  /** 切换话题时，对用户本轮消息之前旧分段的最终摘要。 */
  previousSummary?: string;
}
