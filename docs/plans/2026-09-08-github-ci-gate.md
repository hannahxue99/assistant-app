# GitHub CI 自动门禁方案

## 目标与流程

每次向 `main` 创建或更新 PR，GitHub 自动使用锁定依赖执行 TypeScript 检查及仓库全部测试。任一检查失败时 PR 标红；检查通过后才进入人工验收和合并。代码合入 `main` 后再跑一次，验证主干结果。

`提交 → PR → CI / validate → 人工/真机验收（按变更类型）→ 合并 → main 再验证`

## 实现

- `package.json` 提供唯一的 `npm test` 全量入口和 `npm run ci` 入口，新增测试必须加入该聚合命令。
- `.github/workflows/ci.yml` 在 PR 和 `main` push 时运行，使用 Node.js 22、`npm ci`、Asia/Shanghai 时区。
- 权限仅为 `contents: read`，不读取 API Key、签名证书或用户数据；同一 PR 的过期任务自动取消。
- 项目流程把 `CI / validate` 设为合并 `main` 的必需检查。当前私有仓库套餐不支持 GitHub Branch Protection API，无法机械禁止点击合并，因此先由 PR 流程人工执行；升级 GitHub Pro 或仓库改为公开后再启用平台强制门禁。CI 只能覆盖跨平台 TypeScript/业务测试，不能替代 iOS 签名、原生构建、系统权限和真机验收。

## 验收与回滚

本地运行 `npm run ci` 必须通过；PR 上出现并通过 `CI / validate`。本次已验证 workflow 在 GitHub 干净环境成功运行；因当前套餐限制，不宣称“失败时平台禁止合并”已生效。无 App 代码、schema、权限、Bundle ID 或设备发布影响。

回滚本 PR 可移除自动检查；若只需临时恢复合并，应由仓库管理员调整分支保护，不应通过跳过测试实现。
