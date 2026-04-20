# Wave 0 — Pre-flight Reconciliation

## Session Context

**Prior-wave recap**: No prior waves have executed. The 14 `.claude/wave-*-prompt.md` files for Waves 1a–9b were authored 2026-04-17/18 from `docs/expansion/NEXT_SESSION_PLAN.md`. Three calendar days have elapsed without execution.

**Current state** (2026-04-20): SquadLogic v1.0.0 still at tag-free `main`; `package.json:3` declares `"version": "1.0.0"`; `README.md:20` status banner reads "v1.0 GA — Phase 10 pre-flight certification complete, post-launch monitoring in effect"; `CHANGELOG.md` absent; `docs/audits/wave-1a/` absent; `docs/expansion/98_PROGRESS_LOG.md` most-recent entry is 2026-04-17 `PR-155-TRIAGE`; `claude.md` (lowercase) still present (Wave 8 renames).

**Working tree**: Clean. Branch: `claude/extend-wave-planning-sqaol` (the Wave-0 authoring branch) cut from `main`. Origin: `github.com/JoelA510/SquadLogic`.

**Why Wave 0 exists**: Each of Waves 1a–9b has a "Pre-flight Verification" section with fact assertions pinned to the 2026-04-17/18 repo state. Three days have elapsed. Some assertions have decayed (new PRs may have landed; Supabase advisor output may have shifted; `NEXT_SESSION_PLAN.md` could have been edited). Wave 1a's pre-flight never ran, so every downstream plan's "prior-wave recap" is unverified. Wave 0 closes that gap: validate every plan's pre-flight against the 2026-04-20 repo, surface drift, apply minimal refresh edits in-place to the affected plans. Scope is bounded: no source-code, no migration, no test, no dependency changes.

**Wave purpose**: meta-planning. Deliverables are (a) a single drift report at `docs/audits/wave-0/drift-report.md`, (b) in-place refresh edits to `.claude/wave-*-prompt.md` files where drift is surfaced, (c) a `98_PROGRESS_LOG.md` appendage. Wave 1a remains the first *executable* wave; Wave 0 only re-grounds its inputs.

**Operating mandate**: every refresh edit must preserve the original wave plan's *scope* and *task count*. Wave 0 only adjusts factual claims (baselines, file paths, line numbers, migration counts, advisor findings, branch names already taken, etc.) — it does NOT re-scope or re-prioritize 1a–9b.

## Pre-flight Verification

Verify each claim. **HALT** on any false or ambiguous claim; do NOT auto-fix — that's Wave 0's scope.

