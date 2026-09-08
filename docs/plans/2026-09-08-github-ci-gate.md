# GitHub CI 自动门禁方案

## 目标与流程

每次向 `main` 创建或更新 PR，GitHub 自动使用锁定依赖执行 TypeScript 检查及仓库全部测试。任一检查失败时 PR 标红；检查通过后才进入人工验收和合并。代码合入 `main` 后再跑一次，验证主干结果。

`提交 → PR → CI / validate → 人工/真机验收（按变更类型）→ 合并 → main 再验证`

## 实现

- `package.json` 提供唯一的 `npm test` 全量入口和 `npm run ci` 入口，新增测试必须加入该聚合命令。
- `.github/workflows/ci.yml` 在 PR 和 `main` push 时运行，使用 Node.js 22、`npm ci`、Asia/Shanghai 时区。
- 权限仅为 `contents: read`，不读取 API Key、签名证书或用户数据；同一 PR 的过期任务自动取消。
- GitHub 分支保护把 `CI / validate` 设为 `main` 必需检查。CI 只能覆盖跨平台 TypeScript/业务测试，不能替代 iOS 签名、原生构建、系统权限和真机验收。

## 验收与回滚

本地运行 `npm run ci` 必须通过；PR 上出现并通过 `CI / validate`。再使用一个临时失败验证门禁会阻止合并，恢复后重新变绿。无 App 代码、schema、权限、Bundle ID 或设备发布影响。

回滚本 PR 可移除自动检查；若只需临时恢复合并，应由仓库管理员调整分支保护，不应通过跳过测试实现。
