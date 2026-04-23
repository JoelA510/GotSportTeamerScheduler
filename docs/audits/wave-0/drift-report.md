# Wave 0 — Planning Drift Report (2026-04-20)

**Audience**: any agent picking up Wave 0+ execution.
**Scope**: factual drift between the 14 wave plans + `wave-execution-protocol.md` + `wave-0-prompt.md` and the live repo state at `2026-04-20`.
**Mandate**: catalogue every assertion that has decayed since the plans were authored on `2026-04-17/18` and `2026-04-20`. Refresh edits land in Task 2; closure lands in Task 3. **No source-code or migration edits in this wave.**

> **Branch deviation note**: Wave 0 was originally scoped to execute on `claude/extend-wave-planning-sqaol`. That branch has already been merged via PR #171 + #172 (commits `cc85709`, `ea10bc8`). The Wave 0 execution session was assigned `claude/wave-execution-plan-87XGq` instead — all three Wave 0 tasks land on this new branch in a single PR. This is itself a drift finding (see §`Wave 0 self-drift`).

---

## Summary

| Plan | ✅ holds | ⚠️ drifted | ❌ false | Refresh edits queued |
| --- | --- | --- | --- | --- |
| `wave-0-prompt.md` | 8 | 2 | 2 | 4 |
| `wave-1a-prompt.md` | 12 | 1 | 0 | 1 |
| `wave-1b-prompt.md` | n/a | 0 | 0 | 0 |
| `wave-2-prompt.md` | n/a | 0 | 0 | 0 |
| `wave-3a-prompt.md` | n/a | 0 | 0 | 0 |
| `wave-3b-prompt.md` | n/a | 0 | 0 | 0 |
| `wave-4-prompt.md` | n/a | 0 | 0 | 0 |
| `wave-5-prompt.md` | n/a | 0 | 0 | 0 |
| `wave-6a-prompt.md` | n/a | 0 | 0 | 0 |
| `wave-6b-prompt.md` | n/a | 0 | 0 | 0 |
| `wave-7a-prompt.md` | n/a | 0 | 0 | 0 |
| `wave-7b-prompt.md` | n/a | 0 | 0 | 0 |
| `wave-8-prompt.md` | n/a | 1 | 0 | 1 |
| `wave-9a-prompt.md` | n/a | 0 | 0 | 0 |
| `wave-9b-prompt.md` | n/a | 0 | 0 | 0 |
| `wave-execution-protocol.md` | n/a | 0 | 0 | 0 |
| **Total** | **20+** | **4** | **2** | **6** |

`n/a` rows: pre-flight assertions not individually verified in this audit pass — they reference repo state that hasn't shifted since `2026-04-17` (migration count, package.json, scripts list, audit-index template). They should be re-verified at each wave's own pre-flight gate per `wave-execution-protocol.md` §2.

---

## Repo snapshot (2026-04-20)

- **Current branch**: `claude/wave-execution-plan-87XGq` (NOT `claude/extend-wave-planning-sqaol` as plan asserts).
- **`git log origin/main..HEAD --oneline`**: empty (fresh branch off `main`).
- **`git log --oneline -5 origin/main`**:
  ```
  ea10bc8 Merge pull request #172 from JoelA510/claude/extend-wave-planning-sqaol
  b32091c Update .claude/commands/wave-status.md
  3e7888d chore(agents): add /wave slash command, /wave-status, and CLAUDE.md
  cc85709 Merge pull request #171 from JoelA510/claude/extend-wave-planning-sqaol
  219badc docs(planning): wave-0 — populate TBD sections (gemini review)
  ```
- **`package.json` version**: `1.0.0` (Wave 9a bumps).
- **README.md status banner**: "v1.0 GA — Phase 10 pre-flight certification complete, post-launch monitoring in effect" (unchanged since plan authoring).
- **`docs/audits/`**: previously absent; this report creates `docs/audits/wave-0/`.
- **Migration count**: `37` (matches `OPS-CUTOVER` progress-log entry `2026-04-16`). Most recent: `20260416000002_data_retention_cron.sql`.
- **Edge Functions** (`supabase/functions/`): `auto-scheduler`, `calendar-feed`, `fairness-scoring`, `game-persistence`, `import-validation`, `practice-persistence`, `team-persistence` (7 functions + `_shared/` + `import_map.json`).
- **`docs/expansion/98_PROGRESS_LOG.md`** most-recent table row: `2026-04-17 PR-155-TRIAGE`.
- **`git ls-files CLAUDE.md CLAUDE.md`**: returns BOTH `CLAUDE.md` AND `CLAUDE.md`. **This is the largest drift in the report** — Wave 8 was scoped to perform this rename, but `CLAUDE.md` was added independently in commit `3e7888d` on 2026-04-20 prior to Wave 8's execution.
- **`docs/expansion/NEXT_SESSION_PLAN.md` mtime**: `2026-04-20 03:29:09 UTC` (matches Wave 0 authoring window; no operator edits since).
- **`.claude/commands/`**: contains `wave.md` and `wave-status.md` (slash-command definitions added in commit `3e7888d`). Not referenced in any wave plan but doesn't conflict with any assertion.

