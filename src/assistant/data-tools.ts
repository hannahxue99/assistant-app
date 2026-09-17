export const ASSISTANT_READ_TOOL_NAMES = [
  'search_events',
  'get_event',
  'search_todos',
  'get_todo',
] as const;

export type AssistantReadToolName = typeof ASSISTANT_READ_TOOL_NAMES[number];

export interface AssistantReadToolCall {
  id: string;
  name: AssistantReadToolName;
  argumentsJson: string;
}

export interface AssistantReadToolExecution {
  toolCallId: string;
  name: AssistantReadToolName;
  result: Record<string, unknown>;
  readEventIds: string[];
  readTodoIds: string[];
}

export interface AssistantReadSet {
  eventIds: string[];
  todoIds: string[];
}

type DatabaseLike = {
  getAllAsync<T>(sql: string, ...args: any[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, ...args: any[]): Promise<T | null>;
};

const MAX_SEARCH_RESULTS = 8;

export const ASSISTANT_READ_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_events',
      description: '按标题、别名、当前状态、近期进展或关联待办搜索用户的真实事件。需要确认事件 ID 时先调用。',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: '从对话提炼的事件关键词' } },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_event',
      description: '按精确 ID 读取事件的真实状态、版本、近期进展及全部关联待办摘要。更新事件前调用。',
      parameters: {
        type: 'object',
        properties: { event_id: { type: 'string' } },
        required: ['event_id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_todos',
      description: '按内容搜索用户的真实待办。需要确认待办 ID 时先调用。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '从对话提炼的待办关键词' },
          include_done: { type: 'boolean', description: '是否包含已完成待办，默认否' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_todo',
      description: '按精确 ID 读取待办的真实内容、日期、完成状态、版本和关联事件。更新待办前调用。',
      parameters: {
        type: 'object',
        properties: { todo_id: { type: 'string' } },
        required: ['todo_id'],
        additionalProperties: false,
      },
    },
  },
] as const;

function isReadToolName(value: unknown): value is AssistantReadToolName {
  return typeof value === 'string' && (ASSISTANT_READ_TOOL_NAMES as readonly string[]).includes(value);
}

function parseArguments(value: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value || '{}');
  } catch {
    throw Object.assign(new Error('数据工具参数不是有效 JSON'), { code: 'invalid_tool_arguments' });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw Object.assign(new Error('数据工具参数必须是对象'), { code: 'invalid_tool_arguments' });
  }
  return parsed as Record<string, unknown>;
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw Object.assign(new Error(`数据工具缺少 ${key}`), { code: 'invalid_tool_arguments' });
  }
  return value.trim().slice(0, 120);
}

function escapedLike(value: string): string {
  return `%${value.replace(/[\\%_]/g, match => `\\${match}`)}%`;
}

function todoSnapshot(row: any) {
  return {
    id: row.id,
    text: row.summary || row.raw_text,
    dueAt: row.due_at ?? null,
    done: Boolean(row.done),
    revision: Number(row.revision_at ?? row.updated_at ?? 0),
    updatedAt: Number(row.updated_at ?? row.created_at ?? 0),
  };
}

function eventSnapshot(row: any) {
  return {
    id: row.id,
    title: row.title,
    currentState: row.current_state,
    status: row.status,
    revision: Number(row.revision),
    updatedAt: Number(row.updated_at),
  };
}

export function mergeAssistantReadSets(executions: AssistantReadToolExecution[]): AssistantReadSet {
  return {
    eventIds: [...new Set(executions.flatMap(item => item.readEventIds))],
    todoIds: [...new Set(executions.flatMap(item => item.readTodoIds))],
  };
}

