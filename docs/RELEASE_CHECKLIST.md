# 上线检查与记录模板

每次准备合并已验收 PR 时复制本模板，并把结果写入 PR 或对应知识文档。

## 需求范围

- 目标：
- 最终产品决策：
- 非目标：

## 代码版本

- PR：
- 分支：
- 合并提交：
- 回滚点：
- 关联或被替代 PR：

## 自动验证

- TypeScript：
- 自动化测试：`通过数/总数`
- iOS bundle/export：
- 原生编译：`不需要 / 已通过`

## 发布前原生工具预检

- 本次是否触发干净 prebuild 或 Hermes 源码构建：
- 是否通过 `npm run ios:release` 固定工具链预检：
- 固定 `CMAKE_BINARY` 路径：`~/.local/share/assistant-app/toolchains/cmake-3.31.8-macos-universal/CMake.app/Contents/bin/cmake`
- CMake 版本：`3.31.8`
- 未绕过预检、未回退 `/usr/local/bin/cmake`：

## 真机验收

- 设备与系统：
- 构建类型：`私人助手 Dev / 私人助手 Release`
- App 身份：`com.huanxue.assistantapp.dev / com.huanxue.assistantapp`
- 更新方式：`Reload / 覆盖安装 / 正式分发`
- 已验证场景：
- 未验证场景：

## 数据与兼容性

- 原生依赖或权限变化：
- 生产 Bundle ID 是否仍为 `com.huanxue.assistantapp`：
- Dev/Release 数据隔离是否验证：
- 数据库迁移：
- 数据备份与丢失风险：

## 收口

- 用户验收：
- 遗留风险：
- 设计/测试文档：
- 知识库与基础规则：
- 手机是否已运行合并后的 `main`：
