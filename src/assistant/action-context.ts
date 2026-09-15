import { scoreTextRelevance } from './retrieval';
import type {
  AssistantActionContext,
  AssistantEventCandidate,
  AssistantTodoCandidate,
} from './action-types';
import type { AssistantLaunchContext } from './context';

const CONTINUOUS_SIGNAL = /持续|长期|接下来|后续|跟进|推进|进展|阶段|逐步|一步步|继续关注|一直|每(?:天|周|月)|主线/;
const EVIDENCE_STOP_CHARS = new Set('今天明昨上下午晚早第一个了的又在和与是我你他她它这那就已还要去来把会'.split(''));

function topicCharacterOverlap(left: string, right: string): number {
  const leftChars = new Set([...left].filter(char => /[\p{Script=Han}]/u.test(char) && !EVIDENCE_STOP_CHARS.has(char)));
  const rightChars = new Set([...right].filter(char => /[\p{Script=Han}]/u.test(char) && !EVIDENCE_STOP_CHARS.has(char)));
  let overlap = 0;
  for (const char of rightChars) if (leftChars.has(char)) overlap += 1;
  const base = Math.min(leftChars.size, rightChars.size);
  return base ? overlap / base : 0;
}

export function shouldAdmitNewEvent(currentMessage: string, recentEvidence: string[]): boolean {
  if (CONTINUOUS_SIGNAL.test(currentMessage)) return true;
  if (recentEvidence.length < 2) return false;
  return recentEvidence.some(item => (
    scoreTextRelevance(currentMessage, item) >= 0.08 || topicCharacterOverlap(currentMessage, item) >= 0.4
  ));
}

function eventSearchText(candidate: AssistantEventCandidate): string[] {
  return [
    candidate.title,
    candidate.currentState,
    ...candidate.aliases,
    ...candidate.linkedTodoTexts,
    ...(candidate.recentUpdateTexts ?? []),
  ];
}

export function rankEventCandidates(
  query: string,
  candidates: AssistantEventCandidate[],
): AssistantEventCandidate[] {
  return candidates
    .map(candidate => ({
      ...candidate,
      score: Math.max(candidate.score, ...eventSearchText(candidate).map(text => (
        Math.max(scoreTextRelevance(query, text), topicCharacterOverlap(query, text))
      ))),
    }))
    .filter(candidate => candidate.score >= 0.08)
    .sort((left, right) => right.score - left.score || right.updatedAt - left.updatedAt)
    .slice(0, 5);
}

export type EventCandidateDecision =
  | { kind: 'none' }
  | { kind: 'single'; candidate: AssistantEventCandidate }
  | { kind: 'ambiguous'; candidates: AssistantEventCandidate[] };

export function classifyEventCandidates(candidates: AssistantEventCandidate[]): EventCandidateDecision {
  const sorted = [...candidates].sort((left, right) => right.score - left.score || right.updatedAt - left.updatedAt);
  const best = sorted[0];
  if (!best || best.score < 0.08) return { kind: 'none' };
  const second = sorted[1];
  if (second && second.score >= 0.08 && second.score >= best.score * 0.85) {
    return { kind: 'ambiguous', candidates: [best, second] };
  }
  return { kind: 'single', candidate: best };
}

function rankTodoCandidates(query: string, candidates: AssistantTodoCandidate[]): AssistantTodoCandidate[] {
  return candidates
    .map(candidate => ({ ...candidate, score: Math.max(candidate.score, scoreTextRelevance(query, candidate.text)) }))
    .filter(candidate => candidate.score >= 0.08)
    .sort((left, right) => right.score - left.score || right.updatedAt - left.updatedAt)
    .slice(0, 5);
}

function forceCandidate<T extends { id: string; score: number }>(
  ranked: T[],
  all: T[],
  id: string | null,
): T[] {
  if (!id) return ranked;
  const explicit = all.find(item => item.id === id);
  if (!explicit) return ranked;
  return [{ ...explicit, score: Math.max(explicit.score, 10) }, ...ranked.filter(item => item.id !== id)].slice(0, 5);
}

