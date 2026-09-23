import type { AssistantWebSource } from './types';

export function safeAssistantWebSourceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function assistantWebSourceHost(source: AssistantWebSource): string {
  const safeUrl = safeAssistantWebSourceUrl(source.url);
  if (!safeUrl) return '';
  try {
    return new URL(safeUrl).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function assistantWebSourcesLabel(count: number): string {
  return `搜索来源 ${Math.max(0, Math.floor(count))}`;
}
