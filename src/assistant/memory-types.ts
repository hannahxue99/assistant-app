export type AssistantMemoryCategory =
  | 'preference'
  | 'principle'
  | 'long_term_goal'
  | 'important_relationship'
  | 'recurring_pattern';

export type AssistantMemoryStatus = 'candidate' | 'active' | 'superseded' | 'forgotten';
export type AssistantMemorySensitivity = 'ordinary' | 'sensitive';
export type AssistantMemoryAdmissionBasis =
  | 'explicit'
  | 'repeated'
  | 'confirmed'
  | 'inferred'
  | 'manual_edit'
  | 'profile_migration';

export interface AssistantMemory {
  id: string;
  category: AssistantMemoryCategory;
  content: string;
  normalizedContent: string;
  status: AssistantMemoryStatus;
  sensitivity: AssistantMemorySensitivity;
  admissionBasis: AssistantMemoryAdmissionBasis;
  supersededById: string | null;
  revision: number;
  createdAt: number;
  updatedAt: number;
  activatedAt: number | null;
  supersededAt: number | null;
  forgottenAt: number | null;
}

export interface AssistantMemorySource {
  id: string;
  memoryId: string;
  sourceMessageId: string | null;
  evidence: string;
  createdAt: number;
}

export type AssistantMemoryDeltaProposal =
  | {
    key: string;
    action: 'create_candidate' | 'create_active';
    category: AssistantMemoryCategory;
    content: string;
    sensitivity: AssistantMemorySensitivity;
    admissionBasis: 'inferred' | 'explicit';
    evidence: string;
  }
  | {
    key: string;
    action: 'activate_candidate';
    memoryId: string;
    expectedRevision: number;
    admissionBasis: 'repeated' | 'confirmed';
    evidence: string;
  }
  | {
    key: string;
    action: 'supersede_memory';
    memoryId: string;
    expectedRevision: number;
    category: AssistantMemoryCategory;
    content: string;
    sensitivity: AssistantMemorySensitivity;
    evidence: string;
  }
  | {
    key: string;
    action: 'forget_memory';
    memoryId: string;
    expectedRevision: number;
    evidence: string;
  };

export type ValidatedAssistantMemoryDelta = AssistantMemoryDeltaProposal;

export interface AssistantMemoryContext {
  active: AssistantMemory[];
  candidates: AssistantMemory[];
}

export interface AssistantMemoryRejection {
  key: string;
  action: AssistantMemoryDeltaProposal['action'];
  reason:
    | 'evidence_not_in_user_message'
    | 'candidate_not_allowed'
    | 'revision_conflict'
    | 'duplicate_content'
    | 'sensitive_requires_confirmation'
    | 'insufficient_distinct_sources'
    | 'forbidden_secret'
    | 'forgotten_requires_explicit_request';
}

export const ASSISTANT_MEMORY_CATEGORY_LABELS: Record<AssistantMemoryCategory, string> = {
  preference: '偏好',
  principle: '做事原则',
  long_term_goal: '长期目标',
  important_relationship: '重要关系',
  recurring_pattern: '反复模式',
};
