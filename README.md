# 我的助手（assistant-app）

口袋里的外置秘书：**3 秒记下任何事，它比你记得牢、找得到，并逐步学会在对的时刻提醒你。**

口语化输入 → 信息理解（意图/时间/主题）→ 自动归档 → 在对的时刻浮现。
详见 [`PRD.md`](./PRD.md)。

## 功能一览（V1.0）

| 模块 | 说明 |
|---|---|
| 快速记录 | 打开即输入框；文字 + 按住说话转文字（系统语音识别，免费离线） |
| 信息理解 | LLM（OpenAI 兼容，自带 key）做意图/标题/标签/主题判断；本地规则做中文时间归一化；失败自动降级纯规则，**记录永不阻塞** |
| 待办提醒 | 理解出的时间自动挂本地通知；逾期进"该收尾的"区 |
| 今日聚焦 | 今日待办 + 拖延区 + 晨间待办提醒（克制、最多 5 条） |
| 记录检索 | 时间流 + 中文全文搜索（SQLite FTS trigram）+ 主题分组视图（原文不合并、视图聚合） |
| 每日通知 | 早 8:00 按“今天→本周→最近 5 条”提醒；晚 21:00 按“本周剩余→最近 5 条”提醒，可独立开关，全本地 |
| 数据主权 | 纯本地 SQLite；Markdown 可读备份支持导出与合并导入；LLM key 仅存本机 |

## 技术栈

Expo SDK 57（React Native 0.86 / TypeScript）· expo-router · expo-sqlite（FTS5 trigram）· expo-notifications · expo-speech-recognition 56（社区包，需 dev build）

## 目录结构

```
app/(tabs)/        首页(index) · 我的(profile)
app/entry/[id].tsx 用户原声详情页 · app/topic/[name].tsx 主题详情页 · app/settings/llm.tsx 理解引擎子页
src/db.ts          SQLite 数据层（建表/CRUD/FTS/导出）
src/engine/time.ts 中文时间归一化（纯函数，可离线单测）
src/engine/schedule.ts  待办分窗（本周/长期/逾期，纯函数可单测）
src/engine/llm.ts  LLM Provider（OpenAI 兼容：理解 + 文案改写）
src/engine/understand.ts  理解编排：规则 + LLM + 降级链
src/engine/notifications.ts  晨间/夜间待办与到点提醒调度
src/components/    Composer(输入+语音) · EntryCard(条目卡)
design/            设计稿示意图（SVG，嵌入 DESIGN.md）
scripts/           test-time.ts · test-schedule.ts 回归测试
```

---

## 一、在 Mac 上跑起来（三步）

### 第 0 步 · 环境检查（一次性）

- Mac 已装 **Xcode**（App Store）及命令行工具：`xcode-select --install`
- Node ≥ 18、iPhone 与 Mac 连同一 Wi-Fi，数据线连接 iPhone 并信任此电脑

### 第 1 步 · 冒烟验证（**先打通最后一公里，强烈建议**）

> 原则：先用最小代价证明"代码能装到你 iPhone 上"，再谈功能。证书/编译是这个流程最大的坑，早暴露早解决。

```bash
npm install
npx expo run:ios --device
```

- 首次会让你选开发团队（Apple ID 即可，免费 Personal Team）。
- 编译完成后 App 会自动装到 iPhone。首次打开若提示"不受信任的开发者"：
  **设置 → 通用 → VPN与设备管理 → 信任你的 Apple ID**。
- 免费证书 7 天过期，到期重跑一次命令即可（自用完全够）。

能打开看到"今天"页 = 冒烟通过 ✅。之后的迭代 90% 时间不再需要完整编译。

### 第 2 步 · 日常开发（快速预览，大部分功能）

```bash
npx expo start
```

iPhone 装 **Expo Go**（App Store），扫终端二维码即可。改代码秒级热更新。
**注意**：Expo Go 里**语音识别、本地通知不可用**（原生模块），App 内有降级提示不会崩。这两个功能必须在第 1 步的 dev build 里验证。

### 第 3 步 · 完整功能（dev build）

第 1 步编译出的就是 dev client，之后每次 `npx expo start` 时手机打开"我的助手"（而不是 Expo Go），同样享受热更新 + 全部原生能力（语音/通知）。

## 二、配置 LLM 理解（可选但推荐）

