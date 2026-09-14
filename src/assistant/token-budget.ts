/**
 * 模型无关的保守 Token 估算。中文字符通常接近一个或略多于一个 token；
 * 拉丁字母、数字和标点按约四个字符一个 token 计算。它只用于硬预算裁剪，
 * 不用于展示精确用量。
 */
export function estimateAssistantTokens(text: string): number {
  if (!text) return 0;
  const cjk = text.match(/[\u3400-\u9fff\uf900-\ufaff]/g)?.length ?? 0;
  const other = text.length - cjk;
  return Math.ceil(cjk * 1.15 + other / 4);
}

export function truncateToAssistantTokenBudget(text: string, budget: number): string {
  if (budget <= 0) return '';
  if (estimateAssistantTokens(text) <= budget) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (estimateAssistantTokens(text.slice(0, middle)) <= Math.max(1, budget - 1)) low = middle;
    else high = middle - 1;
  }
  return `${text.slice(0, low).trimEnd()}…`;
}