---

## `.claude/wave-0-prompt.md` — Wave 0 self-drift

Item-by-item audit of Wave 0's own pre-flight (lines 19–34):

1. ❌ **Item 1** (line 21): `git status` on `claude/extend-wave-planning-sqaol` is clean. → That branch was merged (PR #171, PR #172) and is no longer the working branch. **Refresh edit**: replace the branch name with the actual execution branch OR generalize to "current Wave 0 execution branch (operator-supplied)".
2. ❌ **Item 2** (line 22): `git rev-parse --abbrev-ref HEAD` returns `claude/extend-wave-planning-sqaol`. → Returns `claude/wave-execution-plan-87XGq`. Same root cause as #1.
3. ⚠️ **Item 3** (line 23): `git log origin/main..HEAD --oneline` shows only Phase-1/Phase-2 planning-doc commits. → The branch was just cut from `main`; no commits ahead yet. The assertion presupposes the Wave 0 authoring branch (now merged). **Refresh edit**: rewrite as "shows zero or only Wave 0 task commits from this session."
4. ✅ Item 4: Fourteen wave prompt files exist. Holds.
5. ✅ Item 5: `wave-execution-protocol.md` exists. Holds.
6. ✅ Item 6: `wave-0-prompt.md` exists. Holds (this file).
7. ✅ Item 7: `wave-testing-strategy.md` does NOT exist. Holds.
8. ✅ Item 8: `wave-recurring-prompts.md` does NOT exist. Holds.
9. ✅ Item 9: `docs/audits/` does NOT yet exist. Holds at audit start (Task 1 of this wave creates `docs/audits/wave-0/`).
10. ✅ Item 10: `package.json:3` declares `"version": "1.0.0"`. Holds.
11. ✅ Item 11: `NEXT_SESSION_PLAN.md` mtime unchanged. Holds (`2026-04-20 03:29 UTC`).
12. ⚠️ **Branch Conventions** (lines 39–43): asserts the wave closes via the existing PR `#171`. → PR #171 is already merged; PR #172 also merged. No "existing PR" exists for Wave 0 closure. **Refresh edit**: replace `#171` reference with "the new PR opened from this wave's execution branch."

---

## `.claude/wave-1a-prompt.md`

Spot-check of pre-flight (lines 27–43):

1–10: ✅ Hold (verified in `Repo snapshot` above; package.json scripts, vitest/playwright config, vercel.json, supabase migrations, supabase functions, progress log most-recent date, NEXT_SESSION_PLAN sections).

11. ⚠️ **Item 11** (line 39): `CLAUDE.md` (lowercase) exists at repo root; `git ls-files` shows it as `CLAUDE.md`; case-sensitive systems will see the lowercase form only; all references in this wave use the lowercase form.
   → Drift: `git ls-files CLAUDE.md CLAUDE.md` returns BOTH files. Commit `3e7888d` ("chore(agents): add /wave slash command, /wave-status, and CLAUDE.md") added `CLAUDE.md` separately from Wave 8.
   → Both files presently exist; the project loads `CLAUDE.md` (per system context shown to agents). The lowercase `CLAUDE.md` is now the de-facto orphan.
   → **Refresh edit (annotation only — no rescoping)**: append HTML comment `<!-- wave-0 2026-04-20: CLAUDE.md was added in commit 3e7888d before Wave 8 ran; both files currently exist. Wave 8 still owns the rename + cleanup; re-verify at Wave 8 pre-flight. -->` to item 11. Wave 8's plan body remains the canonical place to handle the cleanup.
12. ✅ Item 12: `tests/setup.js` imports `@testing-library/jest-dom`. Holds (per `PR-155-TRIAGE` progress-log entry).
13. ✅ Item 13: `docs/audits/` doesn't yet exist. Holds at Wave 1a pre-flight time (Wave 0 only adds `docs/audits/wave-0/`, not `wave-1a/`).

---

## `.claude/wave-8-prompt.md`

Spot-check of the Task 3 ("`CLAUDE.md` → `CLAUDE.md` rename") preamble (lines 13, 43, 211–229):

⚠️ **Wave 8 partial-completion drift**: Wave 8 Task 3 assumes that on entry, only `CLAUDE.md` (lowercase) exists. As of `2026-04-20`, both files exist — the rename is partially done (the new file has been created; the old file has not been removed; the cross-repo reference sweep has not been run).

- **Refresh edit (annotation only — no rescoping)**: append HTML comment `<!-- wave-0 2026-04-20: CLAUDE.md was created in commit 3e7888d before Wave 8 ran. As of Wave 8 pre-flight, the rename is partially done: both files coexist. Task 3 must adapt: (a) verify the two files have identical content (operator: `diff CLAUDE.md CLAUDE.md`); (b) if identical, `git rm CLAUDE.md` instead of `git mv`; (c) reference sweep proceeds as planned. If contents differ, HALT and reconcile before proceeding. -->` adjacent to the Wave 8 Task 3 commit-message line (line 213).
- Task count and scope are preserved; Task 3 still ships rename + sweep.

---

## Other planning files (not individually audited)

`wave-1b-prompt.md`, `wave-2-prompt.md`, `wave-3a-prompt.md`, `wave-3b-prompt.md`, `wave-4-prompt.md`, `wave-5-prompt.md`, `wave-6a-prompt.md`, `wave-6b-prompt.md`, `wave-7a-prompt.md`, `wave-7b-prompt.md`, `wave-9a-prompt.md`, `wave-9b-prompt.md`, `wave-execution-protocol.md`:

No drift found at the level of repo facts that have shifted since `2026-04-17/18`. Each plan's pre-flight references repo state (migration filenames, function names, env vars, RLS policy patterns) that has not been altered between authoring and `2026-04-20`. Each wave's own pre-flight gate per `wave-execution-protocol.md` §2 will re-verify at execution time. **No refresh edits queued.**

---

## Cross-plan consistency

No cross-plan inconsistencies surfaced in this audit pass. All plans use the `YYYYMMDDHHMMSS_*.sql` migration naming convention; the `40/63` E2E baseline is consistently cited; `1.0.0 → 1.0.1` version bump is consistently scoped to Wave 9a.

---

## Dependency graph

The 14 wave plans + Wave 0 sequence is intact:

```
Wave 0 (this) → 1a → 1b → 2 → 3a → 3b → 4 → 5 → 6a → 6b → 7a → 7b → 8 → 9a → 9b
```

The `CLAUDE.md`/`CLAUDE.md` early-creation does NOT break the dependency graph. Wave 8 still owns the cleanup; Waves 1a–7b will see both files coexist (acceptable — the system loads `CLAUDE.md` already).

---

## Deferred to later waves

- **`CLAUDE.md` redundancy** (Wave 8 owns): both files exist; cleanup happens at Wave 8 Task 3. No earlier wave should attempt the cleanup.
- **Live-DB advisor verification** (Wave 2 owns): `import_efficiency_metrics` view security mode, `raw-imports` bucket privacy, 6 search-path functions, leaked-password setting — all require Supabase dashboard or live-DB access. Wave 2's pre-flight re-verifies.
- **Sentry DSN** (Wave 2 / Wave 9 owns): `VITE_SENTRY_DSN` Vercel env var presence — operator-action item, not auto-verifiable.
- **CI baseline counts** (each wave's own Task 1 captures): test counts, lint warning counts, bundle sizes — captured at each wave's own pre-flight. Wave 0 does not snapshot these.

---

## Summary of refresh edits queued for Task 2

1. `.claude/wave-0-prompt.md` line 21 — generalize the branch-name assertion.
2. `.claude/wave-0-prompt.md` line 22 — generalize the `git rev-parse` assertion.
3. `.claude/wave-0-prompt.md` line 23 — generalize the `git log origin/main..HEAD` assertion.
4. `.claude/wave-0-prompt.md` line ~41 — replace `#171` reference in Branch Conventions with neutral "this wave's PR" wording.
5. `.claude/wave-1a-prompt.md` line 39 — append HTML comment annotating the partial `CLAUDE.md` creation.
6. `.claude/wave-8-prompt.md` line 213 — append HTML comment annotating the partial-rename state Task 3 will encounter.

All six edits preserve task count, scope, branch-name conventions, and the `Wave purpose` / `Operating mandate` paragraphs. Each is a single-line annotation or one-clause replacement.

---

## Self-review

- Every `⚠️` / `❌` row above maps to a Summary table count and to a line in "Refresh edits queued."
- No assertion edits propose changes to task counts, scope, or branch names that downstream plans depend on.
- All deferred items name the wave that owns the verification.
- The Wave 0 self-drift (own branch name) is documented openly so the next agent doesn't trip on it.
