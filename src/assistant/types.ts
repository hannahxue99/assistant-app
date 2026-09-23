import type { AssistantOperation } from './action-types';
import type { AssistantRuntimeStage, AssistantStageDurations } from './runtime-state';

/** 流式期间的阶段片段；endedAt 为空表示当前阶段仍在进行。 */
export interface AssistantStageSegment {
  stage: AssistantRuntimeStage;
  startedAt: number;
  endedAt: number | null;
}

export type AssistantRole = 'user' | 'assistant';
export type AssistantMessageStatus = 'saved' | 'sending' | 'failed' | 'streaming';
export type AssistantMessageSource = 'text' | 'voice' | 'legacy' | 'contextual' | 'assistant';
export type AssistantRequestStatus = 'pending' | 'succeeded' | 'failed';
export type AssistantEngineStatus = 'configured' | 'unconfigured' | 'unknown';
export type AssistantInitialLoadStatus = 'loading' | 'ready' | 'error';
export type AssistantOlderLoadStatus = 'idle' | 'loading' | 'error';

export interface AssistantWebSource {
  title: string;
  url: string;
  position: number;
}

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
  /** 仅用于当前进程内的流式展示，不写入数据库。 */
  runtimeStage?: AssistantRuntimeStage;
  /** 流式期间逐行累加的阶段片段；落库后由 stageDurations 取代。 */
  stageSegments?: AssistantStageSegment[];
  /** 落定后的各阶段实际耗时，来自决策时间线并持久化。 */
  stageDurations?: AssistantStageDurations;
  /** 本轮用户发送时间，用于秒级运行计时。 */
  runtimeStartedAt?: number;
  /** 是否存在可按需展开的 DeepSeek 思考过程。 */
  reasoningAvailable?: boolean;
  /** 流式阶段临时携带，落库后列表只读取元数据。 */
  reasoningContent?: string;
  reasoningStartedAt?: number;
  reasoningCompletedAt?: number;
  /** 本轮 DeepSeek 服务端搜索返回的来源元数据，不含网页正文。 */
  webSources?: AssistantWebSource[];
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
