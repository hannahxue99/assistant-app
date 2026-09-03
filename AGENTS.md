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

If the directory is not yet a Git repository or has no usable remote/PR target, stop before implementation and ask the user whether to initialize/connect one. Do not represent uncommitted workspace edits as a PR.
