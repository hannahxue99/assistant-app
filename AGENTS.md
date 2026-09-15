# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Product change workflow

For every new product or feature request, follow this sequence:

1. Inspect the current implementation and relevant product documents.
2. Update and present the proposed design artifact first, together with the implementation approach, data-flow changes, edge cases, and acceptance criteria.
   If the request affects UI, interaction, navigation, or user flow, include a concrete visual artifact before implementation. Use a page mockup/wireframe for layout changes, a before/after comparison for visual revisions, and a state/flow diagram for interaction or navigation changes. A text-only design is not sufficient for these requests.
3. Wait for the user to confirm the design and approach before changing production code.
4. Implement code on a dedicated Git branch and deliver it through a PR. Do not overwrite or discard prior versions; preserve commit history so the change can be reviewed and rolled back.
5. Run relevant automated checks and provide a concise change summary, test results, and PR information.
   Run `npm run ci` before delivery. Every new automated test must be added to the aggregated `npm test` command so local and GitHub checks stay identical.
6. After acceptance, capture reusable knowledge in the repository before closing the work. Record the product decision, root cause or key trade-off, pitfalls, reusable implementation pattern, verification method, and rollback point. Update the knowledge index so future work can discover it without relying on chat history.

# PR continuation and release workflow

- When continuing work created in another chat or window, inspect the existing PR, commits, comments, checks, branch state, design, and implementation documents first. Continue on the existing branch/PR when usable; do not duplicate the work in a new PR.
- Treat “code release” and “device release” as separate states. A merged PR means code is on `main`; it does not prove that a phone is running that version.
- Choose device verification by change type:
  - JavaScript, copy, and styling changes may be verified with Metro Reload.
  - Native dependencies, permissions, icons, signing, or native configuration require rebuilding and reinstalling the App.
  - A Bundle ID change creates a different App identity and requires an explicit data migration plan.
- Treat “Reload” as an endpoint contract, not merely a button press. Before telling the user that Reload is sufficient:
  - Resolve the Metro listener on the Dev App's current host/port and verify its working directory and Git branch.
  - Make the current feature worktree own that same endpoint. Never leave an old branch on the current port, start the new branch on another port, and claim that Reload will switch versions.
  - After replacing a stale listener, trigger Reload and wait for an actual device bundle request plus a successful `iOS Bundled` result with no runtime error.
  - If the endpoint must change, Reload alone is not sufficient; either restore the existing endpoint or explicitly describe the required reconnection.
- Do not expose internal component previews, debug tools, test data, or developer-only copy in user-facing navigation, including Debug builds used for product acceptance. Keep such tools behind internal routes or developer tooling.
- Automated checks only make a change ready for device acceptance; they do not by themselves complete release.
- GitHub's required `CI / validate` check must pass before merging to `main`. Do not bypass it to compensate for a missing test registration or a failing check; diagnose and fix the cause.
- Before GitHub workflow changes, preflight the actual Git binary (`command -v git`, `git --version`), `gh auth status`, and the token's `workflow` scope. On this host, do not use the obsolete `/usr/local/bin/git` 2.6.4; use `/usr/bin/git` 2.50.1 or a newer Homebrew Git. If GitHub API auth succeeds but workflow pushes are rejected, inspect credential-helper precedence and explicitly route the push through `gh auth git-credential` instead of repeatedly reauthorizing.
- Before merging an accepted PR, collect and report: requirement scope, PR and commit, automated checks, device/OS/build type, manual cases verified, native/data migration impact, unresolved risks, knowledge documents, and rollback point.
- Release closure order is: user acceptance → release information collection → knowledge/rule updates → PR merge → local `main` sync → device/release build delivery when required → final release record.

If the directory is not yet a Git repository or has no usable remote/PR target, stop before implementation and ask the user whether to initialize/connect one. Do not represent uncommitted workspace edits as a PR.
