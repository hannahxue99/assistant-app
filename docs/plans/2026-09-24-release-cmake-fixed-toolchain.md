# Release Fixed CMake Toolchain Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make every iOS Release build validate and use the persistent, already-proven CMake 3.31.8 binary before Prebuild, with no fallback or automatic download.

**Architecture:** A new Node release wrapper derives one fixed path from the current user's home directory, validates executable presence and exact version, then runs Expo Prebuild and the existing physical-device build wrapper with a shared explicit environment. Pure validation and plan-building functions are exported for deterministic tests.

**Tech Stack:** Node.js CommonJS, Expo SDK 57 CLI, existing iOS device build wrapper, `node:assert` tests, npm scripts.

---

### Task 1: Pin and verify the local toolchain

**Files:**
- No repository files

**Step 1: Create the persistent parent directory**

Run: `mkdir -p ~/.local/share/assistant-app/toolchains`

**Step 2: Copy the verified CMake application bundle**

Copy the existing `cmake-3.31.8-macos-universal` directory from the verified temporary source into the persistent toolchain directory without modifying `/usr/local/bin/cmake`.

**Step 3: Verify the fixed binary**

Run the fixed binary with `--version` and expect `cmake version 3.31.8`.

### Task 2: Add failing Release preflight tests

**Files:**
- Create: `scripts/test-ios-release.cjs`
- Modify: `package.json`

**Step 1: Write tests for deterministic path and validation behavior**

Cover the home-relative fixed path, accepted 3.31.8 output, missing file, non-executable file, and mismatched version.

**Step 2: Write tests for release phase ordering**

Assert that Prebuild is the first child process only after validation and that the production device build is skipped when Prebuild fails.

**Step 3: Register the test**

Add `test:ios-release` and include it in the aggregated `npm test` command.

**Step 4: Run the focused test and verify failure**

Run: `npm run test:ios-release`

Expected: FAIL because `scripts/ios-release.cjs` does not exist.

### Task 3: Implement the fixed Release entry point

**Files:**
- Create: `scripts/ios-release.cjs`
- Modify: `package.json`

**Step 1: Implement fixed-path derivation**

Use `os.homedir()` plus `.local/share/assistant-app/toolchains/cmake-3.31.8-macos-universal/CMake.app/Contents/bin/cmake`.

**Step 2: Implement strict preflight**

Check existence and executable access, run `--version`, and accept only 3.31.8. Error messages must state the fixed path and must never suggest falling back to the system binary.

**Step 3: Implement ordered Release phases**

Run `npx expo prebuild --platform ios --clean`, then `node scripts/ios-device-build.cjs production`, passing `APP_VARIANT=production` and the validated `CMAKE_BINARY` to both.

**Step 4: Route `ios:release` through the wrapper**

Change `ios:release` to `node scripts/ios-release.cjs`.

**Step 5: Run focused tests**

Run: `npm run test:ios-release && npm run test:app-variants && npm run test:ios-device-build`

Expected: PASS.

### Task 4: Update release contracts and routing

**Files:**
- Modify: `.agents/skills/assistant-app-work/SKILL.md`
- Modify: `docs/RELEASE_CHECKLIST.md`
- Modify: `docs/knowledge/agent-dev-playbook.md`
- Modify: `scripts/test-agent-tooling.cjs`

**Step 1: Update the release contract**

Document the fixed persistent path, strict 3.31.8 validation, no automatic download, and no fallback to `/usr/local/bin/cmake`.

**Step 2: Update project Skill routing**

Make Release troubleshooting start with `npm run ios:release` preflight output and forbid bypassing the wrapper.

**Step 3: Extend tooling invariants**

Assert that the Skill and knowledge topic point to the fixed preflight contract.

**Step 4: Run tooling tests**

Run: `npm run test:agent-tooling`

Expected: PASS.

### Task 5: Verify and publish the change

**Files:**
- All changed files

**Step 1: Run focused verification**

Run: `npm run test:ios-release && npm run test:app-variants && npm run test:ios-device-build && npm run test:agent-tooling`

Expected: PASS.

**Step 2: Run full verification**

Run: `npm run ci`

Expected: PASS.

**Step 3: Review the diff and repository state**

Confirm no generated iOS files, CMake binaries, credentials, or user-specific absolute paths are tracked.

**Step 4: Commit and open a PR**

Use a focused commit and a PR describing the recurrence, fixed-path decision, tests, rollback, and the fact that production code and App data are unaffected.
