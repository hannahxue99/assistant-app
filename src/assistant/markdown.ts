import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Root } from 'mdast';

import { safeAssistantWebSourceUrl } from './web-source-ui';

export const ASSISTANT_MARKDOWN_CURSOR = '\uE000';

/** Parse the model's stored Markdown without enabling raw HTML execution. */
export function parseAssistantMarkdown(content: string, streaming = false): Root {
  const source = streaming ? `${content}${ASSISTANT_MARKDOWN_CURSOR}` : content;
  return fromMarkdown(source);
}

export function safeAssistantMarkdownLink(value: string): string | null {
  return safeAssistantWebSourceUrl(value);
}

