/**
 * 全局类型定义 — 与 PRD v1.1 数据模型对齐
 */

/** 条目意图（理解引擎输出） */
export type EntryKind = 'task' | 'idea' | 'info';

/** 理解状态 */
export type ParseStatus = 'pending' | 'ok' | 'failed' | 'manual';

/** 理解来源 */
export type ParseSource = 'rule' | 'llm' | 'manual';

/** 输入来源 */
export type EntrySource = 'text' | 'voice';

/** 条目（数据库行） */
export interface Entry {
  id: string;
  rawText: string;            // 原始口语输入，永存
  kind: EntryKind;            // 意图
  summary: string;            // 规范化标题（理解结果；未理解时等于 rawText）
  dueAt: number | null;       // 截止/提醒时间（ms 时间戳）
  remindAt: number | null;    // 通知提醒时间（通常等于 dueAt）
  topic: string | null;       // 聚合主题；LLM 未成功理解时为空
  tags: string[];             // 主题标签
  persons: string[];          // 人物（P2 启用，先采集）
  parseStatus: ParseStatus;
  parseSource: ParseSource | null;
  correctedFrom: string | null; // 纠正前的理解结果快照（JSON）
  createdAt: number;          // 创建时间（ms）
  updatedAt: number;          // 用户最后修改标题/内容的时间；未修改时等于 createdAt
  revisionAt: number;         // 导出数据最后变化时间；用于备份合并冲突判断
  done: 0 | 1;                // 仅 task 有意义
  doneAt: number | null;
  source: EntrySource;
}

/** 新建条目输入 */
export interface NewEntryInput {
  rawText: string;
  source: EntrySource;
  createdAt?: number;
}

/** 理解引擎结构化输出 */
export interface ParsedEntry {
  kind: EntryKind;
  summary: string;
  dueAt: number | null;
  tags: string[];
  topic: string | null;
  persons: string[];
}

/** 用户画像 */
export interface Profile {
  name: string;
  goals: string[];        // 近期目标（P3 启发用，先采集）
  avoid: string[];        // 想少做的事
  notifyMorning: boolean; // 早 8:00 晨间待办提醒
  notifyEvening: boolean; // 晚 21:00 复盘提示
}

/** 应用设置（LLM 配置） */
export interface Settings {
  llmEnabled: boolean;
  llmBaseUrl: string;     // OpenAI 兼容地址，如 https://api.deepseek.com/v1
  llmKey: string;         // 用户自己的 key，仅存本地
  llmModel: string;       // 模型名
}

/** 主题聚合视图的分组 */
export interface TopicGroup {
  topic: string;
  latest: Entry;          // 最新一条（置顶展示）
  entries: Entry[];       // 倒序时间线
  updatedAt: number;
  pinnedAt: number | null; // 主题级置顶时间；不改写条目本身
}

/** 主题级备份偏好 */
export interface TopicPreference {
  topic: string;
  pinnedAt: number;
}

/** Markdown V2 内嵌的完整恢复数据（不包含 LLM 设置和 Key） */
export interface BackupPayload {
  entries: Entry[];
  profile: Profile;
  topicPreferences: TopicPreference[];
}

export interface BackupEnvelope {
  format: 'assistant-app-export-v2';
  schemaVersion: 2;
  exportedAt: number;
  entryCount: number;
  payload: BackupPayload;
}

/** 记录页筛选条件 */
export interface EntryFilter {
  query: string;          // 全文搜索词
  kind: EntryKind | 'all';
  showDone: boolean;
}
