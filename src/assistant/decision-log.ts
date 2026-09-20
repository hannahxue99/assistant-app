import { withDatabaseConnection } from '../db';
import type { AssistantOperation, AssistantOperationProposal } from './action-types';
import type { AssistantEventDelta } from './event-delta-types';
import type { AssistantMemoryDeltaProposal } from './memory-types';
import type { AssistantProviderAttempt, AssistantProviderMetadata } from './provider';
import type { AssistantProtocolWarning } from './protocol';
import type { AssistantExecutionResult } from './execution-result';

export interface AssistantDecisionContextRefs {
  recentMessageIds: string[];
  segmentIds: string[];
  entryIds: string[];
  eventCandidateIds: string[];
  todoCandidateIds: string[];
  memoryIds: string[];
  launchContextId: string | null;
}

export interface AssistantDecisionLog {
  requestId: string;
  status: 'started' | 'model_received' | 'validated' | 'committed' | 'failed';
  proposedOperations: AssistantOperationProposal[];
  proposedEventDeltas: AssistantEventDelta[];
  proposedMemoryDeltas: AssistantMemoryDeltaProposal[];
  validation: unknown;
  committedOperationIds: string[];
  errorCode: string | null;
  errorDetail: string | null;
  providerAttemptCount: number;
  providerAttempts: AssistantProviderAttempt[];
  protocolWarnings: AssistantProtocolWarning[];
  toolReadEventIds: string[];
  toolReadTodoIds: string[];
  toolReadMemoryIds: string[];
  toolCalls: Array<Record<string, unknown>>;
  executionOutcome: string;
  executionRejected: Array<Record<string, unknown>>;
  narration: Record<string, unknown>;
}

function boundedErrorDetail(value: string | null | undefined): string | null {
  if (!value) return null;
  const compact = value.trim().replace(/\s+/g, ' ');
  return compact.length <= 500 ? compact : `${compact.slice(0, 499)}…`;
}

function boundedAttempts(attempts: AssistantProviderAttempt[] | undefined): AssistantProviderAttempt[] {
  return (attempts ?? []).slice(0, 2).map(attempt => ({
    ...attempt,
    errorDetail: boundedErrorDetail(attempt.errorDetail),
  }));
}

export async function beginAssistantDecisionLog(input: {
  requestId: string;
  userMessageId: string;
  promptVersion: string;
  model: string;
  referenceAt: number;
  timeZone: string;
  contextRefs: AssistantDecisionContextRefs;
  createdAt?: number;
}): Promise<void> {
  const createdAt = input.createdAt ?? Date.now();
  await withDatabaseConnection(async (database) => {
    await database.runAsync(
      `INSERT INTO assistant_decision_logs (
         request_id, user_message_id, prompt_version, model, reference_at, time_zone,
         context_refs_json, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'started', ?, ?)
       ON CONFLICT(request_id) DO UPDATE SET
         prompt_version=excluded.prompt_version, model=excluded.model,
         reference_at=excluded.reference_at, time_zone=excluded.time_zone,
         context_refs_json=excluded.context_refs_json, status='started',
         proposed_operations_json='[]', proposed_event_deltas_json='[]', proposed_memory_deltas_json='[]',
         validation_json='{}', committed_operation_ids_json='[]',
         provider_started_at=NULL, provider_completed_at=NULL, commit_completed_at=NULL,
         finish_reason=NULL, prompt_tokens=NULL, completion_tokens=NULL, total_tokens=NULL,
         error_code=NULL, error_detail=NULL, repair_count=0, repair_status='not_needed',
         provider_attempt_count=0, provider_attempts_json='[]',
         protocol_warnings_json='[]', tool_read_event_ids_json='[]', tool_read_todo_ids_json='[]',
         tool_read_memory_ids_json='[]', tool_calls_json='[]',
         execution_outcome='pending', execution_rejected_json='[]', narration_json='{}', updated_at=excluded.updated_at`,
      input.requestId, input.userMessageId, input.promptVersion, input.model,
      input.referenceAt, input.timeZone, JSON.stringify(input.contextRefs), createdAt, createdAt,
    );
    await database.runAsync(
      `DELETE FROM assistant_decision_logs WHERE request_id IN (
         SELECT request_id FROM assistant_decision_logs
         ORDER BY created_at DESC, request_id DESC LIMIT -1 OFFSET 500
       )`,
    );
  });
}