export async function loadAssistantActionContext(input: {
  query: string;
  launchContext?: AssistantLaunchContext | null;
  currentSegmentId?: string | null;
}): Promise<AssistantActionContext> {
  // 保持纯匹配函数可在 Node 测试中独立运行；仅实际读库时加载 Expo 数据层。
  const { withDatabaseConnection } = await import('../db');
  return withDatabaseConnection(async (database) => {
    const eventRows = await database.getAllAsync<any>(
      `SELECT * FROM assistant_events WHERE status='active'
       ORDER BY pinned_at IS NULL, pinned_at DESC, updated_at DESC LIMIT 100`,
    );
    const aliasRows = await database.getAllAsync<any>('SELECT event_id, alias FROM assistant_event_aliases');
    const updateRows = await database.getAllAsync<any>(
      `SELECT event_id, content FROM assistant_event_updates
       WHERE undone_at IS NULL ORDER BY occurred_at DESC, id DESC`,
    );
    const linkedTodoRows = await database.getAllAsync<any>(
      `SELECT r.to_id AS event_id, e.summary
       FROM assistant_object_relations r
       JOIN entries e ON e.id=r.from_id
       WHERE r.from_type='todo' AND r.relation_type='belongs_to'
         AND r.to_type='event' AND r.undone_at IS NULL`,
    );
    const aliasesByEvent = new Map<string, string[]>();
    for (const row of aliasRows) {
      aliasesByEvent.set(row.event_id, [...(aliasesByEvent.get(row.event_id) ?? []), row.alias]);
    }
    const updatesByEvent = new Map<string, string[]>();
    for (const row of updateRows) {
      const existing = updatesByEvent.get(row.event_id) ?? [];
      if (existing.length < 3) updatesByEvent.set(row.event_id, [...existing, row.content]);
    }
    const todosByEvent = new Map<string, string[]>();
    for (const row of linkedTodoRows) {
      todosByEvent.set(row.event_id, [...(todosByEvent.get(row.event_id) ?? []), row.summary]);
    }
    const allEvents: AssistantEventCandidate[] = eventRows.map(row => ({
      id: row.id,
      title: row.title,
      currentState: row.current_state,
      aliases: aliasesByEvent.get(row.id) ?? [],
      linkedTodoTexts: todosByEvent.get(row.id) ?? [],
      recentUpdateTexts: updatesByEvent.get(row.id) ?? [],
      revision: Number(row.revision),
      updatedAt: Number(row.updated_at),
      score: 0,
    }));

    const segmentBinding = input.currentSegmentId
      ? await database.getFirstAsync<{ event_id: string }>(
        `SELECT r.to_id AS event_id
         FROM assistant_object_relations r
         JOIN assistant_messages m ON m.id=r.from_id
         WHERE m.segment_id=? AND r.from_type='message' AND r.relation_type='source'
           AND r.to_type='event' AND r.undone_at IS NULL
         ORDER BY r.created_at DESC LIMIT 1`,
        input.currentSegmentId,
      )
      : null;
    const explicitEventId = input.launchContext?.kind === 'event' ? input.launchContext.id : null;
    let events = rankEventCandidates(input.query, allEvents);
    events = forceCandidate(events, allEvents, segmentBinding?.event_id ?? null);
    events = forceCandidate(events, allEvents, explicitEventId);

    const todoRows = await database.getAllAsync<any>(
      `SELECT id, summary, raw_text, due_at, revision_at, updated_at
       FROM entries WHERE kind='task' AND done=0
       ORDER BY updated_at DESC LIMIT 100`,
    );
    const allTodos: AssistantTodoCandidate[] = todoRows.map(row => ({
      id: row.id,
      text: row.summary || row.raw_text,
      dueAt: row.due_at ?? null,
      revisionAt: Number(row.revision_at),
      updatedAt: Number(row.updated_at),
      score: 0,
    }));
    let todos = rankTodoCandidates(input.query, allTodos);
    const explicitTodoId = input.launchContext?.kind === 'todo' ? input.launchContext.id : null;
    todos = forceCandidate(todos, allTodos, explicitTodoId);

    return {
      events,
      todos,
      explicitEventId,
      segmentEventId: segmentBinding?.event_id ?? null,
    };
  });
}