1. `git status` on the current Wave 0 execution branch (operator-supplied; was `claude/extend-wave-planning-sqaol` at authoring, but that branch merged via PR #171/#172 — replacement branch is supplied at session start) is clean. <!-- wave-0 2026-04-20: original branch decayed; verify against the actual branch in use. -->
2. `git rev-parse --abbrev-ref HEAD` returns the current Wave 0 execution branch. <!-- wave-0 2026-04-20: original assertion named the now-merged authoring branch. -->
3. `git log origin/main..HEAD --oneline` shows zero commits, OR only Wave 0 task commits from this session (no source-code commits). <!-- wave-0 2026-04-20: original assertion presupposed the merged authoring branch's commit history. -->
4. Fourteen wave prompt files exist at `.claude/wave-{1a,1b,2,3a,3b,4,5,6a,6b,7a,7b,8,9a,9b}-prompt.md`.
5. `.claude/wave-execution-protocol.md` exists.
6. `.claude/wave-0-prompt.md` exists (this file).
7. `.claude/wave-testing-strategy.md` does NOT exist. (Phase 5 creates it.)
8. `.claude/wave-recurring-prompts.md` does NOT exist. (Phase 6 creates it.)
9. `docs/audits/` does NOT yet exist at the repo root. Wave 0 Task 1 creates `docs/audits/wave-0/` only; Wave 1a creates `docs/audits/wave-1a/`.
10. `package.json:3` still declares `"version": "1.0.0"` (Wave 9a bumps to `1.0.1`; Wave 0 does not).
11. `docs/expansion/NEXT_SESSION_PLAN.md` mtime is unchanged from Wave-1a authoring time, OR operator has noted any edits made since. If the file has been edited mid-Wave-0, HALT and surface.

If a `.claude/wave-*-prompt.md` file has been renamed or a new wave file has appeared since this plan was written, **HALT** and surface — the drift audit's target set must match reality.

## Branch Conventions

Wave 0 is planning-doc-only. It executes on the authoring branch itself, not on new `claude/wave-*` branches:

- **Single branch**: `claude/extend-wave-planning-sqaol` (already cut from `main`).
- **One commit per task**: Tasks 1, 2, 3 each land as a separate commit on this branch, in order.
- **Single PR**: close Wave 0 via this wave's PR against `main` once all three commits are pushed. <!-- wave-0 2026-04-20: PR #171 (and #172) are already merged; the original "existing PR" no longer exists. Open a new PR from the current Wave 0 execution branch. -->
- **Do NOT push directly to `main`.** Do NOT open new task branches — the scope does not justify branch-per-task overhead.
- **No force-push, no `--no-verify`, no `--amend` on commits already pushed** (wave-execution-protocol §3).

---

## Wave Scope

Three-task sequence, each producing a single artifact:

1. **Drift audit (READ-ONLY)** → `docs/audits/wave-0/drift-report.md`. Catalogues every decayed fact assertion across the 14 `.claude/wave-*-prompt.md` files and `wave-execution-protocol.md`.
2. **Plan refresh edits** → in-place edits to `.claude/wave-*-prompt.md` files (and `wave-execution-protocol.md` if drift surfaces there). Every edit adjusts factual claims only (file paths, line numbers, baselines, branch names, dates, migration counts, advisor findings). **No task count changes. No scope changes. No re-prioritization.**
3. **Wave 0 close** → `docs/expansion/98_PROGRESS_LOG.md` append + `docs/README.md` audits-link update.

**Hard boundaries**: no source-code, migration, test, config, or dependency changes. If a drift finding requires code/migration action, file it in the drift report under a `## Deferred to later waves` section and leave the target wave plan's fact assertion intact (annotated with a `<!-- wave-0: verify at Wave N pre-flight -->` HTML comment).

---

## Task 1 — Drift Audit (READ-ONLY)

**Commit**: `chore(audit): wave-0 drift report (task 1)`

**Output**: `docs/audits/wave-0/drift-report.md` (new file; also creates `docs/audits/wave-0/` directory).

### Steps

1. Confirm branch is `claude/extend-wave-planning-sqaol` and working tree is clean (`git status`, `git rev-parse --abbrev-ref HEAD`).

2. **Snapshot current repo state** — record these at the top of the drift report under `## Repo snapshot (2026-04-20)`:
   - `git log origin/main..HEAD --oneline` (Wave 0 authoring commits).
   - `git log --oneline -20 origin/main` (20 most recent commits on main).
   - `cat package.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['version'])"` (version declaration).
   - `head -5 README.md` (status banner line).
   - `ls docs/audits/ 2>/dev/null || echo "(absent)"`.
   - `ls supabase/migrations/ | wc -l` (migration count).
   - `head -1 docs/expansion/98_PROGRESS_LOG.md && head -30 docs/expansion/98_PROGRESS_LOG.md | grep -E "^## " | head -5` (most recent 5 progress-log entries).
   - `git ls-files claude.md CLAUDE.md` (case-resolution state).
   - `stat -c "%y %n" docs/expansion/NEXT_SESSION_PLAN.md` (mtime).

3. **Per-plan drift scan** — for each of the 15 planning files (14 wave plans + `wave-execution-protocol.md`), create a `### <filename>` section in the drift report listing:
   - Every pre-flight assertion that references a file path, line number, commit SHA, branch name, migration date, test count, advisor finding, env var, or doc path.
   - For each: verify against the 2026-04-20 repo. Record as `✅ holds` | `⚠️ drifted — <detail>` | `❌ false`.
   - For every `⚠️` or `❌`: quote the current state + propose the minimal one-line edit that would re-ground the assertion. Do NOT apply the edit here — Task 2 applies edits.

4. **Cross-plan consistency scan** — flag any assertion that appears in multiple plans with different wording (e.g., baseline test counts, E2E pass rate, migration naming). Each cross-plan inconsistency gets its own `### Cross-plan: <topic>` entry.

5. **Dependency-graph scan** — verify each plan's `**Depends on**` or `Prior-wave recap` line still matches the planned wave order. A prior wave that now ships something other than what the recap claims is drift.

6. **Deferred section** — any drift that requires code/migration/test action (not a fact-claim edit) gets listed under `## Deferred to later waves` with: source plan, finding, and the wave that will act.

7. **Summary table** at the top of the report:

   ```markdown
   ## Summary

   | Plan | ✅ holds | ⚠️ drifted | ❌ false | Refresh edits queued |
   | --- | --- | --- | --- | --- |
   | wave-1a-prompt.md | N | N | N | N |
   | … | | | | |
   | **Total** | | | | |
   ```

8. **Self-review**: every `⚠️` / `❌` row in every per-plan section has a corresponding entry in the Summary table's "Refresh edits queued" column, and vice versa. No orphans.

### Verification (Task 1)

- `git status` — only `docs/audits/wave-0/drift-report.md` added. Nothing else.
- No file under `.claude/`, `packages/`, `frontend/`, `supabase/`, `tests/`, `scripts/`, `config/` modified.
- Commit with the message above. Push.

### Out of scope (Task 1)

- Editing any wave plan (Task 2 owns this).
- Fixing any drift finding inline.
- Running the repo's test suite, lint, typecheck, or build (Wave 0 changes no code, so these baselines are not captured here — Wave 1a captures them).

---

## Task 2 — Plan Refresh Edits

**Commit**: `docs(planning): wave-0 refresh edits per drift report (task 2)`

**Output**: in-place edits to `.claude/wave-*-prompt.md` (and `wave-execution-protocol.md` if needed). No new files.

### Steps

1. Re-read `docs/audits/wave-0/drift-report.md` from Task 1. The Summary table's "Refresh edits queued" count is the target edit count for this task.

2. For each `⚠️` / `❌` row in the report:
   - Open the target `.claude/wave-*-prompt.md` file.
   - Apply the minimal one-line edit proposed in the drift report. Preserve surrounding context; do NOT rewrap paragraphs or reorder items.
   - **Forbidden edits**: changing task count, renaming tasks, changing branch names that downstream plans depend on, adding/removing pre-flight items, editing `Wave purpose` or `Operating mandate` paragraphs.
   - **Allowed edits**: updating a file-path reference, a line number, a commit SHA, a date, a count, a baseline number, a migration filename, an advisor-finding status, a fact about the current repo state.

3. For cross-plan inconsistencies: pick the authoritative value (latest planning session's wording wins, or the protocol's wording wins if protocol sets the convention). Edit all drift sites to that value.

4. For deferred items (code/migration action needed): insert an HTML comment adjacent to the affected pre-flight item: `<!-- wave-0 2026-04-20: re-verify at Wave N pre-flight; see docs/audits/wave-0/drift-report.md -->`. Do NOT edit the assertion's text.

5. **Diff discipline**: `git diff --stat .claude/` should show one modified file per drift-surfaced plan. No file outside `.claude/` should appear in the diff for this task.

6. Self-review:
   - `git diff .claude/` — every changed line corresponds to a row in the drift report's Summary table.
   - No plan's task count changed (`grep -c "^## Task " .claude/wave-*-prompt.md` matches pre-Task-2 output).
   - No plan's `## Wave Scope` paragraph was rewritten.

### Verification (Task 2)

- `git diff --stat` — only `.claude/wave-*-prompt.md` (and possibly `wave-execution-protocol.md`) files changed. Zero files outside `.claude/`.
- `git diff --numstat .claude/ | awk '{sum+=$1+$2} END {print sum}'` — total changed-line count is within 2× the Summary table's "Refresh edits queued" total (sanity check that edits are minimal, not rewrites).
- Commit with the message above. Push.

### Out of scope (Task 2)

- Any edit outside `.claude/`.
- Scope or task-count changes to any plan.
- Rewriting `Wave purpose`, `Operating mandate`, `Ground Rules`, or `Key References` sections in any plan.
- Fixing typos or grammar unrelated to a drift finding (log them in the drift report's `## Deferred` section if worth noting).

---

## Task 3 — Wave 0 Close

**Commit**: `docs(planning): wave-0 close — progress log + audits link`

**Output**:
- `docs/expansion/98_PROGRESS_LOG.md` — append one new section.
- `docs/README.md` — add `### Audits` sub-heading + link to `docs/audits/wave-0/` if the heading does not already exist (if Wave 1a's audits directory arrived first, append to the existing list instead of creating the heading).

### Steps

1. **Append to `docs/expansion/98_PROGRESS_LOG.md`** — new `## 2026-04-20 — Wave 0 meta-planning reconciliation` section containing:
   - One-paragraph summary of what Wave 0 did (drift audit + refresh edits).
   - The Summary table from the drift report (counts per plan).
   - Link to `docs/audits/wave-0/drift-report.md`.
   - Note that Wave 1a remains the first executable wave; its pre-flight now reflects 2026-04-20 state.

2. **Update `docs/README.md`** — under an `### Audits` heading (create if missing), add `- [Wave 0 — planning drift reconciliation](audits/wave-0/drift-report.md)`.

3. **Do NOT** edit `claude.md` / `CLAUDE.md`, any architecture doc, `NEXT_SESSION_PLAN.md`, `README.md` (repo root), or `package.json`.

4. Self-review: `git diff --name-only` shows exactly `docs/expansion/98_PROGRESS_LOG.md` and `docs/README.md`. Nothing else.

### Verification (Task 3)

- `git status` — only the two files above changed.
- Progress log entry is append-only (previous entries untouched — verify with `git diff docs/expansion/98_PROGRESS_LOG.md` showing only additions).
- Commit with the message above. Push.

---

## Documentation Currency Pass

Handled inline by Task 3. No separate pass. Specifically:

1. `docs/expansion/98_PROGRESS_LOG.md` — appended in Task 3.
2. `docs/README.md` — `### Audits` link added in Task 3.
3. `.claude/wave-*-prompt.md` — in-place refreshes already applied in Task 2.
4. **Do NOT** touch `claude.md` / `CLAUDE.md` casing (Wave 8 owns), architecture docs, `NEXT_SESSION_PLAN.md`, or `CHANGELOG.md` (Wave 9a owns).

---

## Wave Review

Walk this checklist before closing the PR. Any "no" blocks merge.

1. `docs/audits/wave-0/drift-report.md` exists, has a `## Summary` table, and every `⚠️` / `❌` row in per-plan sections corresponds to either a Task 2 edit or a `## Deferred` entry.
2. `git diff origin/main...HEAD --stat` shows: 1 new file under `docs/audits/wave-0/`, N modified files under `.claude/`, `docs/expansion/98_PROGRESS_LOG.md` appended, `docs/README.md` updated. Nothing else.
3. No file under `frontend/`, `packages/`, `supabase/`, `tests/`, `scripts/`, `config/`, or the repo root (except the two doc files) is modified.
4. `grep -c "^## Task " .claude/wave-*-prompt.md` output is identical before and after Wave 0 (task counts preserved).
5. No wave plan's `## Wave Scope`, `Wave purpose`, or `Operating mandate` paragraph was edited.
6. `docs/expansion/98_PROGRESS_LOG.md` has a new `## 2026-04-20 — Wave 0` entry; prior entries unchanged.
7. `docs/README.md` links to `docs/audits/wave-0/drift-report.md`.
8. Every deferred drift item (if any) names the wave that will re-verify it.
9. No `npm run lint` / `typecheck` / `test` / `build` failures reported (Wave 0 changes no code; these should be untouched — if CI surfaces failures, they pre-date Wave 0 and Task 1's repo snapshot should have captured their presence).

---

## Commit & Push Sequence

```
Task 1 commit → push    (drift report)
Task 2 commit → push    (refresh edits)
Task 3 commit → push    (progress log + README)
PR #171 → Wave Review → CI green → merge to main
```

After merge:
- `git checkout main && git pull origin main`.
- Confirm `docs/audits/wave-0/drift-report.md` is present on `main`.
- Delete the branch locally and remotely only after merge is visible on `main`.

---

## Verification Gate

Wave 0 edits no code, so the full `npm run` gate does not apply per-task. Instead, each task runs:

```bash
git status                            # only expected files changed
git diff --stat                       # change surface within scope
git rev-parse --abbrev-ref HEAD       # returns claude/extend-wave-planning-sqaol
```

**Once the PR is opened**, let CI run. If CI surfaces `lint` / `typecheck` / `test` / `build` failures on a doc-only diff, that is a CI config drift, not a Wave 0 regression — capture it in the drift report's `## Deferred` section and HALT the PR until reconciled.

---

## Key References

- `.claude/wave-execution-protocol.md` — enforcement layer (§2 pre-flight, §3 branching, §7 Wave Review).
- `.claude/wave-1a-prompt.md` through `.claude/wave-9b-prompt.md` — the 14 plans Wave 0 audits.
- `docs/expansion/NEXT_SESSION_PLAN.md` — source of the plans' fact assertions; do not edit.
- `docs/expansion/98_PROGRESS_LOG.md` — append target.
- `docs/README.md` — audits-link target.

---

## Critical Files

**Will create**:
- `docs/audits/wave-0/drift-report.md` (Task 1)

**Will edit (in-place, minimal)**:
- `.claude/wave-{1a,1b,2,3a,3b,4,5,6a,6b,7a,7b,8,9a,9b}-prompt.md` — only the assertions flagged in the drift report (Task 2).
- `.claude/wave-execution-protocol.md` — only if drift surfaces there (Task 2).
- `docs/expansion/98_PROGRESS_LOG.md` (Task 3 append).
- `docs/README.md` (Task 3 audits link).

**Will NOT edit**:
- Any file under `frontend/`, `packages/`, `supabase/`, `tests/`, `scripts/`, `config/`.
- `package.json`, `package-lock.json`, `README.md` (repo root), `CHANGELOG.md`, any `docs/architecture/*.md`.
- `claude.md` / `CLAUDE.md`, `docs/expansion/NEXT_SESSION_PLAN.md`, any `docs/expansion/0*_*.md`.
- Any `.env.*`, `vercel.json`, `vitest.config.js`, `playwright.config.ts`, `eslint.config.js`, `tsconfig.json`.

---

## Out of Scope This Wave

- Any source-code, migration, test, config, or dependency change.
- Any edit to `Wave purpose`, `Operating mandate`, `## Wave Scope`, or task bodies (step-by-step content) in any wave plan.
- Adding, removing, or renaming tasks in any wave plan.
- Re-prioritizing findings across waves (Wave 1a's `index.md` owns prioritization once it ships).
- Fixing drift at its source (e.g., if a migration has the wrong name, Wave 0 updates the plan to match reality — it does NOT rename the migration).
- Running the repo's test/lint/typecheck/build gates (Wave 1a captures those baselines; Wave 0 changes no code).
- Dashboard-dependent verification (Supabase advisor, Vercel analytics, Sentry) — defer to the acting wave's pre-flight.
- Editing `claude.md` → `CLAUDE.md` casing (Wave 8 owns).

---

## Ground Rules

- **Read-only discipline (Task 1)**: if `git status` shows anything other than `docs/audits/wave-0/drift-report.md` at Task 1 close, `git restore` and re-center.
- **Minimal-edit discipline (Task 2)**: every diff line in Task 2 maps to a row in the drift report. If a diff line has no drift-report row, revert it.
- **Preserve task counts**: `grep -c "^## Task " .claude/wave-*-prompt.md` before and after Task 2 must be identical.
- **Cite every drift finding**: drift-report rows cite the planning file + line number + the current repo fact that contradicts it.
- **No speculation**: if an assertion cannot be verified from the working tree (requires dashboard access, prod DB, CI output), label it `🟡 unverifiable — defer to <wave> pre-flight` and list it under `## Deferred`.
- **Append-only progress log**: Task 3 adds a section; it does not edit prior entries.
- **No proactive cleanup**: typos and grammar fixes in wave plans are out of scope unless they are the drift finding itself.
- **Conventional commits**: use the `Commit:` line verbatim for each task.
- **No `--no-verify`, no force-push, no `--amend` on pushed commits** (wave-execution-protocol §3).
- **5-attempt debugging cap** on any single tool/command failure; surface + STOP if exceeded.
