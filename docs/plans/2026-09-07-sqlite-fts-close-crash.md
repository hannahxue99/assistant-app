# 输入后原生闪退修复

## 证据

2026-09-07 12:23 手机日志：com.huanxue.assistantapp，EXC_BAD_ACCESS/SIGSEGV；触发线程 expo.module.sqlite.AsyncQueue。
栈：SQLiteModule.closeDatabase → exsqlite3_close → FTS5 disconnect → sqlite3Fts5IndexClose → exsqlite3_finalize。

Expo SQLite 57.0.2 本地源码：withExclusiveTransactionAsync 新建连接，finally closeAsync；事务复制父连接 options。iOS closeDatabase 在 sqlite3_close 前调用 maybeFinalizeAllStatements，默认枚举所有语句；这可能提前释放 FTS5 内部持有的语句，导致其关闭时重复释放。崩溃点确定，重复释放机制为源码与日志支持的判断。

## 修复

openDatabaseAsync 设置 finalizeUnusedStatementsBeforeClosing:false。保留独占事务及索引原子更新；runAsync/getFirstAsync/getAllAsync 自行 finalize 业务语句，SQLite 自己管理 FTS5 内部资源。不改动 node_modules，不升级原生模块，不修改用户数据或 schema。

连接缓存在 globalThis，必须完整 Reload 才能应用新 options，仅 Fast Refresh 不足。以后新增手写 prepareAsync 时必须 finally finalizeAsync。

## 验证与发布

内存 SQLite 测试新增连接选项断言，同时运行原有索引/事务/编辑测试。该测试不能复现 Expo iOS 的释放错误；须在手机上反复输入、等待模型返回、编辑正文并确认不再退出。另用独立测试库重复执行 FTS5 写入和独占事务关闭，避免污染个人数据库。

无 UI 变更，无需新设计稿。独立分支 codex/fix-sqlite-fts-close，PR交付，真机验收后合并。回滚本PR恢复默认选项，但可能重新引入闪退；不要用卸载或清空数据库处理此故障。