export async function recordAssistantModelDecision(input: {
  requestId: string;
  operations: AssistantOperationProposal[];
  eventDeltas?: AssistantEventDelta[];
  memoryDeltas?: AssistantMemoryDeltaProposal[];
  metadata?: AssistantProviderMetadata;
  toolReadEventIds?: string[];
  toolReadTodoIds?: string[];
  toolReadMemoryIds?: string[];
  toolCalls?: Array<Record<string, unknown>>;
  updatedAt?: number;
}): Promise<void> {
  const updatedAt = input.updatedAt ?? Date.now();
  await withDatabaseConnection(async database => database.runAsync(
    `UPDATE assistant_decision_logs SET
       proposed_operations_json=?, proposed_event_deltas_json=?, proposed_memory_deltas_json=?, status='model_received',
       provider_started_at=?, provider_completed_at=?, finish_reason=?,
       prompt_tokens=?, completion_tokens=?, total_tokens=?,
       provider_attempt_count=?, provider_attempts_json=?, protocol_warnings_json=?,
       tool_read_event_ids_json=?, tool_read_todo_ids_json=?, tool_read_memory_ids_json=?,
       tool_calls_json=?, updated_at=?
     WHERE request_id=?`,
    JSON.stringify(input.operations), JSON.stringify(input.eventDeltas ?? []), JSON.stringify(input.memoryDeltas ?? []),
    input.metadata?.startedAt ?? null,
    input.metadata?.completedAt ?? updatedAt, input.metadata?.finishReason ?? null,
    input.metadata?.promptTokens ?? null, input.metadata?.completionTokens ?? null,
    input.metadata?.totalTokens ?? null, input.metadata?.attemptCount ?? 0,
    JSON.stringify(boundedAttempts(input.metadata?.attempts)),
    JSON.stringify(input.metadata?.protocolWarnings ?? []),
    JSON.stringify(input.toolReadEventIds ?? []),
    JSON.stringify(input.toolReadTodoIds ?? []),
    JSON.stringify(input.toolReadMemoryIds ?? []),
    JSON.stringify(boundedToolCalls(input.toolCalls)),
    updatedAt, input.requestId,
  ));
}

function boundedToolCalls(toolCalls: Array<Record<string, unknown>> | undefined): Array<Record<string, unknown>> {
  return (toolCalls ?? []).slice(0, 12).map(call => {
    const argumentsJson = typeof call.argumentsJson === 'string' ? call.argumentsJson : '';
    return {
      ...call,
      argumentsJson: argumentsJson.length <= 200 ? argumentsJson : `${argumentsJson.slice(0, 199)}…`,
    };
  });
}

export async function recordAssistantValidation(input: {
  requestId: string;
  accepted: AssistantOperationProposal[];
  rejected: unknown[];
  compiled?: AssistantOperationProposal[];
  acceptedMemoryDeltas?: AssistantMemoryDeltaProposal[];
  rejectedMemoryDeltas?: unknown[];
  updatedAt?: number;
}): Promise<void> {
  const updatedAt = input.updatedAt ?? Date.now();
  await withDatabaseConnection(async database => database.runAsync(
    `UPDATE assistant_decision_logs SET validation_json=?, status='validated', updated_at=? WHERE request_id=?`,
    JSON.stringify({
      compiled: (input.compiled ?? []).map(operation => ({ key: operation.key, type: operation.type })),
      accepted: input.accepted.map(operation => ({ key: operation.key, type: operation.type })),
      rejected: input.rejected,
      memories: {
        accepted: (input.acceptedMemoryDeltas ?? []).map(delta => ({ key: delta.key, action: delta.action })),
        rejected: input.rejectedMemoryDeltas ?? [],
      },
    }),
    updatedAt,
    input.requestId,
  ));
}

export async function recordAssistantDecisionCommit(input: {
  requestId: string;
  operations: AssistantOperation[];
  completedAt?: number;
}): Promise<void> {
  const completedAt = input.completedAt ?? Date.now();
  await withDatabaseConnection(async database => database.runAsync(
    `UPDATE assistant_decision_logs SET committed_operation_ids_json=?, status='committed', execution_outcome='committed',
       commit_completed_at=?, error_code=NULL, updated_at=? WHERE request_id=?`,
    JSON.stringify(input.operations.map(operation => operation.id)), completedAt, completedAt, input.requestId,
  ));
}

