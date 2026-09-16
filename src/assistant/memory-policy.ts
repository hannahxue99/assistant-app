import type { AssistantMemory } from './memory-types';

export function normalizeMemoryContent(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s，。！？、；：,.!?;:'"“”‘’（）()【】\[\]_-]+/g, '');
}

export function memoryEvidenceAppearsInUserMessage(evidence: string, userMessage: string): boolean {
  const compact = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  const needle = compact(evidence);
  return needle.length > 0 && compact(userMessage).includes(needle);
}

/** 只拦确定的凭证类秘密；其他敏感性仍由模型判断并走明确确认。 */
export function containsForbiddenMemorySecret(value: string): boolean {
  const text = value.normalize('NFKC');
  return /验证码|动态口令|短信码|支付密码|登录密码|密码\s*(?:是|为|[:：])|身份证(?:号|号码)?\s*[:：]?\s*\d{8,}|(?:银行卡|卡号|账号)\s*[:：]?\s*\d{10,}/i.test(text);
}

export function isDuplicateLiveMemory(content: string, memories: AssistantMemory[]): boolean {
  const normalized = normalizeMemoryContent(content);
  return memories.some(memory => (
    (memory.status === 'candidate' || memory.status === 'active')
    && memory.normalizedContent === normalized
  ));
}
