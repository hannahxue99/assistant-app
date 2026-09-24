import { ASSISTANT_MARKDOWN_CURSOR, parseAssistantMarkdown, safeAssistantMarkdownLink } from '../src/assistant/markdown';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const structured = parseAssistantMarkdown(`## 确认无误的

- 第一条包含 **加粗**
- 第二条包含 [来源](https://example.com/doc)

> 引用内容

\`行内代码\`

\`\`\`ts
const answer = 42;
\`\`\``);

check(structured.children[0]?.type === 'heading', 'Markdown 标题必须解析为结构节点');
const list = structured.children.find(node => node.type === 'list');
check(list?.type === 'list' && list.children.length === 2, '无序列表必须保留项目结构');
const serialized = JSON.stringify(structured);
check(serialized.includes('strong') && serialized.includes('blockquote') && serialized.includes('inlineCode')
  && serialized.includes('"type":"code"') && serialized.includes('"type":"link"'),
  '加粗、引用、代码和链接必须由成熟 parser 解析，不能显示原始标记');

const incomplete = parseAssistantMarkdown('正在流式输出 **尚未闭合', true);
check(JSON.stringify(incomplete).includes(ASSISTANT_MARKDOWN_CURSOR),
  '流式半截 Markdown 必须安全解析并保留独立光标');

check(safeAssistantMarkdownLink('https://example.com/a') === 'https://example.com/a',
  'HTTPS 链接应允许打开');
check(safeAssistantMarkdownLink('http://example.com/a') === 'http://example.com/a',
  'HTTP 链接应允许打开');
check(safeAssistantMarkdownLink('javascript:alert(1)') === null
  && safeAssistantMarkdownLink('file:///etc/passwd') === null
  && safeAssistantMarkdownLink('https://user:password@example.com') === null,
  '脚本、本地文件和带凭据链接必须拒绝');

const html = parseAssistantMarkdown('<script>alert(1)</script>');
check(html.children[0]?.type === 'html', '原始 HTML 必须保持为不可执行节点并由 UI 丢弃');

console.log('assistant markdown tests passed');