export async function recordAssistantExecutionOutcome(input: {
  requestId: string;
  result: AssistantExecutionResult;
  updatedAt?: number;
}): Promise<void> {
  const updatedAt = input.updatedAt ?? Date.now();
  await withDatabaseConnection(async database => database.runAsync(
    `UPDATE assistant_decision_logs SET execution_outcome=?, execution_rejected_json=?, error_detail=COALESCE(error_detail, ?), updated_at=?
     WHERE request_id=?`,
    input.result.outcome,
    JSON.stringify(input.result.rejected),
    input.result.error ? boundedErrorDetail(input.result.error) : null,
    updatedAt,
    input.requestId,
  ));
}

export async function recordAssistantNarration(input: {
  requestId: string;
  narration: {
    source: 'model' | 'fallback' | 'skipped';
    startedAt: number;
    completedAt: number;
    totalTokens?: number | null;
    errorCode?: string | null;
  };
  updatedAt?: number;
}): Promise<void> {
  const updatedAt = input.updatedAt ?? Date.now();
  await withDatabaseConnection(async database => database.runAsync(
    `UPDATE assistant_decision_logs SET narration_json=?, updated_at=? WHERE request_id=?`,
    JSON.stringify({
      source: input.narration.source,
      startedAt: input.narration.startedAt,
      completedAt: input.narration.completedAt,
      totalTokens: input.narration.totalTokens ?? null,
      errorCode: input.narration.errorCode ?? null,
    }),
    updatedAt,
    input.requestId,
  ));
}

export async function recordAssistantDecisionFailure(input: {
  requestId: string;
  errorCode: string;
  errorDetail?: string | null;
  providerAttemptCount?: number;
  providerAttempts?: AssistantProviderAttempt[];
  protocolWarnings?: AssistantProtocolWarning[];
  updatedAt?: number;
}): Promise<void> {
  const updatedAt = input.updatedAt ?? Date.now();
  await withDatabaseConnection(async database => database.runAsync(
    `UPDATE assistant_decision_logs SET status='failed', error_code=?, error_detail=?,
       provider_attempt_count=COALESCE(?, provider_attempt_count),
       provider_attempts_json=COALESCE(?, provider_attempts_json),
       protocol_warnings_json=COALESCE(?, protocol_warnings_json), updated_at=? WHERE request_id=?`,
    input.errorCode,
    boundedErrorDetail(input.errorDetail),
    input.providerAttemptCount ?? null,
    input.providerAttempts ? JSON.stringify(boundedAttempts(input.providerAttempts)) : null,
    input.protocolWarnings ? JSON.stringify(input.protocolWarnings) : null,
    updatedAt,
    input.requestId,
  ));
}

export async function getAssistantDecisionLog(requestId: string): Promise<AssistantDecisionLog | null> {
  return withDatabaseConnection(async (database) => {
    const row = await database.getFirstAsync<any>('SELECT * FROM assistant_decision_logs WHERE request_id=?', requestId);
    if (!row) return null;
    return {
      requestId: row.request_id,
      status: row.status,
      proposedOperations: JSON.parse(row.proposed_operations_json || '[]'),
      proposedEventDeltas: JSON.parse(row.proposed_event_deltas_json || '[]'),
      proposedMemoryDeltas: JSON.parse(row.proposed_memory_deltas_json || '[]'),
      validation: JSON.parse(row.validation_json || '{}'),
      committedOperationIds: JSON.parse(row.committed_operation_ids_json || '[]'),
      errorCode: row.error_code ?? null,
      errorDetail: row.error_detail ?? null,
      providerAttemptCount: Number(row.provider_attempt_count ?? 0),
      providerAttempts: JSON.parse(row.provider_attempts_json || '[]'),
      protocolWarnings: JSON.parse(row.protocol_warnings_json || '[]'),
      toolReadEventIds: JSON.parse(row.tool_read_event_ids_json || '[]'),
      toolReadTodoIds: JSON.parse(row.tool_read_todo_ids_json || '[]'),
      toolReadMemoryIds: JSON.parse(row.tool_read_memory_ids_json || '[]'),
      toolCalls: JSON.parse(row.tool_calls_json || '[]'),
      executionOutcome: row.execution_outcome ?? 'pending',
      executionRejected: JSON.parse(row.execution_rejected_json || '[]'),
      narration: JSON.parse(row.narration_json || '{}'),
    };
  });
}
