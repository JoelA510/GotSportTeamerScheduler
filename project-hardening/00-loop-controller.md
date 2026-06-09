# Claude Code Loop Controller for SquadLogic Hardening Plan

This prompt is intended to be invoked from the repository root with:

```text
/loop Read ./hardening-plan/00-loop-controller.md and execute it exactly.
```

You are operating a one-PR-at-a-time hardening queue for SquadLogic. Use Opus 4.8 and max effort if available. The user has pre-authorized opening PRs and merging them once all gates below pass. Do not ask for confirmation unless blocked by authentication, permissions, branch protection, missing secrets, or an external service outage you cannot resolve.

## Non-negotiable operating rules

1. Work on exactly one numbered prompt per PR.
2. Do not start the next numbered prompt until the current prompt's PR has been merged and local `main` is updated.
3. Treat `./hardening-plan/` as local operator instructions. Do not commit it. Do not modify prompt files except for a local loop state file, and ensure that state file is excluded from git.
4. Keep each PR narrowly scoped to the active prompt.
5. Preserve backward compatibility unless the active prompt explicitly authorizes a breaking change.
6. Use subagents when useful for read-only exploration, impact analysis, test planning, docs review, and PR-comment triage. Keep final code edits, commits, pushes, and merges under the main session's control to avoid worktree conflicts.
7. Do not use long `sleep` loops. If CI, Gemini, Codex, or another review bot is pending, record the current state, end the iteration with a concise status, and rely on `/loop` to run this controller again.
8. Merge only after all merge gates pass.

## Local state setup

Use `./hardening-plan/.loop-state.json` as local state. If it does not exist, create it with:

```json
{
  "active": null,
  "completed": [],
  "prs": {},
  "botObservationCycles": {}
}
```

Add these local-only files/directories to `.git/info/exclude` if not already present:

```text
hardening-plan/
```

Do not edit `.gitignore` solely for this controller.

## Queue discovery

Find prompt files with:

```bash
find ./hardening-plan -maxdepth 1 -type f -name '[0-9][0-9]-*.md' | sort
```

Exclude:

- `00-loop-controller.md`
- `README.md`
- `.loop-state.json`

The next prompt is the lowest numbered prompt not listed in `completed`, unless `active` is non-null. If `active` is non-null, resume that prompt and its PR.

If there are no remaining prompts and no active PR, report that the queue is complete and do not schedule another loop iteration.

## Start or resume a PR

### If there is an active PR

1. Load `active` from `.loop-state.json`.
2. Check out its branch.
3. Use `gh pr view` to identify the PR number, URL, review state, comments, and checks.
4. Continue from the first incomplete gate below.

### If there is no active PR

1. Run:

```bash
git status --short
git fetch origin
git checkout main
git pull --ff-only origin main
```

2. Read the next prompt file fully.
3. Create a branch named from the prompt number and slug, for example:

```bash
git checkout -b hardening/01-foundation-design-characterization
```

4. Set `active` in `.loop-state.json` to include prompt file, branch name, and status `implementing`.
5. Process the prompt exactly. If it begins with `/plan`, use planning mode before changing files.

## Implementation workflow for each prompt

1. Use an Explore or read-only subagent to map impacted files and call sites.
2. Use a Plan subagent or planning pass to identify risks, dependencies, and acceptance criteria.
3. Implement only the active prompt scope.
4. Search all changed exports and changed public shapes with `rg` or equivalent. Update all affected call sites.
5. Add or update tests required by the prompt.
6. Add or update docs when behavior, public API, CLI/dev workflow, data shapes, or admin-facing behavior changes.
7. Run at least:

```bash
npm test
npm run typecheck
npm run lint
git diff --check
```

If one of those scripts does not exist, inspect `package.json` and run the closest available equivalent. Do not silently skip checks.

8. Before opening the PR, run a local review:

```text
/code-review max --fix
```

If that command is unavailable, perform a manual correctness review of the diff and document that fallback in the PR body.

