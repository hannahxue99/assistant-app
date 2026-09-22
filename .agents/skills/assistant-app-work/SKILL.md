---
name: assistant-app-work
description: Route development work in the assistant-app repository with bounded context. Use for new features, continuing PRs, verification, device acceptance, release closeout, or repository knowledge lookup in this project.
---

# Assistant App Work

Keep context proportional to the task. Do not repeat `AGENTS.md`.

## Start

1. Read [`docs/CURRENT.md`](../../../docs/CURRENT.md).
2. Run `node scripts/agent-context.cjs --query "<keywords>"`; add `--pr <number>` for a known PR or `--no-pr` for local-only work.
3. Select one mode and load only its sources.

## New product or feature work

- Read `PRD.md` only for product scope or status.
- Inspect the relevant screen, domain module, tests, and at most the newest matching plan.
- Obey the design-confirmation gate.

## Continue an existing PR

- Inspect PR description, commits, comments, checks, changed files, branch, and linked design.
- Continue usable work; do not load unrelated plans or recreate it.

## Device acceptance

Only here, read the Dev/Release sections of `docs/DEVELOPMENT_WORKFLOW.md`, the Reload flow in `docs/knowledge/agent-dev-playbook.md`, and one relevant indexed topic. Verify their required endpoint, build, device, and runtime evidence before claiming delivery.

### Dev unavailable or not loading

For iOS “不再可用”, a Dev launcher loading failure, or `Error loading app`, follow the recovery flow in [`docs/knowledge/agent-dev-playbook.md`](../../../docs/knowledge/agent-dev-playbook.md). Treat signing/install and Metro/runtime as separate gates. Do not report recovery until the expected worktree owns the verified tunnel endpoint, that URL has been opened on the physical device, and Metro records the device request plus a completed iOS bundle. Never delete the App as a signing fix.

## Release closeout

Only after acceptance, read `docs/RELEASE_CHECKLIST.md` and the matching knowledge topic, then follow the repository closeout order.

## Context limits

- Exclude `docs/archive/**` unless history is requested.
- Search the knowledge index first; never begin with an unscoped document scan.
- Prefer focused tests; use `ci:agent` for concise local output and `ci` before delivery.
- Do not use multiple agents unless requested.
- Refine over-limit results instead of expanding them.

## Maintain this skill

When a PR changes a path, command, source of truth, or delivery gate routed here, update this skill in the same PR or verify that its routing remains correct. Keep volatile detail in the linked source documents, extend `test:agent-tooling` for new invariants, and rerun skill validation. Use a fresh Codex session when discovery or routing behavior changes.
