import { withDatabaseConnection } from '../db';
import type { AssistantOperation, AssistantOperationProposal } from './action-types';
import type { AssistantProviderMetadata } from './provider';

export interface AssistantDecisionContextRefs {
  recentMessageIds: string[];
  segmentIds: string[];
  entryIds: string[];
  eventCandidateIds: string[];
  todoCandidateIds: string[];
  launchContextId: string | null;
}

export interface AssistantDecisionLog {
  requestId: string;
  status: 'started' | 'model_received' | 'validated' | 'committed' | 'failed';
  proposedOperations: AssistantOperationProposal[];
  validation: unknown;
  committedOperationIds: string[];
  errorCode: string | null;
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
         proposed_operations_json='[]', validation_json='{}', committed_operation_ids_json='[]',
         provider_started_at=NULL, provider_completed_at=NULL, commit_completed_at=NULL,
         finish_reason=NULL, prompt_tokens=NULL, completion_tokens=NULL, total_tokens=NULL,
         error_code=NULL, updated_at=excluded.updated_at`,
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
  metadata?: AssistantProviderMetadata;
  updatedAt?: number;
}): Promise<void> {
  const updatedAt = input.updatedAt ?? Date.now();
  await withDatabaseConnection(async database => database.runAsync(
    `UPDATE assistant_decision_logs SET
       proposed_operations_json=?, status='model_received',
       provider_started_at=?, provider_completed_at=?, finish_reason=?,
       prompt_tokens=?, completion_tokens=?, total_tokens=?, updated_at=?
     WHERE request_id=?`,
    JSON.stringify(input.operations), input.metadata?.startedAt ?? null,
    input.metadata?.completedAt ?? updatedAt, input.metadata?.finishReason ?? null,
    input.metadata?.promptTokens ?? null, input.metadata?.completionTokens ?? null,
    input.metadata?.totalTokens ?? null, updatedAt, input.requestId,
  ));
}

export async function recordAssistantValidation(input: {
  requestId: string;
  accepted: AssistantOperationProposal[];
  rejected: unknown[];
  updatedAt?: number;
}): Promise<void> {
  const updatedAt = input.updatedAt ?? Date.now();
  await withDatabaseConnection(async database => database.runAsync(
    `UPDATE assistant_decision_logs SET validation_json=?, status='validated', updated_at=? WHERE request_id=?`,
    JSON.stringify({
      accepted: input.accepted.map(operation => ({ key: operation.key, type: operation.type })),
      rejected: input.rejected,
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
    `UPDATE assistant_decision_logs SET committed_operation_ids_json=?, status='committed',
       commit_completed_at=?, error_code=NULL, updated_at=? WHERE request_id=?`,
    JSON.stringify(input.operations.map(operation => operation.id)), completedAt, completedAt, input.requestId,
  ));
}

export async function recordAssistantDecisionFailure(
  requestId: string,
  errorCode: string,
  updatedAt = Date.now(),
): Promise<void> {
  await withDatabaseConnection(async database => database.runAsync(
    `UPDATE assistant_decision_logs SET status='failed', error_code=?, updated_at=? WHERE request_id=?`,
    errorCode,
    updatedAt,
    requestId,
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
      validation: JSON.parse(row.validation_json || '{}'),
      committedOperationIds: JSON.parse(row.committed_operation_ids_json || '[]'),
      errorCode: row.error_code ?? null,
    };
  });
}
