import { withDatabaseConnection } from '../db';
import {
  containsForbiddenMemorySecret,
  memoryEvidenceAppearsInUserMessage,
  normalizeMemoryContent,
} from './memory-policy';
import { listMemorySources, rowToMemory } from './memory-store';
import type {
  AssistantMemoryContext,
  AssistantMemoryDeltaProposal,
  AssistantMemoryRejection,
  ValidatedAssistantMemoryDelta,
} from './memory-types';

export async function validateAssistantMemoryDeltas(input: {
  deltas: AssistantMemoryDeltaProposal[];
  context: AssistantMemoryContext;
  userMessage: string;
  userMessageId: string;
}): Promise<{ accepted: ValidatedAssistantMemoryDelta[]; rejected: AssistantMemoryRejection[] }> {
  const accepted: ValidatedAssistantMemoryDelta[] = [];
  const rejected: AssistantMemoryRejection[] = [];
  const allowed = new Map([...input.context.active, ...input.context.candidates].map(memory => [memory.id, memory]));

  const reject = (delta: AssistantMemoryDeltaProposal, reason: AssistantMemoryRejection['reason']) => {
    rejected.push({ key: delta.key, action: delta.action, reason });
  };

  for (const delta of input.deltas) {
    if (!memoryEvidenceAppearsInUserMessage(delta.evidence, input.userMessage)) {
      reject(delta, 'evidence_not_in_user_message');
      continue;
    }
    const proposedContent = 'content' in delta ? delta.content : '';
    if (containsForbiddenMemorySecret(proposedContent || delta.evidence)) {
      reject(delta, 'forbidden_secret');
      continue;
    }

    if (delta.action === 'create_candidate' || delta.action === 'create_active') {
      const normalized = normalizeMemoryContent(delta.content);
      const rows = await withDatabaseConnection(database => database.getAllAsync<any>(
        `SELECT * FROM assistant_memories
         WHERE normalized_content=? AND status IN ('candidate', 'active', 'forgotten')`,
        normalized,
      ));
      const memories = rows.map(rowToMemory);
      if (memories.some(memory => memory.status !== 'forgotten')) {
        reject(delta, 'duplicate_content');
        continue;
      }
      if (memories.some(memory => memory.status === 'forgotten') && delta.action !== 'create_active') {
        reject(delta, 'forgotten_requires_explicit_request');
        continue;
      }
      accepted.push(delta);
      continue;
    }

    const target = allowed.get(delta.memoryId);
    if (!target || (delta.action === 'activate_candidate' ? target.status !== 'candidate' : target.status !== 'active')) {
      reject(delta, 'candidate_not_allowed');
      continue;
    }
    if (target.revision !== delta.expectedRevision) {
      reject(delta, 'revision_conflict');
      continue;
    }

    if (delta.action === 'activate_candidate') {
      if (delta.admissionBasis === 'repeated' && target.sensitivity === 'sensitive') {
        reject(delta, 'sensitive_requires_confirmation');
        continue;
      }
      if (delta.admissionBasis === 'repeated') {
        const sources = await listMemorySources(target.id);
        const distinct = new Set(sources.map(source => source.sourceMessageId).filter(Boolean));
        distinct.add(input.userMessageId);
        if (distinct.size < 2) {
          reject(delta, 'insufficient_distinct_sources');
          continue;
        }
      }
      accepted.push(delta);
      continue;
    }

    if (delta.action === 'supersede_memory') {
      const duplicate = await withDatabaseConnection(database => database.getFirstAsync(
        `SELECT id FROM assistant_memories
         WHERE id!=? AND normalized_content=? AND status IN ('candidate', 'active') LIMIT 1`,
        target.id, normalizeMemoryContent(delta.content),
      ));
      if (duplicate) {
        reject(delta, 'duplicate_content');
        continue;
      }
    }
    accepted.push(delta);
  }

  return { accepted, rejected };
}
