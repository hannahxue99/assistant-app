# GitHub CI 与本机 Git 工具链

状态：PR #15 待验收；GitHub `validate` 已连续两次运行通过。

## 产品与工程决策

所有进入 `main` 的 PR 都应自动运行统一的 `npm run ci`。该命令先做 TypeScript 检查，再通过 `npm test` 运行全部业务测试。新增测试必须登记到聚合入口，避免本地与 GitHub 执行集合不一致。CI 通过只代表跨平台代码检查通过，不能替代原生构建、权限、签名和真机验收。

## 本次根因

本机 PATH 首先命中 2016 年遗留的 `/usr/local/bin/git` 2.6.4；可用新版实际是 `/usr/bin/git` 2.50.1。Homebrew 已迁移到 `/opt/homebrew`，但当前没有可执行的 Homebrew Git 链接，因此仅凭“以前安装过 Git”不能判断当前命中的版本。

GitHub workflow 文件比普通代码多要求 OAuth `workflow` scope。`gh api` 已使用带 `repo,workflow` 的新 Token，但 Git push 仍优先调用全局 `osxkeychain`，取得没有 workflow scope 的旧 Token，造成“API 权限正确、push 仍被拒绝”。旧 Git 还会把用于清空 helper 链的空配置误执行为 `git credential-`，反复授权不能解决凭据优先级问题。

## 固定预检与正确处理

1. `command -v git` 与 `git --version`，确认不是 `/usr/local/bin/git` 2.6.4。
2. `gh auth status`，确认登录账户正确且 scopes 含 `repo`、`workflow`。
3. 如需精确确认，用 `gh api -i user` 查看 `X-Oauth-Scopes`，不得输出 Token 本身。
4. 若 API 正常但 push 提示缺少 workflow scope，检查 `credential.helper` 优先级；在本机使用 `/usr/bin/git`，并为该次 push 清空旧 helper 后显式使用 `gh auth git-credential`。
5. 不通过反复网页授权、明文保存 Token 或关闭 GitHub 安全限制绕过问题。

## 验证与回滚

本地 `npm run ci` 通过；PR #15 的 GitHub `validate` 在 Ubuntu/Node 22 干净环境连续运行通过。当前私有仓库套餐调用 Branch Protection API 返回 HTTP 403，要求升级 GitHub Pro 或将仓库公开；在未获得用户对付费/公开的明确授权前，不做这两类外部变更，`AGENTS.md` 规则作为人工门禁。CI 配置无 App、数据库、原生权限或设备影响。回滚 PR 可移除工作流；调整分支保护前先确认不会失去 `main` 的质量门禁。
