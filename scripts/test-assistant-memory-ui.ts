import { canSaveMemoryEdit, memorySectionState } from '../src/assistant/memory-ui';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

check(memorySectionState({ loadedOnce: false, loading: true, error: false, memoryCount: 0 }) === 'loading', '首次加载显示骨架');
check(memorySectionState({ loadedOnce: false, loading: false, error: true, memoryCount: 0 }) === 'error', '首次失败显示区域错误');
check(memorySectionState({ loadedOnce: true, loading: true, error: false, memoryCount: 0 }) === 'empty', '后台刷新不应把已渲染区域替换成骨架');
check(memorySectionState({ loadedOnce: true, loading: false, error: false, memoryCount: 2 }) === 'ready', '有记忆时显示列表');
check(!canSaveMemoryEdit('不喜欢早会', '  不喜欢早会  ', false), '没有实质变化时不能保存');
check(canSaveMemoryEdit('不喜欢早会', '上午不安排会议', false), '有效修改可以保存');
check(!canSaveMemoryEdit('不喜欢早会', '上午不安排会议', true), '忙碌时不能重复保存');

console.log('assistant memory UI state tests passed');