App → 我的 → 理解引擎：

1. 打开"启用 LLM 理解"
2. 填入 OpenAI 兼容配置，例如 DeepSeek：
   - API 地址：`https://api.deepseek.com/v1`
   - 模型：`deepseek-chat`
   - Key：你自己的 key（仅存本机，不上传任何服务器）
3. 保存。不配置也能用——自动降级为本地规则理解（时间识别照常工作）。

成本参考：每条记录一次调用 ≈ 300 token，国产模型一年几块钱。

## 三、开发习惯（防踩坑）

```bash
npm run typecheck   # 改完代码跑一遍
npm run test:time   # 动过时间解析后必跑（14 条中文口语回归）
```

- **纯逻辑先上电脑测**：`src/engine/time.ts` 无 RN 依赖，`tsx` 直接跑。新逻辑照此办理。
- **LLM 评测集**：`scripts/` 下按 `test-time.ts` 的模式沉淀真实 case（绘本进度、复合输入、模糊时间），每次改 prompt 跑一遍防漂移。
- **依赖升级单独做**：Expo SDK 与社区库版本对应（speech-recognition 56 ↔ SDK 57），错配会闪退。

## 四、Markdown 备份与恢复

- 在「我的 → 数据管理」中选择「导出数据」，可将 `.md` 文件保存到文件 App、AirDrop 或其他系统分享目标。
- 选择「导入数据」后，App 会先展示新增、更新、忽略和保留本地冲突的数量；确认后才写入数据库。
- 导入采用记录 ID + 内部版本时间合并，不会删除本地独有记录；同一文件可重复导入而不产生重复记录。
- 只有带 `assistant-app-export-v2` 数据胶囊的新版 App 导出文件支持完整恢复。旧版纯展示 Markdown 和任意手写 Markdown 不自动猜测导入。
- 备份包含记录、画像和主题置顶，不包含 LLM Key、接口地址或模型设置。

## 常见问题

| 症状 | 原因与解决 |
|---|---|
| 真机打开闪退/白屏 | 证书过期（免费 7 天）→ 重跑 `npx expo run:ios --device` |
| 语音按钮提示不可用 | 在 Expo Go 里 → 用 dev build 打开 |
| 通知不弹 | 首次需授权；检查"我的→每日提醒"开关；Expo Go 里不支持 |
| LLM 报错降级 | 检查 key/余额/网络；条目会以规则结果保存，不丢数据 |
| 搜索没结果 | 关键词需 ≥3 字符（trigram 限制），过短词用标签筛 |

## 真机调试踩坑存档（2026-08-31 实录）

**红屏 `No script URL provided... unsanitizedScriptURLString = (null)`**

- 含义：dev client（手机上的 app 壳）里没存到 Metro 地址，取不到 JS 代码。**不是代码 bug**。
- 正确姿势：**先在 Mac 起 Metro（`npx expo start`），再打开手机 app**。顺序反了必红屏。
- 只点「Reload JS」无效：URL 是 null 时重载多少次都没用，必须先让它知道地址。

**点 Reload 还是红屏：Mac 在内网，手机路由不到**

- 现象：Metro 明明在跑（`curl localhost:8081/status` 正常），手机就是连不上。
- 原因：Mac 的 IP 是 11.x 企业内网段，手机（家庭 Wi-Fi/5G）路由不到。`ifconfig | grep inet` 可自查，正常家用应是 192.168.x。
- 解法（隧道模式）：
  ```bash
  npm install -g @expo/ngrok        # 一次性
  npx expo start --tunnel --dev-client
  ```
  杀掉手机 app 重开 → 启动页手动输入隧道地址（形如 `https://xxx-8081.exp.direct`）。
- **隧道地址每次重启服务都会变**，连不上先要新地址。

**其他**

- **`expo-dev-client` 必须装**：没装的话 dev build 只是个裸壳——没有启动页、无处手动输入 Metro 地址，红屏 null URL 时无解（2026-08-31 下午红屏反复的根因）。补装：`npx expo install expo-dev-client && npx expo run:ios --device`。
- `--dev-client` 参数：不带时 expo start 默认 Expo Go 模式，语音/通知不可用；跑错模式按 `s` 切换或加参数重启。
- `CI=1 npx expo start` 会禁用 watch 热更新（非交互模式专用，日常别加）。
- `npm run test:time` / `test:schedule` 依赖 `tsx`，未装时 `npx tsx` 会自动提示安装，输 y 即可。
- Metro 是「打包+运送代码的本地服务」：手机 app 只是播放器，代码实时从 Mac 加载；想完全离线运行需打 release 包（内嵌 bundle）。

