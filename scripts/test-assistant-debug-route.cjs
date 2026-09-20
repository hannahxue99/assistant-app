const assert = require('node:assert/strict');
const fs = require('node:fs');

// 调试页守卫：决策日志调试工具只能存在于开发构建，不进入用户可见导航。
const assistantScreenSource = fs.readFileSync('app/(tabs)/assistant.tsx', 'utf8');
assert.ok(assistantScreenSource.includes("'/debug/decisions'")
  && assistantScreenSource.includes('{__DEV__ ? ('),
  '决策日志调试入口必须包在 __DEV__ 内，生产构建不得出现');
assert.ok(!assistantScreenSource.includes('debug/decisions\'') || assistantScreenSource.includes('{__DEV__ ? ('),
  '调试入口出现时必须有 __DEV__ 守卫');

const debugScreenSource = fs.readFileSync('app/debug/decisions.tsx', 'utf8');
assert.ok(debugScreenSource.includes('getAssistantDecisionLog'),
  '调试页必须读取决策日志以支持设备端回溯');
console.log('assistant debug route guard tests passed');
