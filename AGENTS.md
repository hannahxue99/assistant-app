# Assistant App mandatory workflow

Use `.agents/skills/assistant-app-work/SKILL.md` for repository tasks and start from `docs/CURRENT.md`. Load detail only when the skill routes to it.

Before writing code, read the exact Expo SDK 57 documentation at https://docs.expo.dev/versions/v57.0.0/.

## Product changes

1. Inspect only the relevant implementation and product documents.
2. Before production code, present design, implementation, data flow, edge cases, and acceptance criteria. UI or flow changes also need a concrete visual artifact.
3. Wait for confirmation, then use a dedicated branch and PR; preserve reviewable history.
4. Use focused checks while developing and `npm run ci` before delivery. Add every new test to aggregated `npm test`.
5. After acceptance and before merge, record the decision, reusable lesson, verification, and rollback in `docs/knowledge/` and its index.

## Delivery invariants

- Inspect and continue a usable existing branch and PR; do not duplicate work.
- Automated checks make a change ready for acceptance, not released. Do not merge before user acceptance, and require GitHub `CI / validate` to pass.
- Code release and device release are separate. Before recommending Reload, rebuild, install, or merge, read the matching sections of `docs/DEVELOPMENT_WORKFLOW.md`, `docs/knowledge/agent-dev-playbook.md`, and `docs/RELEASE_CHECKLIST.md`.
- Keep previews, debug tools, test data, and developer copy out of user-facing navigation.
- Close in this order: acceptance → release information → knowledge/rules → PR merge → local `main` sync → required device delivery → final record.
- Without a usable repository and remote PR target, stop before implementation. Never present uncommitted edits as a PR.
