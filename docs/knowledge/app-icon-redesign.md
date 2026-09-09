# App 图标重设计「一勾即安 · 远处三行」

## 产品决策

- 定稿形体：亮纸底 `#F7F3EC` + 特粗深橙勾 `#C95F28` + 底部三行渐短渐淡细线（「记完的沉下去了，眼前只有这一勾」）。
- 图标画布专用「图标橙」`#C95F28`：与品牌橙 `#E0733A` 同色相（H≈20°）加深一档；App 内 UI 主操作色不变，仍用品牌橙。
- 意境元素的纪律：细线宽度 ≤ 勾宽的 1/13、远离勾、不横贯画布——保证大尺寸可赏、60px 位先于勾隐没，不反噬主屏清晰度。
- 勾的居中用**质心**对齐而非 bbox：勾形体天然不对称（长臂右上甩、圆帽收笔右上，短臂起笔左下），bbox 中心偏视觉重心右下约 (66,79)px。

## 根因与取舍（60px「糊」的三层诊断）

1. **占比不足**：勾占画布 54% 时 60px 下臂宽仅 7.7px——放大加粗（占 69%、臂宽 190）。
2. **对比度不足（真根因）**：品牌橙对纸底亮度对比仅 1.72:1，小尺寸下显「虚、不实」；加深到 `#C95F28` 达 2.03:1（+18%）。
3. **信息密度过载**：完整版格线（4 条满幅横线贴勾穿过）在 60px 下与纸底混成灰雾——最终弃格线，改「远处三行」短线。
- 判断工具：无图像识别时用数值分析（WCAG 对比度公式、勾质心坐标、橙像素占比、截屏取样对比新旧版）。

## 平台限制（实测确认，写代码前不可绕过）

- **iOS 26 appiconset 只接受单一 1024px 图**：`60x60@2x` 等多尺寸条目会被 actool 整体忽略（`xcrun actool` + `assetutil --info` 验证），主屏 60px 由系统从 1024 缩放。「按尺寸出不同图」不可行，源图必须为小尺寸优化。iOS 26 的「深色/着色」主屏图标模式会给浅底图标加系统蒙层，验收时先排查该设置。
- **`expo prebuild` 连环坑**（每次 prebuild 后都要做）：① 会把 `aps-environment` entitlements 写回（免费个人证书不支持 Push，需清空 `ios/app/app.entitlements` 留空 `<dict/>`；本地通知不需要它）；② 重新生成 xcodeproj 会丢手动改过的签名配置。
- **`ios/` 目录不入库**（gitignore），原生图标随 prebuild 从 `app.json`/`assets/` 同步——改 `assets/images/icon.png` 后必须 `npx expo prebuild --platform ios --no-install` 再 `npx expo run:ios --device`，只改 assets 不重编无效。
- Metro 与手机的网络：Mac 在 11.x 企业内网段时手机路由不到，须 `npx expo start --tunnel --dev-client`，隧道地址每次重启都变。

## 可复用知识

- `scripts/generate-icons.py`：全套图标参数化生成（Pillow 4× 超采样 + LANCZOS），勾形贝塞尔、臂宽、三行线、颜色全部可调，重跑即再生成。
- 验收路径：改 assets → prebuild → 清 entitlements → `expo run:ios --device` → 主屏/splash 目检；覆盖安装不丢数据（SQLite 沙盒保留），删 App 才丢——删装前先 App 内导出。
- 设计决策链文档化在 `design/icon-redesign-proposals.html`（四方向提案）、`icon-60px-compare.html`（A/B 取舍）、`icon-mood-compare.html`、`icon-thinline-compare.html`（意境探索）。

## 验证方式

1. `npm run ci`（typecheck + 14 套件）+ GitHub `validate` check 绿。
2. 资产数值校验：勾质心 (512,512)、三行线水平中心 512、四角纯纸色、Android 前景外接盒在 66% 安全区、monochrome 白剪影。
3. 真机（iPhone 17 / iOS 26.6.1）主屏 60px 与 splash 目检通过；通知 29px / 设置页 / Android 蒙版待发布前补验。

## 关联 PR / 提交

- PR #16：`redesign/app-icon` 分支（c0034e4 初版 + 994bf8a 真机三轮迭代定稿）。

## 回滚方式

revert PR #16 即回到「折角备忘卡」全套资产；参数微调直接改 `scripts/generate-icons.py` 重跑。

## 本机环境坑（排障存档）

- git over https 传输在本机反复挂起（疑 Clash 代理干扰 443 大流量；`gh api` 通道正常）——解法：blob → tree → commit → update ref 四步走 GitHub API 完成推送，或显式 `-c credential.helper='!gh auth git-credential'`。
- PATH 抢占：`/usr/local/bin/git` 2.6.4 是 Xcode 附带旧版，必须用 `/usr/bin/git` 2.50.1（AGENTS.md 规定）。
