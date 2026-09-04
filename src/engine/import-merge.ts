import type { BackupPayload, Entry, Profile } from '../types';

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
): ImportPreview {
  return {
    added: decisions.filter((decision) => decision.action === 'add').length,
    updated: decisions.filter((decision) => decision.action === 'update').length,
    ignored: decisions.filter((decision) => decision.action === 'ignore').length,
    conflicts: decisions.filter((decision) => decision.action === 'keep-local').length,
    profileWillImport: isDefaultProfile(localProfile) && !isDefaultProfile(incomingPayload.profile),
  };
}
