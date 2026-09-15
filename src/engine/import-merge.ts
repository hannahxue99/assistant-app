import type { BackupPayload, Entry, Profile } from '../types';
import type { AssistantMemory } from '../assistant/memory-types';

export type EntryImportAction = 'add' | 'update' | 'ignore' | 'keep-local';

export interface EntryImportDecision {
  action: EntryImportAction;
  incoming: Entry;
  local: Entry | null;
  hasConflict: boolean;
  reason: 'missing_local' | 'identical' | 'incoming_newer' | 'local_newer' | 'same_revision';
}

export interface ImportPreview {
  added: number;
  updated: number;
  ignored: number;
  conflicts: number;
  profileWillImport: boolean;
  memoryAdded: number;
  memoryUpdated: number;
  memoryIgnored: number;
  memoryConflicts: number;
}

export type MemoryImportAction = 'add' | 'update' | 'ignore' | 'keep-local';

export interface MemoryImportDecision {
  action: MemoryImportAction;
  incoming: AssistantMemory;
  local: AssistantMemory | null;
}

export function memoriesHaveSameContent(left: AssistantMemory, right: AssistantMemory): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function classifyMemoryImport(incoming: AssistantMemory, local: AssistantMemory | null): MemoryImportDecision {
  if (!local) return { action: 'add', incoming, local };
  if (memoriesHaveSameContent(incoming, local)) return { action: 'ignore', incoming, local };
  if (incoming.revision > local.revision) return { action: 'update', incoming, local };
  if (incoming.revision < local.revision) return { action: 'keep-local', incoming, local };
  if (incoming.updatedAt > local.updatedAt) return { action: 'update', incoming, local };
  return { action: 'keep-local', incoming, local };
}

export function buildMemoryImportDecisions(
  incoming: AssistantMemory[],
  local: AssistantMemory[],
): MemoryImportDecision[] {
  const localById = new Map(local.map(memory => [memory.id, memory]));
  return incoming.map(memory => classifyMemoryImport(memory, localById.get(memory.id) ?? null));
}

export interface ImportResult extends ImportPreview {
  affectedEntries: Entry[];
  profileImported: boolean;
}

const DEFAULT_PROFILE: Profile = {
  name: '',
  goals: [],
  avoid: [],
  notifyMorning: true,
  notifyEvening: true,
};

export function entriesHaveSameContent(left: Entry, right: Entry): boolean {
  const comparableEntry = (entry: Entry) => [
    entry.id,
    entry.rawText,
    entry.kind,
    entry.summary,
    entry.dueAt,
    entry.timePrecision ?? 'date',
    entry.remindAt,
    entry.topic,
    entry.tags,
    entry.persons,
    entry.parseStatus,
    entry.parseSource,
    entry.correctedFrom,
    entry.createdAt,
    entry.updatedAt,
    entry.done,
    entry.doneAt,
    entry.source,
  ];
  return JSON.stringify(comparableEntry(left)) === JSON.stringify(comparableEntry(right));
}

export function isDefaultProfile(profile: Profile): boolean {
  return JSON.stringify(profile) === JSON.stringify(DEFAULT_PROFILE);
}

export function classifyEntryImport(incoming: Entry, local: Entry | null): EntryImportDecision {
  if (!local) {
    return { action: 'add', incoming, local, hasConflict: false, reason: 'missing_local' };
  }
  if (entriesHaveSameContent(incoming, local)) {
    return { action: 'ignore', incoming, local, hasConflict: false, reason: 'identical' };
  }
  if (incoming.revisionAt > local.revisionAt) {
    return { action: 'update', incoming, local, hasConflict: true, reason: 'incoming_newer' };
  }
  if (incoming.revisionAt < local.revisionAt) {
    return { action: 'keep-local', incoming, local, hasConflict: true, reason: 'local_newer' };
  }
  return { action: 'keep-local', incoming, local, hasConflict: true, reason: 'same_revision' };
}

export function buildImportDecisions(
  incomingEntries: Entry[],
  localEntries: Entry[],
): EntryImportDecision[] {
  const localById = new Map(localEntries.map((entry) => [entry.id, entry]));
  return incomingEntries.map((incoming) => classifyEntryImport(incoming, localById.get(incoming.id) ?? null));
}

export function summarizeImport(
  decisions: EntryImportDecision[],
  localProfile: Profile,
  incomingPayload: BackupPayload,
  memoryDecisions: MemoryImportDecision[] = [],
): ImportPreview {
  return {
    added: decisions.filter((decision) => decision.action === 'add').length,
    updated: decisions.filter((decision) => decision.action === 'update').length,
    ignored: decisions.filter((decision) => decision.action === 'ignore').length,
    conflicts: decisions.filter((decision) => decision.action === 'keep-local').length,
    profileWillImport: isDefaultProfile(localProfile) && !isDefaultProfile(incomingPayload.profile),
    memoryAdded: memoryDecisions.filter(decision => decision.action === 'add').length,
    memoryUpdated: memoryDecisions.filter(decision => decision.action === 'update').length,
    memoryIgnored: memoryDecisions.filter(decision => decision.action === 'ignore').length,
    memoryConflicts: memoryDecisions.filter(decision => decision.action === 'keep-local').length,
  };
}