## 真机调试踩坑存档 · 二（2026-09-01 实录：换图标 / 换 bundle ID / 数据迁移）

**换 App 图标不是热更新——必须重编译**

- 图标是原生资源，`assets/images/icon.png` 改了之后 JS 热更新推不过去，必须 `npx expo run:ios --device` 重新编译安装
- 但注意：先跑 `npx expo prebuild --no-install` 让 Expo 把新 icon 生成到 `ios/app/Images.xcassets/AppIcon.appiconset/`，否则编的还是旧图
- 电脑上验证新旧图标：预览打开 `assets/images/icon.png` 和 `AppIcon.appiconset/App-Icon-1024x1024@1x.png` 对比即可，真机效果只有装上才能确认（圆角/渲染是系统行为）

**`expo prebuild` 会重置签名配置（连环坑）**

- prebuild 重新生成 `ios/app.xcodeproj`，会**丢掉手动改过的 `DEVELOPMENT_TEAM`**（报错 "Signing for app requires a development team"）——需要在 pbxproj 里两处 `PRODUCT_BUNDLE_IDENTIFIER` 前补 `DEVELOPMENT_TEAM = "xxx";`
- prebuild 还会**把 expo-notifications 插件注入的 `aps-environment` entitlements 还原回来**——免费个人账号不支持 Push Notifications，会再次编译失败。每次 prebuild 后都要清空 `ios/app/app.entitlements`（留空 `<dict/>`）
- prebuild 会删掉 `ios/app.xcworkspace`，需要 `cd ios && pod install` 重新生成，之后**必须用 `-workspace` 而不是 `-project` 编译**（xcodeproj 直接编缺 Pods 依赖）
- expo CLI 调 xcodebuild 不带 `-allowProvisioningUpdates`，自动签名报 provisioning profile 错时直接用 xcodebuild 命令编（见下方命令）

**免费账号 bundle ID 被 Apple 抢注，被迫换 ID（两个 App 的由来）**

- 2026-09-01 编译时 Apple 拒绝 `com.anonymous.assistantapp`（Expo 默认前缀，易撞名）："cannot be registered to your development team because it is not available"
- 解法：换成个人化 ID `com.huanxue.assistantapp`，三处同步：`app.json`（ios.bundleIdentifier）+ `ios/app.xcodeproj/project.pbxproj`（两处 PRODUCT_BUNDLE_IDENTIFIER）+ `ios/app/Info.plist`
- 代价：iOS 按 bundle ID 识别 App，**换 ID = 全新 App**，老 App 数据不跟过来 → 才有了后面的数据迁移

**编译命令备忘（绕开 expo CLI 的签名问题）**

```bash
export PATH="/opt/homebrew/bin:$PATH"   # pod 在这，zsh 默认 PATH 没有
xcodebuild -workspace ios/app.xcworkspace -scheme app -configuration Debug \
  -destination 'id=<设备UDID>' -allowProvisioningUpdates build
# DerivedData 里的产物直接 devicectl 安装会被沙箱拒，拷出来再装：
ditto ~/Library/Developer/Xcode/DerivedData/app-*/Build/Products/Debug-iphoneos/app.app /tmp/app-install/app.app
xcrun devicectl device install app --device <UDID> /tmp/app-install/app.app
xcrun devicectl device process launch --device <UDID> com.huanxue.assistantapp
```

- 手机**锁屏会掉线**（devicectl 报 "unable to locate a device"），操作前先解锁
- `devicectl` 报 "Locked" 只是拉不起来，解锁后手动开即可

**新装 App 连不上 Metro：本地网络权限是隐形门槛**

- 现象：老 App 连 Metro 正常，新装的 App 手动输 URL 一直失败——**网络和隧道都没问题**，是 iOS 的「本地网络」权限按 App（bundle ID）单独发放，新 App 没弹过授权窗，连接被静默拦截
- 最省事的解法：数据线连着时从 Mac 用 `devicectl ... launch` 拉起 App（带正确启动参数），绕过手输 URL；首次弹「查找本地设备」授权时点允许
- 规律：**手动打开报 URL 失效、USB 拉起正常** → 就是 App 里存的自动重连地址坏了，USB 拉起一次即修复