export async function executeAssistantReadToolWithDatabase(
  database: DatabaseLike,
  call: { id: string; name: string; argumentsJson: string },
): Promise<AssistantReadToolExecution> {
  if (!isReadToolName(call.name)) {
    throw Object.assign(new Error(`不允许的数据工具：${call.name}`), { code: 'tool_not_allowed' });
  }
  const args = parseArguments(call.argumentsJson);
  if (call.name === 'search_events') {
    const query = requiredString(args, 'query');
    const like = escapedLike(query);
    const rows = await database.getAllAsync<any>(
      `SELECT DISTINCT e.* FROM assistant_events e
       LEFT JOIN assistant_event_aliases a ON a.event_id=e.id
       LEFT JOIN assistant_event_updates u ON u.event_id=e.id AND u.undone_at IS NULL
       LEFT JOIN assistant_object_relations r ON r.to_type='event' AND r.to_id=e.id
         AND r.from_type='todo' AND r.relation_type='belongs_to' AND r.undone_at IS NULL
       LEFT JOIN entries t ON t.id=r.from_id
       WHERE e.status='active' AND (
         e.title LIKE ? ESCAPE '\\' OR e.current_state LIKE ? ESCAPE '\\'
         OR a.alias LIKE ? ESCAPE '\\' OR u.content LIKE ? ESCAPE '\\'
         OR t.summary LIKE ? ESCAPE '\\' OR t.raw_text LIKE ? ESCAPE '\\'
       )
       ORDER BY e.updated_at DESC LIMIT ?`,
      like, like, like, like, like, like, MAX_SEARCH_RESULTS,
    );
    const events = rows.map(eventSnapshot);
    return {
      toolCallId: call.id,
      name: call.name,
      result: { query, events },
      readEventIds: events.map(event => event.id),
      readTodoIds: [],
    };
  }

  if (call.name === 'get_event') {
    const eventId = requiredString(args, 'event_id');
    const row = await database.getFirstAsync<any>('SELECT * FROM assistant_events WHERE id=?', eventId);
    if (!row || row.status !== 'active') {
      return {
        toolCallId: call.id,
        name: call.name,
        result: { eventId, found: false },
        readEventIds: [],
        readTodoIds: [],
      };
    }
    const [updates, todos, aliases] = await Promise.all([
      database.getAllAsync<any>(
        `SELECT id, content, occurred_at, source_message_id FROM assistant_event_updates
         WHERE event_id=? AND undone_at IS NULL ORDER BY occurred_at DESC, id DESC LIMIT 12`,
        eventId,
      ),
      database.getAllAsync<any>(
        `SELECT t.* FROM assistant_object_relations r JOIN entries t ON t.id=r.from_id
         WHERE r.from_type='todo' AND r.to_type='event' AND r.to_id=?
           AND r.relation_type='belongs_to' AND r.undone_at IS NULL
         ORDER BY t.done ASC, t.due_at IS NULL, t.due_at, t.updated_at DESC LIMIT 50`,
        eventId,
      ),
      database.getAllAsync<{ alias: string }>('SELECT alias FROM assistant_event_aliases WHERE event_id=?', eventId),
    ]);
    return {
      toolCallId: call.id,
      name: call.name,
      result: {
        found: true,
        event: eventSnapshot(row),
        aliases: aliases.map(item => item.alias),
        updates: updates.map(item => ({
          id: item.id,
          content: item.content,
          occurredAt: Number(item.occurred_at),
          sourceMessageId: item.source_message_id ?? null,
        })),
        todos: todos.map(todoSnapshot),
      },
      readEventIds: [eventId],
      readTodoIds: todos.map(todo => todo.id),
    };
  }

  if (call.name === 'search_todos') {
    const query = requiredString(args, 'query');
    const includeDone = args.include_done === true;
    const like = escapedLike(query);
    const rows = await database.getAllAsync<any>(
      `SELECT * FROM entries WHERE kind='task' AND (?=1 OR done=0)
       AND (summary LIKE ? ESCAPE '\\' OR raw_text LIKE ? ESCAPE '\\')
       ORDER BY done ASC, updated_at DESC LIMIT ?`,
      includeDone ? 1 : 0, like, like, MAX_SEARCH_RESULTS,
    );
    const todos = rows.map(todoSnapshot);
    return {
      toolCallId: call.id,
      name: call.name,
      result: { query, includeDone, todos },
      readEventIds: [],
      readTodoIds: todos.map(todo => todo.id),
    };
  }

  const todoId = requiredString(args, 'todo_id');
  const row = await database.getFirstAsync<any>("SELECT * FROM entries WHERE id=? AND kind='task'", todoId);
  if (!row) {
    return {
      toolCallId: call.id,
      name: call.name,
      result: { todoId, found: false },
      readEventIds: [],
      readTodoIds: [],
    };
  }
  const eventRows = await database.getAllAsync<any>(
    `SELECT e.* FROM assistant_object_relations r JOIN assistant_events e ON e.id=r.to_id
     WHERE r.from_type='todo' AND r.from_id=? AND r.to_type='event'
       AND r.relation_type='belongs_to' AND r.undone_at IS NULL AND e.status='active'
     ORDER BY e.updated_at DESC`,
    todoId,
  );
  const events = eventRows.map(eventSnapshot);
  return {
    toolCallId: call.id,
    name: call.name,
    result: { found: true, todo: todoSnapshot(row), events },
    readEventIds: events.map(event => event.id),
    readTodoIds: [todoId],
  };
}

export async function executeAssistantReadTool(
  call: { id: string; name: string; argumentsJson: string },
): Promise<AssistantReadToolExecution> {
  const { withDatabaseConnection } = await import('../db');
  return withDatabaseConnection(database => executeAssistantReadToolWithDatabase(database, call));
}

