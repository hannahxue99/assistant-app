/**
 * LLM Provider — OpenAI 兼容协议（DeepSeek / 通义千问 / Kimi / OpenAI 通用）
 * 职责：口语输入 → 结构化理解（意图/规范化标题/标签/主题/人物）
 */
import type { ParsedEntry, Settings } from '../types';

export interface LlmProviderConfig {
  baseUrl: string;
  key: string;
  model: string;
  /** 近180天最多100个活跃主题，用于"新话题 or 已有主题更新"判断 */
  activeTopics?: { topic: string; count: number; latestText: string }[];
}

/** 理解失败时抛错，由上层降级链处理 */
export class LlmError extends Error {}

/**
 * 调用 LLM 理解一条口语输入。
 * @returns 结构化的 ParsedEntry（未包含 dueAt，由规则层填充）
 */
export async function understandWithLlm(
  rawText: string,
  cfg: LlmProviderConfig,
  signal?: AbortSignal,
): Promise<Omit<ParsedEntry, 'dueAt'>> {
  if (!cfg.key) throw new LlmError('未配置 API Key');

  const topicsCtx = (cfg.activeTopics ?? [])
    .slice(0, 100)
    .map((t) => `- ${t.topic}（${t.count}条，最近："${t.latestText.slice(0, 30)}"）`)
    .join('\n');

  const system = [
    '你是个人助手的"信息理解"引擎，负责把用户极其口语化的随手记，整理成结构化数据。',
    '严格只输出 JSON，不要任何解释、代码块标记或额外文字。',
    '',
    '输出 JSON 结构：',
    '{',
    '  "kind": "task" | "idea" | "info",   // task=要办的事/待办；idea=灵感/随想/情绪；info=需要记住的信息/知识',
    '  "summary": "规范化标题，中文，一句话，去除废话但保留关键对象。标题中的时间必须写具体日期，用中文格式（如今天2026-09-01，则明天写9月2日、下周六写9月5日），不要写成9/2这类斜杠格式，也不要用"明天""下周"等相对词",',
    '  "tags": ["标签1","标签2"],            // 1-3 个概括性主题标签，不要用过于宽泛的词',
    '  "topic": "聚合主题",                  // 必填，见下方说明',
    '  "persons": ["人名"]                    // 提到的人，没有则空数组',
    '}',
    '',
    'topic 规则：这是"状态型信息"归属。',
    '下面是用户近180天内最近活跃的最多100个聚合主题：',
    topicsCtx || '（无历史主题）',
    '若本条输入与某个已存在主题明显是同一件事的延续/更新（如"学到第50本绘本"命中"孩子英语学习"），则 topic 填那个主题的**原样名称**；',
    '若没有匹配的已有主题，则必须新建一个简洁、具体、可复用的主题名；',
    '每条记录都必须有 topic，包括一次性待办和普通信息，禁止返回 null 或空字符串。',
    '',
    '时间不要在这里判断，由本地规则层处理。',
  ].join('\n');

  const user = `请理解这条随手记：\n"${rawText}"`;

  const body = {
    model: cfg.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.2,
    response_format: { type: 'json_object' },
  };

  const url = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.key}`,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e: any) {
    throw new LlmError(`网络请求失败：${e?.message ?? '未知错误'}`);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new LlmError(`LLM 接口错误 ${res.status}: ${errText.slice(0, 200)}`);
  }

  let data: any;
  try {
    data = await res.json();
  } catch {
    throw new LlmError('响应解析失败');
  }

  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new LlmError('LLM 返回为空');

  const parsed = parseJson(content);
  if (!parsed) throw new LlmError('LLM 输出不是合法 JSON');

  return normalize(parsed);
}

function parseJson(content: string): any {
  try {
    return JSON.parse(content);
  } catch {
    // 容忍被 ```json ``` 包裹
    const m = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) {
      try {
        return JSON.parse(m[1]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalize(raw: any): Omit<ParsedEntry, 'dueAt'> {
  const kind = raw.kind === 'task' ? 'task' : raw.kind === 'idea' ? 'idea' : 'info';
  const summary = (typeof raw.summary === 'string' && raw.summary.trim()) ? raw.summary.trim() : '未命名';
  const tags = Array.isArray(raw.tags)
    ? raw.tags.filter((t: any) => typeof t === 'string' && t.trim()).slice(0, 3).map((t: string) => t.trim())
    : [];
  if (typeof raw.topic !== 'string' || !raw.topic.trim()) {
    throw new LlmError('LLM 未返回有效主题');
  }
  const topic = raw.topic.trim();
  const persons = Array.isArray(raw.persons)
    ? raw.persons.filter((p: any) => typeof p === 'string' && p.trim()).slice(0, 5).map((p: string) => p.trim())
    : [];
  return { kind, summary, tags, topic, persons };
}

/**
 * AI 编辑：按指令改写一段文案（主题详情页原地编辑用）。
 * 只返回改写后的纯文本；失败抛 LlmError 由 UI 提示。
 */
export async function rewriteWithLlm(
  text: string,
  instruction: string,
  cfg: Pick<LlmProviderConfig, 'baseUrl' | 'key' | 'model'>,
  signal?: AbortSignal,
): Promise<string> {
  if (!cfg.key) throw new LlmError('未配置 API Key');

  const body = {
    model: cfg.model,
    messages: [
      {
        role: 'system',
        content:
          '你是文案改写助手。按用户的指令改写给定文案，保持事实不变、中文、口语自然。' +
          '严格只输出改写后的文本本身，不要解释、不要引号、不要任何额外内容。',
      },
      { role: 'user', content: `改写要求：${instruction}\n\n原文：\n${text}` },
    ],
    temperature: 0.4,
  };

  const url = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e: any) {
    throw new LlmError(`网络请求失败：${e?.message ?? '未知错误'}`);
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new LlmError(`LLM 接口错误 ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json().catch(() => null);
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) throw new LlmError('LLM 返回为空');
  return content;
}