9. Re-run affected checks after any review fix.

## Commit and open PR

1. Check staged content before committing. Never stage `./hardening-plan/`.
2. Use:

```bash
git add -A
git restore --staged hardening-plan || true
git status --short
```

3. If only `hardening-plan/` changed, do not commit; fix the staging mistake.
4. Commit with a concise message matching the prompt scope.
5. Push the branch and open a PR:

```bash
git push -u origin HEAD
gh pr create --fill
```

6. Update `.loop-state.json` with PR number, PR URL, branch, and status `reviewing`.

## PR review and bot concern handling

On every loop iteration while a PR is open:

1. Fetch PR data:

```bash
gh pr view --json number,url,headRefName,baseRefName,state,isDraft,mergeStateStatus,reviewDecision,statusCheckRollup,reviews,comments
```

2. Fetch inline review comments:

```bash
gh api repos/:owner/:repo/pulls/PR_NUMBER/comments --paginate
```

Replace `PR_NUMBER` with the actual number.

3. Identify review concerns from:

- Gemini bot comments/reviews/checks, matching author/check names containing `gemini`, `google`, or `google-labs`.
- Codex bot comments/reviews/checks, matching author/check names containing `codex`, `openai`, or `chatgpt`.
- Any GitHub bot or reviewer that requests changes, reports failing checks, or leaves actionable correctness/security/test concerns.

4. If Gemini/Codex comments are not yet present, do not block forever. Wait through at least one complete CI/check cycle and two consecutive `/loop` observations after the PR is open. If no Gemini/Codex bot comments or checks appear after that, record `botsAbsentOrNoConcerns` in state and continue. If they appear later before merge, handle them before merging.

5. For each actionable concern:

- Determine whether it is valid.
- Fix valid issues with minimal changes.
- If a concern is invalid, leave a concise PR comment explaining why, with file/test evidence.
- Prefer adding a regression test for every valid correctness issue.

6. After addressing review concerns, run:

```text
/code-review max --fix
```

Then run:

```bash
npm test
npm run typecheck
npm run lint
git diff --check
```

If `/code-review ultra` is available and project cost/settings permit it, use it for especially large or cross-layer PRs. Do not rely on it as the only review.

7. Push any fixes.

## CI/CL green gate

Use:

```bash
gh pr checks --watch --fail-fast
```

or, if watch mode is unsuitable, use instantaneous checks with:

```bash
gh pr checks
```

If checks are pending, record status and end the iteration so `/loop` can re-run later.

If checks fail:

1. Pull the failing logs or job summaries.
2. Diagnose the root cause.
3. Fix with the smallest safe change.
4. Run local checks.
5. Push.
6. Return to the PR review and CI gate.

## Required pre-merge checklist

Before merging, verify and record in the PR body or a final PR comment:

- The active prompt scope is complete.
- All intended call sites and interactions with changed code were searched and updated.
- Required tests were added or updated.
- Required docs were added or updated, or explicitly not needed with a reason.
- `npm test` passed or the repo-equivalent test command passed.
- `npm run typecheck` passed or the repo-equivalent typecheck passed.
- `npm run lint` passed or the repo-equivalent lint passed.
- `git diff --check` passed.
- Gemini/Codex review comments were addressed, or no comments/checks appeared after the observation guard.
- `/code-review max --fix` was run after external/bot review handling.
- All CI/CL checks are green, neutral, or intentionally skipped.
- PR is mergeable and has no unresolved requested-changes review.

## Merge

When all gates pass:

```bash
gh pr merge --squash --delete-branch
```

If repo convention clearly requires merge commit or rebase instead, follow the convention. If branch protection requires a merge queue or manual approval that you cannot perform, report the blocker and keep the PR active.

After merge:

```bash
git checkout main
git pull --ff-only origin main
```

Update `.loop-state.json`:

- append the prompt file to `completed`
- record PR number and merge result under `prs`
- set `active` to null

End the iteration. `/loop` will restart and pick the next prompt.
