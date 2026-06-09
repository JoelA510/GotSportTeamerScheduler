# SquadLogic Teaming Hardening Prompt Bundle

Place this directory at the target repository root as:

```text
./hardening-plan/
```

Recommended execution order:

1. `01-foundation-design-characterization.md`
2. `02-snapshot-delta-core.md`
3. `03-typed-assignment-units.md`
4. `04-structural-incremental-generation.md`
5. `05-buddy-normalization-historical-resolution.md`
6. `06-coach-assistant-continuity.md`
7. `07-change-diagnostics-summaries.md`
8. `08-frontend-persistence-integration.md`
9. `09-e2e-hardening-docs-sweep.md`

The controller prompt is:

```text
00-loop-controller.md
```

Use it either by pasting this into Claude Code from the repo root:

```text
/loop Read ./hardening-plan/00-loop-controller.md and execute it exactly.
```

Or copy `00-loop-controller.md` to `.claude/loop.md` and run:

```text
/loop
```

Notes:

- Treat `./hardening-plan/` as local operator instructions, not repo product code.
- The loop prompt tells Claude Code to exclude this directory from commits.
- Each numbered prompt is scoped to one PR.
- The loop prompt is intentionally conservative about merge gates: it should not merge until CI is green, bot comments are addressed or absent after the defined checks, local `/code-review` has been run, docs/tests are reviewed, and the branch is mergeable.
