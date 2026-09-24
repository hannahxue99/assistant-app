# Release 固定 CMake 工具链设计

## 背景

iOS Release 的干净 Prebuild 会重新生成 Pods，并可能触发 Hermes 原生构建。React Native 0.86 的 Hermes 脚本使用 `cmake -S/-B`，而本机默认 `/usr/local/bin/cmake` 仍是 3.5.2，无法正确解析这些参数。这个问题已经在两次 Release 流程中被重新发现，说明仅在知识文档中记录临时 `CMAKE_BINARY` 不足以阻止复发。

本次已用 Kitware CMake 3.31.8 成功完成 `BUILD SUCCEEDED`、正式 Bundle ID 覆盖安装和启动核验。用户明确要求不自动下载，直接固定使用这份已验证工具。

## 目标与非目标

目标：

- 把已验证的 CMake 3.31.8 从易清理的 `/private/tmp` 复制到用户目录下的持久路径。
- `npm run ios:release` 在任何 Prebuild 或原生写操作前校验固定路径和版本。
- Release 构建始终显式传递 `CMAKE_BINARY`，不再回退到 `/usr/local/bin/cmake`。
- 缺失、不可执行、无法读取版本或版本不符时立即失败，并给出唯一修复路径。

非目标：

- 不自动下载或升级 CMake。
- 不修改系统 `/usr/local/bin/cmake`、Homebrew 或全局 `PATH`。
- 不改变 Dev 构建、App Bundle ID、数据库或设备安装行为。

## 设计

固定工具链路径由用户主目录动态推导，避免把用户名写入仓库：

```text
~/.local/share/assistant-app/toolchains/
  cmake-3.31.8-macos-universal/
    CMake.app/Contents/bin/cmake
```

新增 `scripts/ios-release.cjs` 作为唯一 Release 入口。它先计算固定路径，检查文件存在且可执行，再运行 `cmake --version` 并要求首行严格为 `cmake version 3.31.8`。校验成功后，它使用同一份环境依次运行 Expo SDK 57 的干净 iOS Prebuild 和现有 `ios-device-build.cjs production`。因此 Prebuild、CocoaPods、Hermes、Xcode Build Phase 都能读取相同的 `CMAKE_BINARY`。

```text
npm run ios:release
        │
        ▼
固定路径存在且可执行？──否──► 立即失败，不执行 Prebuild
        │是
        ▼
版本严格为 3.31.8？────否──► 立即失败，不回退旧版本
        │是
        ▼
注入 APP_VARIANT=production + CMAKE_BINARY
        │
        ├──► Expo Prebuild --clean
        └──► ios-device-build.cjs production
```

## 错误处理与边界

- 固定目录被系统或用户删除：命令在清理 `ios/` 前失败，提示从可信备份恢复到固定位置。
- 路径存在但不是可执行文件：失败，不尝试 `PATH` 或其他候选路径。
- 版本输出异常或版本不是 3.31.8：失败并同时展示期望版本、实际路径和实际输出。
- 子进程失败：保留原退出码；不继续后续阶段。
- `CMAKE_BINARY` 外部环境变量被设置为其他值：Release 入口覆盖为项目固定路径，避免会话环境漂移。

## 验收标准

1. 固定路径中的 CMake 输出 3.31.8。
2. 单元测试覆盖路径推导、正确版本、缺失、不可执行、错误版本和子进程中止。
3. `npm run ios:release` 只调用新的受控入口，且测试确认不会直接拼接 Expo 命令。
4. 新测试加入聚合 `npm test`，`npm run ci` 通过。
5. Release 工作流、检查表、项目 Skill 和知识文档明确固定路径与“禁止回退”规则。
6. PR 合并前保持正式 App、系统 CMake 和用户生产数据不变；本变更只改发布工具链。
