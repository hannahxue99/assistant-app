import {
  containsForbiddenMemorySecret,
  memoryEvidenceAppearsInUserMessage,
  normalizeMemoryContent,
} from '../src/assistant/memory-policy';
import { selectMemoryContext } from '../src/assistant/memory-context';
import type { AssistantMemory } from '../src/assistant/memory-types';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

check(normalizeMemoryContent('  不喜欢，早会。 ') === normalizeMemoryContent('不喜欢早会'),
  '记忆规范化应忽略空白和常见标点');
check(memoryEvidenceAppearsInUserMessage('我不喜欢早会', '对了， 我不喜欢早会，以后尽量别排。'),
  '证据必须可以在本轮用户原话中定位');
check(!memoryEvidenceAppearsInUserMessage('用户不喜欢早会', '我不喜欢早会'),
  '模型改写后的推断不能冒充用户原话证据');
check(containsForbiddenMemorySecret('登录密码是 abc123'), '明确密码必须被本地拦截');
check(containsForbiddenMemorySecret('银行卡号：6222021234567890'), '完整金融账号必须被本地拦截');
check(!containsForbiddenMemorySecret('我不喜欢早会'), '普通稳定偏好不应被误拦截');

function memory(id: string, content: string, updatedAt: number): AssistantMemory {
  return {
    id,
    category: 'recurring_pattern',
    content,
    normalizedContent: content,
    status: 'active',
    sensitivity: 'ordinary',
    admissionBasis: 'explicit',
    supersededById: null,
    revision: 1,
    createdAt: updatedAt,
    updatedAt,
    activatedAt: updatedAt,
    supersededAt: null,
    forgottenAt: null,
  };
}

const selected = selectMemoryContext('把例假周期的长期记忆删除', [
  memory('memory-cycle', '用户有例假周期，最近一次9月18日来例假', 10),
  memory('memory-meeting', '用户不喜欢早会', 20),
], []);
check(selected.active.some(item => item.id === 'memory-cycle'), '相关活动记忆应进入上下文');
check(!selected.active.some(item => item.id === 'memory-meeting'), '零相关活动记忆不应默认污染上下文');

console.log('assistant memory policy tests passed');
