# Assistant App current development map

Short, stable entry point for repository work. It does not replace product, PR, or release records.

## Sources of truth

- Human-facing documentation map: [`docs/README.md`](README.md).
- Product scope: [`PRD.md`](../PRD.md).
- Development and release: [`docs/DEVELOPMENT_WORKFLOW.md`](DEVELOPMENT_WORKFLOW.md), [`docs/RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md).
- Reusable decisions: [`docs/knowledge/INDEX.md`](knowledge/INDEX.md).
- Active work comes from Git and GitHub, never this file.

## Current product and stack

- Surfaces: Home, Xiaozhi, Profile. Facts: messages, todos, events, memories.
- Expo 57, React Native 0.86, React 19.2.3, TypeScript, Expo Router, local SQLite.
- The model proposes; local code validates and commits. SQLite facts are authoritative; indexes, notifications, calendar state, summaries, and snapshots are projections.

## Code map

| Area | Primary paths |
|---|---|
| Screens and navigation | `app/`, especially `app/(tabs)/` and `app/event/[id].tsx` |
| Xiaozhi runtime and domains | `src/assistant/` |
| SQLite facts and migrations | `src/db.ts`, `src/assistant/*-store.ts`, `*-migration.ts` |
| Engines and projections | `src/engine/` |
| Components and regression checks | `src/components/`, `scripts/test-*` |

Open only relevant files. Split large modules only when the requested change already touches them.

## Context boundaries

- Exclude `docs/archive/**` unless historical tracing is requested.
- Do not scan all plans. Read PR-linked or newest directly matching plans.
- Search the knowledge index before opening a topic.
- Run `node scripts/agent-context.cjs --query "<keywords>"`; add `--pr <number>` for known PRs.

## Verification

- Iterate with relevant `npm run test:*` and typecheck; run `npm run ci` before delivery.
- `npm run ci:agent` provides concise local output and a full temporary log; GitHub still runs `npm run ci`.
- Reload requires a verified endpoint. Native/config changes require rebuild; Bundle ID changes require data migration.
- Tests, merge, install, or a generic bundle do not prove the phone runs the accepted code.
