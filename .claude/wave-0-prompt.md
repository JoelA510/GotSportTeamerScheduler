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

1. `git status` on `claude/extend-wave-planning-sqaol` is clean.
2. `git rev-parse --abbrev-ref HEAD` returns `claude/extend-wave-planning-sqaol`.
3. `git log origin/main..HEAD --oneline` shows only the Phase-1/Phase-2 planning-doc commits from this session (no source-code commits).
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
TBD

## Wave Scope
TBD

## Task 1 — Drift Audit (READ-ONLY)
TBD

## Task 2 — Plan Refresh Edits
TBD

## Task 3 — Wave 0 Close
TBD

## Documentation Currency Pass
TBD

## Wave Review
TBD

## Commit & Push Sequence
TBD

## Verification Gate
TBD

## Key References
TBD

## Critical Files
TBD

## Out of Scope This Wave
TBD

## Ground Rules
TBD