**隧道 URL 手输的正确格式：`https://` 开头（2026-09-01 血泪）**

- 新 App 手动输入 Metro 地址时，**必须用 `https://xxx-8081.exp.direct`**（https 开头、无端口尾巴）
- `exp://xxx.exp.direct:80` 格式对 ngrok 隧道**无效**——它会一直报 URL 失效，看起来像网络问题，其实是格式不对。别犯这个错
- 判断 App 是否真的拿到代码：盯 Metro 终端有没有新的 `iOS Bundled ...` 行；没有就是没连上，有就是加载了
- A/B 排查法：同一手机前后脚拉老/新 App，谁不产生 `iOS Bundled` 谁的配置坏了——网络问题会两个都不行，单边不行必是 App 侧
- ngrok 隧道子域名固定（同一台 Mac 不变），所以 `https://69aq7n0-anonymous-8081.exp.direct` 重启 Metro 后依然有效
- 隧道走公网中转首次加载 10~20 秒属正常；Mac 侧 `curl https://xxx.exp.direct/status` 返回 `packager-status:running` 即隧道健康
- USB 直连（iproxy）方案试过不可行：iPhone 的 USB 网络接口（en6）默认无 IP，需要 Mac 开互联网共享才能组网，不值得折腾，隧道 + https:// 地址够用

**老 App → 新 App 数据迁移（bundle ID 换了只能这么搬）**

- 老 App「我的 → 导出数据」生成 Markdown → 微信文件传输（没有 AirDrop 的话）传到 Mac
- 导出格式可完整还原：kind（待办/想法/信息）、原文、理解 summary、主题、标签（顿号分隔）、时间、✅完成状态、createdAt
- 迁移实现：`src/engine/migrate-legacy.ts` 一次性导入，双保险防重跑（`migration_flags` 表标记 + entries 非空跳过），挂在 `_layout.tsx` 启动流程
- 注意：迁移只在**新 App 数据库为空**时执行——先迁移再开始记新内容，顺序反了会静默跳过
- 确认新 App 里 5 条都在、主题聚合正常后再删老 App

**本机环境备注**

- Homebrew 装了两份：`/opt/homebrew`（ARM，正常使用中，pod 在这）+ `/usr/local`（坏掉的 Intel 残留，不影响，别用）
- zsh 默认 PATH 不含 `/opt/homebrew/bin`，脚本里要手动 `export PATH="/opt/homebrew/bin:$PATH"`

## iPhone 免费签名与独立运行存档（2026-09-02）

### 先分清 Debug 和 Release

| 安装方式 | 命令 | 是否依赖 Mac / Metro | 适用场景 |
|---|---|---|---|
| 开发版（Debug） | `npx expo run:ios --device` | 运行代码时依赖 Metro | 日常开发、热更新、排查问题 |
| 独立版（Release） | `npx expo run:ios --configuration Release --device` | 不依赖 Metro，JS Bundle 已内嵌 | 自己或家人日常试用 |

Release 版安装成功后可以关闭终端、断开数据线和关闭 Mac。App 的记录存在手机本地 SQLite，不依赖 Mac；LLM 会直接请求配置的 DeepSeek/OpenAI 兼容地址，因此使用 LLM 时仍需联网。

### 免费 Personal Team 的完整安装流程

1. 用数据线连接 iPhone，解锁并点击“信任此电脑”。
2. iPhone 打开 **设置 → 隐私与安全性 → 开发者模式**；首次开启需要重启并再次确认。
3. Xcode 打开 **Window → Devices and Simulators**，等待设备准备完成。
4. 在项目根目录安装独立版：

   ```bash
   npx expo run:ios --configuration Release --device
   ```

5. 选择目标 iPhone，安装过程中保持手机解锁。
6. 安装完成后关闭 Metro/Mac，用手机单独打开 App 验证；LLM 联网测试不要开飞行模式。

如果 Expo CLI 自动签名失败，打开 `ios/app.xcworkspace`，在 **app → Signing & Capabilities** 中确认：

