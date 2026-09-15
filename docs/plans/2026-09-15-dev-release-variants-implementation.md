# Dev / Release App Variants Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build installable Dev and Release variants from one Expo 57 codebase without changing the existing Release identity or data container.

**Architecture:** Keep `app.json` as the production-safe base and add `app.config.ts` to select only variant-specific values from `APP_VARIANT`. Always regenerate ignored native projects before a variant build, and verify the resolved Expo config plus generated iOS settings.

**Tech Stack:** Expo SDK 57, TypeScript dynamic app config, Expo config plugins, npm scripts, Node/tsx tests, Xcode local device build.

---

### Task 1: Record the accepted product and release contract

**Files:**
- Create: `docs/plans/2026-09-15-dev-release-variants-design.md`
- Create: `docs/plans/2026-09-15-dev-release-variants-implementation.md`

**Step 1: Document identities and data boundaries**

Record the exact names, identifiers, schemes, build inputs, data ownership, failure modes, acceptance criteria and rollback point.

**Step 2: Verify the documents**

Run: `rg -n "com.huanxue.assistantapp|APP_VARIANT|回滚点" docs/plans/2026-09-15-dev-release-variants-*`

Expected: both identifiers and explicit rollback instructions are present.

**Step 3: Commit**

```bash
/usr/bin/git add docs/plans/2026-09-15-dev-release-variants-design.md docs/plans/2026-09-15-dev-release-variants-implementation.md
/usr/bin/git commit -m "docs: design separate Dev and Release apps"
```

### Task 2: Add failing variant contract tests

**Files:**
- Create: `scripts/test-app-variants.ts`
- Modify: `package.json`

**Step 1: Write the failing test**

Import the dynamic config function and assert:

```ts
resolve('development') === {
  name: '私人助手 Dev',
  iosBundleIdentifier: 'com.huanxue.assistantapp.dev',
  scheme: 'assistantapp-dev',
};

resolve('production') === {
  name: '私人助手',
  iosBundleIdentifier: 'com.huanxue.assistantapp',
  scheme: 'assistantapp',
};
```

Also assert the production default and rejection of an unknown variant.

**Step 2: Register the test in the aggregate command**

Add `test:app-variants` and include it in `npm test`.

**Step 3: Run the test to verify it fails**

Run: `npm run test:app-variants`

Expected: FAIL because `app.config.ts` does not exist.

### Task 3: Implement deterministic dynamic Expo configuration

**Files:**
- Create: `app.config.ts`
- Create: `plugins/with-local-notifications-only.js`
- Modify: `package.json`

**Step 1: Add the dynamic config**

Implement a pure resolver around `APP_VARIANT`:

```ts
const variant = process.env.APP_VARIANT ?? 'production';
if (!['development', 'production'].includes(variant)) {
  throw new Error(`Unsupported APP_VARIANT: ${variant}`);
}
```

Override only name, icon, Scheme, iOS Bundle ID and Android package for Dev. Preserve production values from `app.json`, set `ios.appleTeamId`, and enable the generated dev-client Scheme only for Dev.

**Step 2: Make local-notification signing reproducible**

Add a config plugin using `withEntitlementsPlist` to delete `aps-environment`, matching the product's local-notification-only behavior and current Personal Team builds.

**Step 3: Add safe commands**

Add explicit `start:dev`, `prebuild:ios:dev`, `prebuild:ios:release`, `ios:dev`, and `ios:release` scripts. Both device build commands run their matching clean Prebuild first, then use a shared device-build wrapper that selects a physical iPhone, allows Xcode to create or renew provisioning, stages the exact `.app`, and installs it without starting Metro.

**Step 4: Run the focused test**

Run: `npm run test:app-variants`

Expected: PASS.

**Step 5: Commit**

```bash
/usr/bin/git add app.config.ts plugins/with-local-notifications-only.js package.json scripts/test-app-variants.ts
/usr/bin/git commit -m "feat: separate Dev and Release app identities"
```

### Task 4: Add and wire the Dev icon

**Files:**
- Create: `assets/images/icon-dev.png`
- Verify: `app.config.ts`

**Step 1: Generate the non-destructive icon variant**

Edit `assets/images/icon.png` with high input fidelity. Keep the original icon unchanged and add only a small, legible `DEV` badge in the upper-left safe area.

**Step 2: Inspect the result**

Verify it is a square 1024×1024 PNG, visually preserves the production icon and remains legible at home-screen size.

**Step 3: Verify resolved config**

Run:

```bash
APP_VARIANT=development npx expo config --json
APP_VARIANT=production npx expo config --json
```

Expected: Dev references `icon-dev.png`; production references only `icon.png`.

**Step 4: Commit**

```bash
/usr/bin/git add assets/images/icon-dev.png app.config.ts
/usr/bin/git commit -m "design: distinguish the Dev app icon"
```

### Task 5: Verify generated native identities

**Files:**
- Generated and ignored: `ios/**`

**Step 1: Generate Dev native project**

Run: `APP_VARIANT=development npx expo prebuild --platform ios --clean --no-install`

Expected: generated project uses `com.huanxue.assistantapp.dev`, `UMP8R97X9B`, and has no `aps-environment` entitlement.

**Step 2: Generate Release native project**

Run: `APP_VARIANT=production npx expo prebuild --platform ios --clean --no-install`

Expected: generated project uses `com.huanxue.assistantapp`, `UMP8R97X9B`, and has no `aps-environment` entitlement.

**Step 3: Restore Dev native project for device acceptance**

Run: `APP_VARIANT=development npx expo prebuild --platform ios --clean`

Expected: Pods install and the worktree is ready for the signed device-build wrapper used by `npm run ios:dev`.

### Task 6: Update operator documentation and run full checks

**Files:**
- Modify: `README.md`
- Modify: `docs/DEVELOPMENT_WORKFLOW.md`
- Modify: `docs/RELEASE_CHECKLIST.md`

**Step 1: Replace ambiguous commands**

Document `npm run start:dev`, `npm run ios:dev`, and `npm run ios:release`, including separate permissions/data, Release backup, and the requirement never to publish with the Dev identity.

**Step 2: Run automated checks**

Run: `npm run ci`

Expected: typecheck and every test registered in `npm test` pass.

**Step 3: Inspect the production diff**

Run: `/usr/bin/git diff codex/xiaozhi-conversation-v03...HEAD --check`

Expected: no whitespace errors and no generated `ios/` files tracked.

**Step 4: Commit**

```bash
/usr/bin/git add README.md docs/DEVELOPMENT_WORKFLOW.md docs/RELEASE_CHECKLIST.md
/usr/bin/git commit -m "docs: add variant build and release workflow"
```

### Task 7: Deliver stacked PR and perform device acceptance

**Step 1: Push the dedicated branch**

Run: `/usr/bin/git push -u origin codex/dev-release-variants`

Expected: branch is available on GitHub.

**Step 2: Create a stacked PR**

Create the PR with base `codex/xiaozhi-conversation-v03`, clearly marking the dependency on PR #17.

**Step 3: Install Dev on the connected iPhone**

Run: `npm run ios:dev -- <optional-device-UDID-or-name>`

Expected: Xcode automatically creates or renews the Personal Team provisioning profile, then “私人助手 Dev” installs beside “私人助手” without starting Metro.

**Step 4: Start Metro and execute manual cases**

Run: `npm run start:dev`

Expected: only Dev opens the current bundle; Release remains unchanged and independently launchable.

**Step 5: Stop before merge**

Collect CI and device evidence, then wait for user acceptance. Do not merge either PR before acceptance.
