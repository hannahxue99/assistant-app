import type { SQLiteDatabase } from 'expo-sqlite';

import type { AssistantEvent, AssistantEventUpdate, AssistantObjectRelation, AssistantOperation } from '../assistant/action-types';
import type { AssistantMemory, AssistantMemorySource } from '../assistant/memory-types';
import type { ConversationSegment } from '../assistant/types';
import {
  rebuildFts,
  runSql,
  withDatabaseConnection,
  withExclusiveDatabaseTransaction,
} from '../db';
import type { Entry, Profile, TopicPreference } from '../types';
import {
  buildBackupV3Markdown,
  type BackupAssistantMessage,
  type BackupAssistantRequest,
  type BackupEnvelopeV3,
  type BackupEventAlias,
  type BackupPayloadV3,
} from './backup-v3-format';
import {
  buildBackupV3ImportPlan,
  type BackupV3ImportPlan,
  type BackupV3ImportPreview,
} from './backup-v3-import';
import { inferTimePrecision } from './calendar-projection';

type Database = Pick<SQLiteDatabase, 'getAllAsync' | 'getFirstAsync' | 'runAsync'>;

export interface BackupV3ImportResult extends BackupV3ImportPreview {
  affectedEntries: Entry[];
  projectionPending: boolean;
}

function parseStringArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? '[]'));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseDurations(value: unknown) {
  try {
    const parsed = JSON.parse(String(value ?? '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function rowToEntry(row: any): Entry {
  return {
    id: row.id, rawText: row.raw_text, kind: row.kind, summary: row.summary,
    dueAt: row.due_at ?? null, timePrecision: row.time_precision ?? inferTimePrecision(row.raw_text, row.due_at),
    remindAt: row.remind_at ?? null, topic: typeof row.topic === 'string' && row.topic.trim() ? row.topic.trim() : null,
    tags: parseStringArray(row.tags), persons: parseStringArray(row.persons), parseStatus: row.parse_status,
    parseSource: row.parse_source ?? null, correctedFrom: row.corrected_from ?? null,
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at ?? row.created_at),
    revisionAt: Number(row.revision_at ?? row.updated_at ?? row.created_at), done: Number(row.done) as 0 | 1,
    doneAt: row.done_at ?? null, source: row.source,
  };
}

function rowToProfile(row: any): Profile {
  return {
    name: row?.name ?? '', goals: parseStringArray(row?.goals), avoid: parseStringArray(row?.avoid),
    notifyMorning: row ? Boolean(row.notify_morning) : true,
    notifyEvening: row ? Boolean(row.notify_evening) : true,
  };
}

function rowToSegment(row: any): ConversationSegment {
  return {
    id: row.id, summary: row.summary, status: row.status, startedAt: Number(row.started_at),
    endedAt: row.ended_at ?? null, updatedAt: Number(row.updated_at),
  };
}

function rowToRequest(row: any): BackupAssistantRequest {
  const interrupted = row.status === 'pending';
  return {
    id: row.id, userMessageId: row.user_message_id,
    status: interrupted ? 'failed' : row.status,
    errorCode: interrupted ? 'interrupted_at_export' : row.error_code ?? null,
    attemptCount: Number(row.attempt_count), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  };
}

function rowToMessage(row: any): BackupAssistantMessage {
  return {
    id: row.id, requestId: row.request_id, role: row.role, content: row.content, source: row.source,
    status: row.status === 'sending' ? 'failed' : row.status,
    segmentId: row.segment_id, legacyEntryId: row.legacy_entry_id ?? null,
    stageDurations: parseDurations(row.stage_durations_json),
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  };
}

function rowToEvent(row: any): AssistantEvent {
  return {
    id: row.id, title: row.title, currentState: row.current_state, status: row.status,
    pinnedAt: row.pinned_at ?? null, revision: Number(row.revision),
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  };
}

function rowToAlias(row: any): BackupEventAlias {
  return { id: row.id, eventId: row.event_id, alias: row.alias, createdAt: Number(row.created_at) };
}

function rowToUpdate(row: any): AssistantEventUpdate {
  return {
    id: row.id, eventId: row.event_id, content: row.content, occurredAt: Number(row.occurred_at),
    sourceMessageId: row.source_message_id ?? null, stableKey: row.stable_key,
    createdAt: Number(row.created_at), undoneAt: row.undone_at ?? null,
  };
}

function rowToRelation(row: any): AssistantObjectRelation {
  return {
    id: row.id, fromType: row.from_type, fromId: row.from_id, relationType: row.relation_type,
    toType: row.to_type, toId: row.to_id, sourceMessageId: row.source_message_id ?? null,
    createdAt: Number(row.created_at), undoneAt: row.undone_at ?? null,
  };
}

function rowToOperation(row: any): AssistantOperation {
  return {
    id: row.id, requestId: row.request_id, operationKey: row.operation_key,
    operationType: row.operation_type, objectType: row.object_type, objectId: row.object_id,
    beforeSnapshot: row.before_snapshot ?? null, afterSnapshot: row.after_snapshot,
    receiptSummary: row.receipt_summary, status: row.status, sequence: Number(row.sequence),
    createdAt: Number(row.created_at), undoneAt: row.undone_at ?? null,
  };
}

function rowToMemory(row: any): AssistantMemory {
  return {
    id: row.id, category: row.category, content: row.content, normalizedContent: row.normalized_content,
    status: row.status, sensitivity: row.sensitivity, admissionBasis: row.admission_basis,
    supersededById: row.superseded_by_id ?? null, revision: Number(row.revision),
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    activatedAt: row.activated_at ?? null, supersededAt: row.superseded_at ?? null,
    forgottenAt: row.forgotten_at ?? null,
  };
}

function rowToMemorySource(row: any): AssistantMemorySource {
  return {
    id: row.id, memoryId: row.memory_id, sourceMessageId: row.source_message_id ?? null,
    evidence: row.evidence, createdAt: Number(row.created_at),
  };
}

async function readBackupV3State(database: Database): Promise<BackupPayloadV3> {
  const [
    entryRows, profileRow, preferenceRows, segmentRows, requestRows, messageRows,
    eventRows, aliasRows, updateRows, relationRows, operationRows, memoryRows, memorySourceRows,
  ] = await Promise.all([
    database.getAllAsync<any>('SELECT * FROM entries ORDER BY created_at,id'),
    database.getFirstAsync<any>('SELECT * FROM profile WHERE id=1'),
    database.getAllAsync<any>('SELECT * FROM topic_preferences WHERE pinned_at IS NOT NULL ORDER BY topic'),
    database.getAllAsync<any>('SELECT * FROM conversation_segments ORDER BY started_at,id'),
    database.getAllAsync<any>('SELECT * FROM assistant_requests ORDER BY created_at,id'),
    database.getAllAsync<any>('SELECT * FROM assistant_messages ORDER BY created_at,id'),
    database.getAllAsync<any>('SELECT * FROM assistant_events ORDER BY created_at,id'),
    database.getAllAsync<any>('SELECT * FROM assistant_event_aliases ORDER BY created_at,id'),
    database.getAllAsync<any>('SELECT * FROM assistant_event_updates ORDER BY created_at,id'),
    database.getAllAsync<any>('SELECT * FROM assistant_object_relations ORDER BY created_at,id'),
    database.getAllAsync<any>('SELECT * FROM assistant_operations ORDER BY created_at,id'),
    database.getAllAsync<any>('SELECT * FROM assistant_memories ORDER BY created_at,id'),
    database.getAllAsync<any>('SELECT * FROM assistant_memory_sources ORDER BY created_at,id'),
  ]);
  const assistantMessages = messageRows.map(rowToMessage);
  const userMessageIds = new Set(assistantMessages.filter(message => message.role === 'user').map(message => message.id));
  const assistantRequests = requestRows.map(rowToRequest);
  for (const request of assistantRequests) {
    if (!userMessageIds.has(request.userMessageId)) throw new Error(`请求 ${request.id} 缺少用户消息，无法生成完整备份`);
  }
  return {
    entries: entryRows.map(rowToEntry),
    profile: rowToProfile(profileRow),
    topicPreferences: preferenceRows.map((row: any): TopicPreference => ({ topic: row.topic, pinnedAt: Number(row.pinned_at) })),
    conversationSegments: segmentRows.map(rowToSegment), assistantRequests, assistantMessages,
    events: eventRows.map(rowToEvent), eventAliases: aliasRows.map(rowToAlias),
    eventUpdates: updateRows.map(rowToUpdate), objectRelations: relationRows.map(rowToRelation),
    operations: operationRows.map(rowToOperation), memories: memoryRows.map(rowToMemory),
    memorySources: memorySourceRows.map(rowToMemorySource),
  };
}

function readableBackupSummary(payload: BackupPayloadV3, exportedAt: number): string {
  const firstMessage = payload.assistantMessages[0]?.createdAt;
  const lastMessage = payload.assistantMessages[payload.assistantMessages.length - 1]?.createdAt;
  const range = firstMessage === undefined ? '无对话' : `${new Date(firstMessage).toLocaleDateString('zh-CN')} – ${new Date(lastMessage).toLocaleDateString('zh-CN')}`;
  return [
    '# 私人助手完整备份', '',
    `> 导出于 ${new Date(exportedAt).toLocaleString('zh-CN')}`, '',
    '## 内容摘要', '',
    `- 记录与待办：${payload.entries.length} 条`,
    `- 对话消息：${payload.assistantMessages.length} 条（${range}）`,
    `- 事件：${payload.events.length} 个；进展：${payload.eventUpdates.length} 条`,
    `- 对象关系：${payload.objectRelations.length} 条`,
    `- 长期记忆：${payload.memories.length} 条`, '',
    '此文件包含私人对话、事件和长期记忆，请保存在可信位置。',
  ].join('\n');
}

export async function exportBackupV3Markdown(exportedAt = Date.now()): Promise<string> {
  const payload = await withExclusiveDatabaseTransaction(readBackupV3State);
  return buildBackupV3Markdown(readableBackupSummary(payload, exportedAt), payload, exportedAt);
}

export async function previewBackupV3Import(payload: BackupPayloadV3): Promise<BackupV3ImportPreview> {
  const local = await withDatabaseConnection(readBackupV3State);
  return buildBackupV3ImportPlan(payload, local).preview;
}

async function writeEntry(database: Database, entry: Entry, update: boolean) {
  if (update) {
    await database.runAsync(
      `UPDATE entries SET raw_text=?,kind=?,summary=?,due_at=?,time_precision=?,remind_at=?,topic=?,tags=?,persons=?,
       parse_status=?,parse_source=?,corrected_from=?,created_at=?,updated_at=?,revision_at=?,done=?,done_at=?,source=? WHERE id=?`,
      entry.rawText, entry.kind, entry.summary, entry.dueAt, entry.timePrecision ?? 'date', entry.remindAt,
      entry.topic, JSON.stringify(entry.tags), JSON.stringify(entry.persons), entry.parseStatus, entry.parseSource,
      entry.correctedFrom, entry.createdAt, entry.updatedAt, entry.revisionAt, entry.done, entry.doneAt, entry.source, entry.id,
    );
  } else {
    await database.runAsync(
      `INSERT INTO entries (id,raw_text,kind,summary,due_at,time_precision,remind_at,topic,tags,persons,
       parse_status,parse_source,corrected_from,created_at,updated_at,revision_at,done,done_at,source)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      entry.id, entry.rawText, entry.kind, entry.summary, entry.dueAt, entry.timePrecision ?? 'date',
      entry.remindAt, entry.topic, JSON.stringify(entry.tags), JSON.stringify(entry.persons), entry.parseStatus,
      entry.parseSource, entry.correctedFrom, entry.createdAt, entry.updatedAt, entry.revisionAt,
      entry.done, entry.doneAt, entry.source,
    );
  }
}

async function applyPlan(
  database: Database,
  plan: BackupV3ImportPlan,
  envelope: BackupEnvelopeV3,
  importedAt: number,
): Promise<Entry[]> {
  const affectedEntries: Entry[] = [];
  for (const decision of plan.entries) {
    if (decision.action !== 'add' && decision.action !== 'update') continue;
    await writeEntry(database, decision.incoming, decision.action === 'update');
    affectedEntries.push(decision.incoming);
  }
  if (plan.preview.profileWillImport) {
    const profile = envelope.payload.profile;
    await database.runAsync(
      'UPDATE profile SET name=?,goals=?,avoid=?,notify_morning=?,notify_evening=? WHERE id=1',
      profile.name, JSON.stringify(profile.goals), JSON.stringify(profile.avoid),
      profile.notifyMorning ? 1 : 0, profile.notifyEvening ? 1 : 0,
    );
  }
  for (const preference of envelope.payload.topicPreferences) {
    await database.runAsync(
      `INSERT INTO topic_preferences(topic,pinned_at) VALUES(?,?)
       ON CONFLICT(topic) DO UPDATE SET pinned_at=MAX(topic_preferences.pinned_at,excluded.pinned_at)`,
      preference.topic, preference.pinnedAt,
    );
  }
  for (const decision of plan.conversationSegments) {
    if (decision.action === 'add') {
      const item = decision.incoming;
      await database.runAsync('INSERT INTO conversation_segments VALUES (?,?,?,?,?,?)',
        item.id, item.summary, item.status, item.startedAt, item.endedAt, item.updatedAt);
    } else if (decision.action === 'update') {
      const item = decision.incoming;
      await database.runAsync(
        'UPDATE conversation_segments SET summary=?,status=?,started_at=?,ended_at=?,updated_at=? WHERE id=?',
        item.summary, item.status, item.startedAt, item.endedAt, item.updatedAt, item.id,
      );
    }
  }
  for (const decision of plan.assistantRequests) {
    if (decision.action !== 'add') continue;
    const item = decision.incoming;
    await database.runAsync('INSERT INTO assistant_requests VALUES (?,?,?,?,?,?,?)',
      item.id, item.userMessageId, item.status, item.errorCode, item.attemptCount, item.createdAt, item.updatedAt);
  }
  for (const decision of plan.assistantMessages) {
    if (decision.action !== 'add') continue;
    const item = decision.incoming;
    await database.runAsync('INSERT INTO assistant_messages VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      item.id, item.requestId, item.role, item.content, item.source, item.status, item.segmentId,
      item.legacyEntryId, JSON.stringify(item.stageDurations), item.createdAt, item.updatedAt);
  }
  for (const decision of plan.events) {
    const item = decision.incoming;
    if (decision.action === 'add') {
      await database.runAsync('INSERT INTO assistant_events VALUES (?,?,?,?,?,?,?,?)',
        item.id, item.title, item.currentState, item.status, item.pinnedAt, item.revision, item.createdAt, item.updatedAt);
    } else if (decision.action === 'update') {
      await database.runAsync(
        'UPDATE assistant_events SET title=?,current_state=?,status=?,pinned_at=?,revision=?,created_at=?,updated_at=? WHERE id=?',
        item.title, item.currentState, item.status, item.pinnedAt, item.revision, item.createdAt, item.updatedAt, item.id,
      );
    }
  }
  for (const decision of plan.eventAliases) {
    if (decision.action !== 'add') continue;
    const item = decision.incoming;
    await database.runAsync('INSERT INTO assistant_event_aliases VALUES (?,?,?,?)', item.id, item.eventId, item.alias, item.createdAt);
  }
  for (const decision of plan.eventUpdates) {
    if (decision.action !== 'add') continue;
    const item = decision.incoming;
    await database.runAsync('INSERT INTO assistant_event_updates VALUES (?,?,?,?,?,?,?,?)',
      item.id, item.eventId, item.content, item.occurredAt, item.sourceMessageId, item.stableKey, item.createdAt, item.undoneAt);
  }
  for (const decision of plan.memories) {
    if (decision.action !== 'add' && decision.action !== 'update') continue;
    const item = decision.incoming;
    await database.runAsync(
      `INSERT INTO assistant_memories (id,category,content,normalized_content,status,sensitivity,admission_basis,
       superseded_by_id,revision,created_at,updated_at,activated_at,superseded_at,forgotten_at)
       VALUES (?,?,?,?,?,?,?,NULL,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET category=excluded.category,content=excluded.content,
       normalized_content=excluded.normalized_content,status=excluded.status,sensitivity=excluded.sensitivity,
       admission_basis=excluded.admission_basis,superseded_by_id=NULL,revision=excluded.revision,
       created_at=excluded.created_at,updated_at=excluded.updated_at,activated_at=excluded.activated_at,
       superseded_at=excluded.superseded_at,forgotten_at=excluded.forgotten_at`,
      item.id, item.category, item.content, item.normalizedContent, item.status, item.sensitivity,
      item.admissionBasis, item.revision, item.createdAt, item.updatedAt, item.activatedAt,
      item.supersededAt, item.forgottenAt,
    );
  }
  for (const decision of plan.memories) {
    if ((decision.action !== 'add' && decision.action !== 'update') || !decision.incoming.supersededById) continue;
    await database.runAsync('UPDATE assistant_memories SET superseded_by_id=? WHERE id=?',
      decision.incoming.supersededById, decision.incoming.id);
  }
  for (const decision of plan.memorySources) {
    if (decision.action !== 'add') continue;
    const item = decision.incoming;
    await database.runAsync('INSERT INTO assistant_memory_sources VALUES (?,?,?,?,?)',
      item.id, item.memoryId, item.sourceMessageId, item.evidence, item.createdAt);
  }
  for (const decision of plan.objectRelations) {
    if (decision.action !== 'add') continue;
    const item = decision.incoming;
    await database.runAsync('INSERT INTO assistant_object_relations VALUES (?,?,?,?,?,?,?,?,?)',
      item.id, item.fromType, item.fromId, item.relationType, item.toType, item.toId,
      item.sourceMessageId, item.createdAt, item.undoneAt);
  }
  for (const decision of plan.operations) {
    if (decision.action !== 'add') continue;
    const item = decision.incoming;
    await database.runAsync('INSERT INTO assistant_operations VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      item.id, item.requestId, item.operationKey, item.operationType, item.objectType, item.objectId,
      item.beforeSnapshot, item.afterSnapshot, item.receiptSummary, item.status, item.sequence,
      item.createdAt, item.undoneAt);
  }
  for (const item of plan.conflicts) {
    const id = `${envelope.exportedAt}:${item.objectKind}:${item.objectId}:${item.reason}`;
    await database.runAsync(
      `INSERT OR IGNORE INTO assistant_import_conflicts
       (id,object_kind,object_id,local_snapshot,incoming_snapshot,winner,reason,imported_at,source_exported_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      id, item.objectKind, item.objectId, item.local === null ? null : JSON.stringify(item.local),
      JSON.stringify(item.incoming), item.winner, item.reason, importedAt, envelope.exportedAt,
    );
  }
  for (const entry of affectedEntries) {
    await database.runAsync(
      `INSERT INTO notification_sync_queue(entry_id,queued_at) VALUES(?,?)
       ON CONFLICT(entry_id) DO UPDATE SET queued_at=excluded.queued_at`,
      entry.id, importedAt,
    );
  }
  if (affectedEntries.length > 0) {
    await database.runAsync(
      `INSERT INTO assistant_projection_jobs(kind,queued_at,retry_at) VALUES('fts',?,0)
       ON CONFLICT(kind) DO UPDATE SET queued_at=excluded.queued_at,retry_at=0`,
      importedAt,
    );
  }
  return affectedEntries;
}

export async function processBackupV3ProjectionJobs(): Promise<boolean> {
  const pending = await withDatabaseConnection(database => database.getFirstAsync<{ kind: string }>(
    "SELECT kind FROM assistant_projection_jobs WHERE kind='fts' AND retry_at<=?",
    Date.now(),
  ));
  if (!pending) return true;
  try {
    await rebuildFts();
    await runSql("DELETE FROM assistant_projection_jobs WHERE kind='fts'");
    return true;
  } catch {
    await runSql("UPDATE assistant_projection_jobs SET retry_at=? WHERE kind='fts'", Date.now() + 60_000);
    return false;
  }
}

export async function importBackupV3(envelope: BackupEnvelopeV3): Promise<BackupV3ImportResult> {
  let plan: BackupV3ImportPlan | null = null;
  let affectedEntries: Entry[] = [];
  await withExclusiveDatabaseTransaction(async database => {
    const local = await readBackupV3State(database);
    plan = buildBackupV3ImportPlan(envelope.payload, local);
    affectedEntries = await applyPlan(database, plan, envelope, Date.now());
  });
  const projectionComplete = await processBackupV3ProjectionJobs();
  return { ...(plan as unknown as BackupV3ImportPlan).preview, affectedEntries, projectionPending: !projectionComplete };
}