- `Automatically manage signing` 已开启
- `Team` 仍是原来的 Personal Team
- Bundle Identifier 仍是 `com.huanxue.assistantapp`
- Scheme/Configuration 选择 app/Release，目标设备选择已连接的 iPhone

### 7 天到期后的续签流程

免费 Apple Account 的 Personal Team 描述文件签发后 7 天过期。到期后 App 通常仍在桌面，但会打不开或提示不可用。续签时：

1. **不要卸载手机上的旧 App**。
2. 连接、解锁 iPhone。
3. 使用原来的 Apple ID / Personal Team，在项目根目录重新执行：

   ```bash
   npx expo run:ios --configuration Release --device
   ```

4. 直接覆盖安装，获得新的约 7 天有效期。

使用相同 Team 和 Bundle Identifier 覆盖安装时，本地数据通常会保留；但重要记录仍建议先在 **我的 → 导出数据** 导出 Markdown。删除 App 会删除它的 SQLite 数据，改 Bundle Identifier 则会被 iOS 当成另一个全新 App。

Apple Personal Team 当前限制包括：描述文件 7 天过期、每个平台最多 3 台测试设备、同时注册的 App ID 有限。官方说明：<https://developer.apple.com/support/compare-memberships/>。

### 设备连接与构建常见坑

**`Developer Disk Image is not mounted` / `Development services need to be enabled`**

- 这发生在编译前，不是项目代码错误。
- 保持 iPhone 解锁，确认已信任 Mac 并开启开发者模式。
- 打开 Xcode 的 **Devices and Simulators**，等待 `Preparing device` / Developer Disk Image 挂载结束。
- 如果 `CoreDeviceService`、`simdiskimaged` 仍超时：拔插数据线，重启 iPhone 与 Mac，再先打开 Xcode 等设备就绪。
- iPhone 系统版本高于 Xcode 支持范围时，需要升级 Xcode。

**显示 `Build Succeeded`、`Complete 100%` 后怎么判断成功**

- Debug 版出现 `Waiting on http://localhost:8081` 是在等待 Metro，终端必须保持运行。
- Release 版不会依赖这个地址；断开 Mac 后仍能打开才算独立运行验证通过。
- `[Expo Dev Launcher] Strip Local Network Keys for Release` 一类 Build Phase warning 通常不影响安装。

**签名和能力限制**

- 免费 Personal Team 不支持远程 Push Notifications；本项目使用的本地提醒不等同于远程推送。
- `expo prebuild` 可能重新生成签名配置和 entitlements，非必要不要运行；确需运行时按上文“真机调试踩坑存档 · 二”恢复 Team、workspace 和 entitlements。
- `eas update` 或 JS 热更新不能延长免费签名有效期；7 天到期仍必须重新签名覆盖安装。

### 给家人安装时的现实限制

- 每台 iPhone 都要连接这台 Mac、信任电脑、开启开发者模式并安装一次。
- 每约 7 天，每台手机都要重新连接并覆盖安装。
- 不要让家人自行删除旧 App；先导出数据再处理异常安装。
- 每台手机拥有独立 SQLite 数据库，不会自动互相同步。
- 每台手机需要单独配置 LLM API Key；共用同一个 Key 会共用额度和费用，也增加泄露风险。
- 免费签名适合短期家庭试用，不适合长期无维护分发。想减少维护需使用付费 Apple Developer Program，通过 TestFlight 或 App Store 分发；TestFlight 每个构建最多测试 90 天。

### 不要误判为解决方案

- 只停止 Metro：Debug 版会失去代码来源，不会自动变成独立版。
- 把开发版留在手机里：不能绕过 7 天签名过期。
- AltStore/SideStore：免费 Apple ID 仍需要周期性刷新签名，不是一次安装永久使用。
- 换 Bundle Identifier：只会生成新 App，并造成原 App 的本地数据无法自动继承。
- 删除再重装：可能解决安装表象，但会直接丢失本机记录，应作为最后手段且必须先导出。

---

## 迭代路线（对应 PRD）

- **P1（当前）**：待办/提醒 + 理解归档 → 用 2 周、攒 50 条记录
- **P2**：知识库（主题演化、语义搜索、画像沉淀）
- **P3**：启发引擎四种触发 + LLM 深度分析（现在可用"导出 Markdown → 发给 AI"代替）
