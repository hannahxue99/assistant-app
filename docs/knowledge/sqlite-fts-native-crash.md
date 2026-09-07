# SQLite FTS5 连接关闭原生闪退

## 证据与结论

2026-09-07 手机日志确认 com.huanxue.assistantapp 在 expo.module.sqlite.AsyncQueue 发生 EXC_BAD_ACCESS / SIGSEGV。栈包含 SQLiteModule.closeDatabase、sqlite3Fts5IndexClose、exsqlite3_finalize。

模型回填新增的独占事务在完成后关闭临时连接，触发 FTS5 清理路径。Expo 57.0.2 默认先枚举释放所有未关闭语句，然后关闭 SQLite；结合栈推断，提前释放 FTS5 内部语句造成重复清理风险。崩溃位置已确认，具体内存释放机制未做底层内存工具证明。

## 修复与复用规则

打开数据库时设置 finalizeUnusedStatementsBeforeClosing:false；独占事务继承该选项。索引内部资源由 SQLite 管理，runAsync/getFirstAsync/getAllAsync 仍自行释放业务语句。保留事务、搜索索引和记录原子更新，不以移除事务掩盖崩溃。

以后新增 prepareAsync/prepareSync，必须用 finally 显式 finalize。该选项在当前版本类型及原生实现存在，但标记为隐藏选项；升级 Expo 时需重新检查其支持情况及原生回归。

globalThis 保存已有连接，修改连接选项必须完整 Reload；Fast Refresh 不足。原生 SIGSEGV 无法通过 JavaScript try/catch 捕获。

## 测试盲区与验证

Node 内存 SQLite 的事务适配器不执行 Expo 创建/关闭原生连接的流程，因此先前测试通过也无法证明 iOS 不崩溃。需把原生连接生命周期纳入设备验收。

本次类型检查、内存 SQLite 集成测试（增加连接选项断言）、通知隔离及 iOS export 通过。自动手机调试测试因无执行响应未完成，不计入通过项。

用户在完整 Reload 和输入/编辑验收指引后回复“验证无异常，上线”；按用户反馈记录真机验收通过，未虚构重复次数。

## 发布记录

- 日期：2026-09-07。
- PR：https://github.com/hannahxue99/assistant-app/pull/12；功能提交092d660。
- 设备：huan-iphone17 / iPhone 17，USB已连接；历史记录iOS 26.6.1，本次未重新读取系统版本；Debug Dev Client。
- 无新原生依赖、权限、Bundle ID 或 schema；完整 Reload 生效，无需重装，不删除用户记录。
- 用户明确验收通过并授权上线；最终main同步后手机运行版本不由合并操作证明。
- 回滚点：b468b9b。回退此PR可能重新引入原生闪退，不建议以回退作为常规恢复措施。
- 沿用 AGENTS.md 发布流程，知识索引新增本专题。
