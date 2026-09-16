# Dev / Release 双版本设计

## 决策

同一套业务代码生成两个可同时安装的 App：

| 变体 | 桌面名称 | iOS Bundle ID | URL Scheme | 代码来源 | 数据容器 |
| --- | --- | --- | --- | --- | --- |
| Dev | 私人助手 Dev | `com.huanxue.assistantapp.dev` | `assistantapp-dev` | Metro | Dev 独立 SQLite |
| Release | 私人助手 | `com.huanxue.assistantapp` | `assistantapp` | Release 内嵌 Bundle | 延续现有 Release SQLite |

Release 的名称、Bundle ID 和 Scheme 保持不变。正式发布不是把 Dev 二进制“转成”Release，而是使用同一提交重新生成生产配置的 Release 二进制；iOS 因生产 Bundle ID 不变而升级现有 App，并保留其数据容器。Dev 数据不迁移到 Release，删除 Dev 也不影响 Release。

## 方案选择

采用 Expo 官方推荐的动态 App Config：由 `APP_VARIANT=development|production` 在配置解析阶段选择身份。保留静态 `app.json` 作为基础配置，新增 `app.config.ts` 覆盖变体字段。

未采用以下方案：

- Xcode Debug/Release 手工配置不同 Bundle ID：本项目的 `ios/` 由 Prebuild 生成且不入库，重新生成会丢失手工配置。
- 复制两套 Expo 项目：业务代码、依赖和数据库迁移容易漂移。

## 构建与数据流

1. Dev 构建显式设置 `APP_VARIANT=development`，Prebuild 生成 `.dev` Bundle ID、Dev Scheme、Dev 名称和 Dev 图标。
2. Dev App 从 Metro 加载当前 JavaScript，系统为 `.dev` Bundle ID 分配独立沙盒与 SQLite。
3. Release 构建显式设置 `APP_VARIANT=production`，Prebuild 恢复现有生产身份并把 JavaScript Bundle 内嵌。
4. 新 Release 覆盖升级旧 Release；已有数据库仍由应用自身的数据库迁移逻辑升级。
5. 两个变体不共享数据库、偏好、通知授权、日历授权或开发服务器记录。

## 原生配置原则

- `ios.appleTeamId` 写入 App Config，避免 Prebuild 后手工补签名 Team。
- 当前产品只使用本地通知；用配置插件稳定移除 Personal Team 不支持的远程推送 entitlement，避免每次 Prebuild 后手工清理。
- `expo-dev-client` 的自动 Scheme 仅对 Dev 开启，避免开发二维码误唤起 Release。
- 每次切换变体都先执行干净 Prebuild，因为已有原生目录不会自动可靠同步 App Config。
- 不引入 EAS Build；当前继续使用本机构建，保持范围最小。以后接入 EAS 时再增加对应 profile。

## 边界与失败处理

- 未设置 `APP_VARIANT` 时默认生产配置，保证现有命令和发布身份不被意外改名。
- 设置未知值时配置解析立即失败，阻止生成身份不明确的安装包。
- Dev 首次安装需要注册新的 App ID、独立授予本地网络/通知/日历权限，并受 Personal Team 七天签名有效期限制。
- 删除或重装 Release 会删除其 SQLite；正式覆盖安装前仍须导出备份。
- 如果数据库迁移失败，应停止发布并回滚到上一个 Release 提交；不得用 Dev 数据替换生产数据。

## 验收标准

1. `expo config` 在两个变体下输出预期名称、Bundle ID、Scheme 和图标。
2. 未知变体配置失败，自动化测试已加入聚合 `npm test`。
3. 干净 Prebuild 后，Dev 与 Release 原生工程分别包含正确 Bundle ID、签名 Team 和 entitlement。
4. 两个 App 同时安装在同一 iPhone；Dev 的图标/名称可明确辨认。
5. Metro 改动只在 Dev 出现；Release 断开电脑仍正常启动。
6. 使用新 Release 覆盖旧 Release 后，旧记录、待办、事件和记忆仍存在。
7. 删除 Dev 后，Release 及其数据不受影响。
8. `npm run ci` 和 GitHub `CI / validate` 通过。

## 回滚点

回滚本变更的独立提交即可恢复单一生产身份。回滚代码不会删除手机上的 Dev App；需要用户手工删除 `com.huanxue.assistantapp.dev`。生产 Bundle ID 从未改变，因此 Release 数据无需迁移或回滚。
