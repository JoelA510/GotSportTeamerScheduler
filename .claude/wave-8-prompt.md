# Wave 8 — Docs Gap Closure + `CLAUDE.md` → `CLAUDE.md` Rename

## Session Context

**Prior waves**: 1a, 1b, 2, 3a, 3b, 4, 5, 6a, 6b, 7a, 7b shipped. Across those waves the repo has accumulated a lot of new documentation (operations, testing, security, audits). Wave 8 is the unified cleanup pass: write the two architecture docs that have been inline-only since v1.0, backfill "Known Gaps" on every existing architecture doc, rename the agent-instructions file to Anthropic's canonical `CLAUDE.md`, and reorganize `docs/README.md` so every doc is discoverable.

**Audit backlog**: `docs/audits/wave-1a/index.md` `### Wave 8-docs` section. Read it before Task 1.

**Identified gaps** (per Phase 1 discovery + Wave 1a Task 3 audit):
- `docs/architecture/` covers 8 domains but has NO dedicated page for the persistence-RPC layer (governance-mandatory; documented only inline across `data-modeling.md` + `system-overview.md`).
- `docs/architecture/` has NO Edge-Functions inventory (functions exist in code but the "what exists, what it costs, when to add another" reference doesn't).
- None of the 8 existing architecture docs carry a "Known Gaps" section — readers can't tell what's in-flight vs deferred without spelunking the audit.
- `CLAUDE.md` is committed lowercase; Anthropic's convention is `CLAUDE.md`. Rename is safe with a two-step `git mv` that survives Windows' case-insensitive FS.
- `docs/README.md` pre-dates Waves 2–7 and doesn't index: `docs/operations/{bundle-budget,advisor-lint,edge-function-budget,storage-retention}.md`, `docs/testing/{test-helpers,pgtap,e2e-waivers}.md`, `docs/security/csp.md`, `docs/audits/wave-1a/**`, `docs/audits/wave-4-salvage/**`, etc.

**Wave 8 is**:
- Two new architecture docs (`persistence-rpc-layer.md`, `edge-functions-inventory.md`).
- "Known Gaps" sections on 8 existing architecture docs.
- Rename `CLAUDE.md` → `CLAUDE.md` + sweep all references across the repo.
- Reorganize `docs/README.md` so everything added in Waves 2–7 is discoverable.
- Closure: audit index + progress log.

**Wave 8 is NOT**:
- Writing net-new content beyond the two specified docs.
- Moving docs between directories (scope creep).
- Archiving stale docs.
- Rewriting existing architecture content (Known Gaps sections are ADDITIVE only — don't re-read and rewrite).
- Touching `docs/archive/**` (it's archived; don't disturb).
- Changing the docs index structure beyond adding links.
- Adding new diagrams or asset files.

---

## Pre-flight Verification

HALT on any false claim.

1. `git status` on `main` is clean.
2. All prior waves merged — `.claude/wave-{1a,1b,2,3a,3b,4,5,6a,6b,7a,7b}-prompt.md` exist.
3. `docs/audits/wave-1a/index.md` `### Wave 8-docs` section readable.
4. `docs/architecture/` contains the 8 documented domains: `system-overview.md`, `frontend-architecture.md`, `data-modeling.md`, `game-scheduling.md`, `practice-scheduling.md`, `team-generation.md`, `evaluation-pipeline.md`, `output-generation.md` (plus `multi_tenancy.md` per Phase 1). Confirm the exact file set — if drift, reconcile the Task 2 list.
5. `docs/README.md` exists (baseline for Task 4).
6. `claude.md` (lowercase) is committed per `git ls-files claude.md CLAUDE.md`. The file appears as `claude.md` — git tracks the lowercase name even on Windows.
7. No `CLAUDE.md` is separately committed (case-insensitive FS may show both names for the same file; `git ls-files` is authoritative).
8. Wave 7 closed with no outstanding CSP or pgTAP doc debt — `docs/security/csp.md` + `docs/testing/pgtap.md` present.
9. Wave 6 closed — `docs/operations/{bundle-budget,advisor-lint,edge-function-budget,storage-retention}.md` all present.
10. Wave 5 closed — `docs/testing/e2e-waivers.md` present (may be empty body).
11. Wave 3b closed — `docs/testing/test-helpers.md` present.
12. Baselines: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run frontend:build`, `npm run check:bundle`, `npm run check:advisors` all green.

---

## Branch Conventions

- One branch per task, cut from `main`:
  - `claude/wave-8-new-arch-docs` → Task 1
  - `claude/wave-8-known-gaps` → Task 2
  - `claude/wave-8-rename-claude-md` → Task 3
  - `claude/wave-8-readme-reorg` → Task 4 (depends on 1 + 3)
  - `claude/wave-8-closure` → Task 5 (depends on all)
- Tasks 1, 2, 3 are independent and can merge in any order.
- Task 4 waits on 1 (so it can link the new docs) and 3 (so the `CLAUDE.md` reference is live).
- Task 5 lands last.

PR per task. CI gates from Waves 6a + 7a stay green throughout.

---

## Wave Scope

Five tasks: two new docs, eight Known-Gaps additions, one rename, one index reorg, one closure. Every task touches `docs/` only; no source code edits; no test edits.

---

## Task 1 — Two New Architecture Docs

**Commit**: `docs(architecture): add persistence-rpc-layer and edge-functions-inventory`

**Branch**: `claude/wave-8-new-arch-docs`

### Steps

1. Checkout `claude/wave-8-new-arch-docs` from latest `main`.

2. **Write `docs/architecture/persistence-rpc-layer.md`** — canonical reference for the RPC-based persistence model mandated by `CLAUDE.md` §3.

   Structure:
   - `## Purpose` — why RPCs, not direct `.upsert()` / `.update()` from the frontend: transactional integrity, audit-log append, multi-table writes, Zod-validated payloads.
   - `## Call-site contract` — frontend calls `supabase.rpc(name, payload)`. Zod schema validates the payload BEFORE the call. The RPC handles RLS-aware insertion.
   - `## Canonical RPCs` — table inventory: `initialize_new_tenant`, `record_audit_event`, `persist_evaluation_run`, `rotate_calendar_token`, `clone_project_template` (if present), per-domain persistence RPCs the codebase actually uses. For each: signature + return shape + when-to-call + caller inventory (file paths via `grep -rn "supabase.rpc('<name>'"` at doc-authoring time).
   - `## Error shape` — standard Supabase error response: `{ data, error: { message, code, details, hint } }`. The frontend surfaces errors via toast / inline field errors per feature.
   - `## Audit-log invariant` — every state-altering RPC appends an `audit_log` row with `{ actor, action, resource_type, resource_id, metadata, created_at }`. Missing entries = missing governance coverage.
   - `## Adding a new RPC` — step-by-step: migration adds the function; `SECURITY DEFINER` + `SET search_path = public` (Wave 2 baseline); Zod schema in `frontend/src/lib/schemas/`; unit test covering the happy path + validation error; audit-log assertion in the test.
   - `## Gotchas` — direct `.upsert()` on domain tables is forbidden except via an RPC; transactional writes across multiple tables MUST go through an RPC; RLS bypass via `SECURITY DEFINER` requires the `SET search_path` hardening.

   Target length: ~80–120 lines. This is a reference, not a tutorial.

3. **Write `docs/architecture/edge-functions-inventory.md`** — canonical list of every `supabase/functions/*` function + its purpose, invocation pattern, and free-tier budget share.

   Structure:
   - `## Overview` — what Edge Functions are for (server-side logic that can't live in RPCs: external HTTP calls, heavy compute, cron-style tasks). Pointer to `docs/operations/edge-function-budget.md` (Wave 6b) for the monthly-invocation budget.
   - `## Inventory` — one sub-section per function (`_shared` first for shared utilities, then alphabetically):
     - Path: `supabase/functions/<name>/index.ts`.
     - Purpose (1 paragraph).
     - Primary callers (frontend paths or cron entries).
     - Monthly-invocation projection at 100-org steady state (pull from Wave 6b doc).
     - Key dependencies (external APIs; shared utilities under `_shared`).
     - Failure modes + retry policy.
   - `## Adding a new function` — when to add vs extend an existing one; budget impact; deployment flow (`supabase functions deploy <name>`); Wave-6a advisor-lint implications (if the function creates DB objects, those fall under migration scrutiny).
   - `## Retirement / removal` — when to drop a function and the migration pattern (callers switch to direct-RPC or migrate to client-side; then `supabase functions delete <name>`).

   Target length: ~100–150 lines. Inventory tables are compact.

4. **Cross-reference the two docs** — `persistence-rpc-layer.md` mentions Edge Functions that WRAP RPCs (if any), and `edge-functions-inventory.md` mentions which functions are thin RPC wrappers vs. independent logic. Both link to `docs/operations/edge-function-budget.md` for cost context and to `CLAUDE.md` §3 for the RPC mandate.

5. Verification gate:
   ```bash
   npm run lint && npm run typecheck && npm run test
   npm run check:advisors && npm run check:bundle
   npm run frontend:build
   npm run format -- docs/architecture/persistence-rpc-layer.md docs/architecture/edge-functions-inventory.md
   git status
   ```

6. Commit, push, open PR. PR body includes: the two doc outlines, the RPC + function inventory tables.

### Tests to add (Task 1)

- None. Doc-only.

### Out of scope (Task 1)

- Editing existing architecture docs (Task 2).
- Linking the new docs from `docs/README.md` (Task 4).
- Rewriting `data-modeling.md` or `system-overview.md` to remove the inline RPC / function mentions (they stay; the new docs are canonical + the old docs point at them).
- Generating function call graphs or diagrams.
- Performance documentation for Edge Functions (separate concern).

---

## Task 2 — "Known Gaps" Sections on 8 Architecture Docs

**Commit**: `docs(architecture): add known-gaps sections to existing arch docs`

**Branch**: `claude/wave-8-known-gaps`

### Steps

1. Checkout `claude/wave-8-known-gaps` from latest `main`.

2. **Identify the 8 docs** — from `docs/architecture/`. Confirm the exact set against the pre-flight inventory. Typical set:
   - `system-overview.md`
   - `frontend-architecture.md`
   - `data-modeling.md`
   - `game-scheduling.md`
   - `practice-scheduling.md`
   - `team-generation.md`
   - `evaluation-pipeline.md`
   - `output-generation.md`
   - `multi_tenancy.md` (if present; the 9th)

3. **For each doc**, append a `## Known Gaps` section at the bottom (or just above any `## References` / `## Changelog` section if one exists). Content sourced from `docs/audits/wave-1a/` findings tagged for that domain + any Wave 8 re-files. Template:

   ```markdown
   ## Known Gaps

   Items in-flight, deferred, or explicitly waived as of 2026-MM-DD.
   See `docs/audits/wave-1a/` for the canonical audit record + finding IDs.

   | Finding | Status | Target | Notes |
   | --- | --- | --- | --- |
   | F-3-XX | Deferred | v1.1 | <short description> |
   | F-4-YY | Waived | — | <why waived> |

   When a gap resolves, move it to a brief mention in the canonical
   section above (with a pointer to the shipping PR) and strike it here.
   ```

4. **Source the rows** — for each doc's domain:
   - Walk `docs/audits/wave-1a/index.md` for findings mentioning that domain.
   - Filter to findings NOT marked `✅ shipped` in the audit index. Those are the live gaps.
   - For each live gap: populate Finding (ID), Status (Deferred / Waived / In-flight), Target (wave / v1.1 / "ongoing"), Notes (one line).

5. **Stay additive** — do NOT rewrite or re-structure the existing architecture content. Each doc gets ONE new section appended; nothing above is touched. If a doc's existing text contains a sentence now contradicted by a known gap, add a footnote-style cross-reference but don't rewrite.

6. **Handle docs with zero live gaps** — if a domain has no open findings, the Known Gaps section still exists with body "No known gaps as of 2026-MM-DD." Keeps the heading consistent across docs so readers always know where to look.

7. Verification gate:
   ```bash
   npm run lint && npm run typecheck && npm run test
   npm run check:advisors && npm run check:bundle
   npm run format -- docs/architecture/*.md
   git status                       # only docs/architecture/*.md modified
   ```

8. Commit, push, open PR. PR body lists each doc + the finding count it received.

### Tests to add (Task 2)

- None.

### Out of scope (Task 2)

- Editing content above the Known Gaps heading in any doc.
- Adding new architecture docs (Task 1).
- Updating `docs/README.md` (Task 4).
- Resolving any gap (those go to later v1.1 waves).

---

## Task 3 — `CLAUDE.md` → `CLAUDE.md` Rename + Reference Sweep

<!-- wave-0 2026-04-20: drift — `CLAUDE.md` was created in commit 3e7888d on 2026-04-20 BEFORE Wave 8 ran. As of Wave 8 pre-flight, both `claude.md` and `CLAUDE.md` coexist. Adapt Task 3 as follows: (a) verify the two files have identical content (operator: `diff claude.md CLAUDE.md`); (b) if identical, use `git rm claude.md` instead of `git mv claude.md CLAUDE.md`; (c) reference sweep proceeds as planned. If contents differ, HALT and reconcile before proceeding. Task count and scope are preserved. -->

**Commit**: `chore(docs): rename CLAUDE.md to CLAUDE.md + sweep references`

**Branch**: `claude/wave-8-rename-claude-md`

### Steps

1. Checkout `claude/wave-8-rename-claude-md` from latest `main`.

2. **Rename with a two-step `git mv`** to survive Windows's case-insensitive filesystem. Use the FINAL target commit message from the start — `--amend --no-edit` preserves whatever message the first commit carried:
   ```bash
   git mv claude.md __rename_tmp_CLAUDE.md
   git commit -m "chore(docs): rename claude.md to CLAUDE.md + sweep references"
   git mv __rename_tmp_CLAUDE.md CLAUDE.md
   git commit --amend --no-edit  # folds both moves into one logical rename commit
   ```
   (If the local git is configured with `core.ignoreCase = false`, a direct `git mv CLAUDE.md CLAUDE.md` works; use whichever the environment supports. The two-step pattern always works.)

3. **Verify git tracks the new name**:
   ```bash
   git ls-files CLAUDE.md           # returns CLAUDE.md
   git ls-files CLAUDE.md           # returns nothing
   ```

4. **Sweep all references** across the tracked files:
   ```bash
   git grep -l "claude\.md"         # lists every tracked file containing the lowercase reference
   ```
   For each file in the list:
   - If the file is a wave plan (`.claude/wave-*-prompt.md`) OR a doc (`docs/**/*.md`) OR a top-level doc (`README.md`, etc.): replace `CLAUDE.md` → `CLAUDE.md`.
   - If the file is source code (unlikely but possible): replace only if the reference is a doc link; if it's a code-level string used elsewhere, surface and decide.
   - If the file is in `docs/archive/**`: **DO NOT edit**. Archive is immutable history.

   Practical one-liner (confirm pattern first; expect ~20–40 occurrences). **Preferred: cross-platform Node one-liner** — works on Windows PowerShell + Git Bash + macOS + Linux without quirks:
   ```bash
   node -e "
     const { execSync } = require('child_process');
     const fs = require('fs');
     const files = execSync('git grep -z -l \"claude\\.md\" -- \":!docs/archive/**\"')
       .toString().split('\0').filter(Boolean);
     for (const f of files) {
       fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/claude\\.md/g, 'CLAUDE.md'));
     }
     console.log('Swept', files.length, 'files');
   "
   ```

   **Alternatives** (Bash environments only):
   ```bash
   # GNU sed (Linux + Git Bash on Windows):
   git grep -z -l "claude\.md" -- ':!docs/archive/**' | xargs -0 sed -i 's/claude\.md/CLAUDE.md/g'

   # BSD sed (macOS default — note the empty-string arg after -i):
   git grep -z -l "claude\.md" -- ':!docs/archive/**' | xargs -0 sed -i '' 's/claude\.md/CLAUDE.md/g'
   ```

   `-z` / `-0` is load-bearing: it makes the pipeline tolerate filenames containing spaces or newlines.

5. **Verify zero remaining lowercase references outside the archive**:
   ```bash
   git grep "claude\.md" -- ':!docs/archive/**'   # expect zero output
   git grep "claude\.md" -- 'docs/archive/**'     # archive references are OK (historical)
   ```

6. **Explicitly exempt**:
   - `docs/archive/**` (history).
   - Any non-tracked file (`node_modules/`, `dist/`, etc. — git grep already excludes these).
   - Your own `.claude/wave-8-prompt.md` file if it's the one being edited right now — the meta-reference in "Task 3 renames `CLAUDE.md` → `CLAUDE.md`" can stay as-is, OR update for consistency (both are defensible; prefer update for uniformity).

7. **Reference-sweep scope confirmation** — the wave plans in `.claude/` DO get updated in this sweep. They refer to `CLAUDE.md` as an instruction-file path; after the rename, that path is `CLAUDE.md`. Future agents executing those plans find the file correctly.

8. **Do NOT**:
   - Update `docs/archive/**` (history).
   - Update `CHANGELOG.md` (Wave 9 handles release notes).
   - Rewrite the content of `CLAUDE.md` itself beyond the filename (Wave 9 may update content; Wave 8 just renames).
   - Edit `package.json` (no references expected; verify with grep).
   - Create a `CLAUDE.md` redirect / placeholder.

9. **CI + lint must stay green** — the rename doesn't change content; only filename. Lint + tests should pass unchanged.

10. Verification gate:
    ```bash
    npm run lint && npm run typecheck && npm run test
    npm run check:advisors && npm run check:bundle
    npm run frontend:build
    git ls-files CLAUDE.md && ! git ls-files CLAUDE.md  # file lookup confirms rename
    git grep "claude\.md" -- ':!docs/archive/**'        # zero
    git status
    ```

11. Commit, push, open PR. PR body lists the reference-sweep file count + an explicit callout that archive/** was intentionally skipped.

### Tests to add (Task 3)

- None.

### Out of scope (Task 3)

- Editing `CLAUDE.md`'s content.
- Updating `docs/archive/**`.
- Creating a lowercase-compat symlink or redirect.
- Release-notes entry (Wave 9).

---

## Task 4 — `docs/README.md` Reorganization

**Commit**: `docs(readme): reorganize index to include waves 2-7 additions`

**Branch**: `claude/wave-8-readme-reorg`

**Depends on**: Tasks 1 + 3 merged (so the new arch docs + `CLAUDE.md` exist when linking).

### Steps

1. Checkout `claude/wave-8-readme-reorg` from latest `main` AFTER Tasks 1 + 3 merge.

2. **Inventory every `docs/*.md` + `docs/**/*.md` file** that needs a link. Expected categories (cross-reference Phase 1 discovery + new docs from Waves 2–8):
   - **Architecture** (`docs/architecture/`) — 8 existing + 2 new = 10 docs.
   - **Governance** (`docs/governance/`) — 7 files.
   - **Security** (`docs/security/`) — `rls-policies.md`, `audit_and_remediation_plan.md`, `csp.md` (Wave 7b new).
   - **Operations** (`docs/operations/`) — `production-cutover.md`, `ENVIRONMENT.md`, `ingestion-pipeline.md`, `sentry-smoke.md` (Wave 2), `bundle-budget.md` (Wave 6a), `advisor-lint.md` (Wave 6a), `edge-function-budget.md` (Wave 6b), `storage-retention.md` (Wave 6b).
   - **Testing** (`docs/testing/`) — `e2e_master_plan.md`, `test-helpers.md` (Wave 3b), `pgtap.md` (Wave 7a), `e2e-waivers.md` (Wave 5).
   - **Expansion / Roadmap** (`docs/expansion/`) — existing files.
   - **Audits** (`docs/audits/`) — `wave-1a/**` + `wave-4-salvage/**` (Wave 4 Task 1).
   - **SQL** (`docs/sql/`) — retained for reference; may not need top-level index.
   - **Archive** (`docs/archive/`) — pointer only, no per-file enumeration.

3. **Update `docs/README.md`** — additive reorganization:
   - Preserve the existing "Quick Navigation" or equivalent top section.
   - Under each category heading, add links to any new docs missing from the index.
   - Add a new `### Audits` category with a link to `docs/audits/wave-1a/index.md` as the main entry point.
   - Ensure every `docs/**/*.md` is reachable within 2 clicks from `docs/README.md`.
   - Keep the file under ~120 lines — it's an index, not a manual.

4. **Final repository-wide reference sweep** — Tasks 1 + 2 created / modified docs that may have introduced fresh `CLAUDE.md` references if they were drafted against an older version of Wave 8. Re-run the sweep (same command as Task 3 Step 4) across the whole repo excluding `docs/archive/**`. This is the belt-and-suspenders guarantee that NO `CLAUDE.md` (lowercase) survives outside the archive after Wave 8 closes. The sweep should find zero or handful of occurrences (Task 1/2 drift); if more than 10, something went wrong — HALT and investigate before Task 4 merges.

5. **Do NOT**:
   - Move files between directories.
   - Rewrite the existing "Reading Path for New Contributors" sub-section unless adding a link (append-only edit).
   - Remove links to archived docs (their pointers stay).
   - Add per-file summaries beyond the existing one-line format.

6. Verification gate:
   ```bash
   npm run lint && npm run typecheck && npm run test
   npm run check:advisors && npm run check:bundle
   npm run format -- docs/README.md
   git status                       # only docs/README.md changed
   ```

7. Commit, push, open PR. PR body lists the added links per category.

### Tests to add (Task 4)

- None.

### Out of scope (Task 4)

- Creating new docs.
- Restructuring directory layout.
- Archiving old docs.
- Writing summaries for linked docs (they live in the docs themselves).

---

## Task 5 — Closure

**Commit**: `docs(wave-8): closure — docs gap closure + rename shipped`

**Branch**: `claude/wave-8-closure`

**Depends on**: Tasks 1–4 merged.

### Steps

1. Checkout `claude/wave-8-closure` from latest `main` AFTER Tasks 1–4 merge.

2. **Update `docs/audits/wave-1a/index.md`** — Wave-8-docs findings: prepend `✅`, set `Proposed wave` to `8 (shipped)`. Append a `## Wave 8 closure` section summarizing: 2 new arch docs, Known-Gaps on 8 (or 9) existing docs, filename rename, README reorg.

3. **Append to `docs/expansion/98_PROGRESS_LOG.md`**:
   ```
   ## 2026-MM-DD — Wave 8 docs gap closure + CLAUDE.md rename

   Five PRs shipped:
   - Task 1: docs/architecture/persistence-rpc-layer.md + docs/architecture/edge-functions-inventory.md.
   - Task 2: Known Gaps sections added to <N> existing architecture docs.
   - Task 3: CLAUDE.md → CLAUDE.md rename + <M>-file reference sweep (archive/** skipped).
   - Task 4: docs/README.md reorganized — every docs/** file reachable in ≤ 2 clicks.
   - Task 5: closure.
   ```

4. Verification:
   ```bash
   npm run lint && npm run typecheck && npm run test
   npm run check:advisors && npm run check:bundle
   npm run frontend:build
   npm run format -- docs/audits/wave-1a/index.md docs/expansion/98_PROGRESS_LOG.md
   git status
   ```

5. Commit, push, open PR.

### Tests to add (Task 5)

- None.

### Out of scope (Task 5)

- Editing `.claude/wave-*.md` beyond the Task 3 sweep (already done).
- Archiving docs.

---

## Documentation Currency Pass

Handled across Tasks 1–5:
1. `docs/architecture/persistence-rpc-layer.md` (new — Task 1).
2. `docs/architecture/edge-functions-inventory.md` (new — Task 1).
3. `docs/architecture/*.md` — Known Gaps sections (Task 2).
4. `CLAUDE.md` (renamed from `CLAUDE.md` — Task 3).
5. All tracked files with `CLAUDE.md` references swept to `CLAUDE.md` (Task 3; archive skipped).
6. `docs/README.md` — reorg (Task 4).
7. `docs/audits/wave-1a/index.md` — Wave-8-docs findings shipped (Task 5).
8. `docs/expansion/98_PROGRESS_LOG.md` — dated entry (Task 5).

Do NOT touch: `docs/archive/**` (immutable), `CLAUDE.md` (doesn't exist post-Task-3), source code.

---

## Wave Review (Mandatory Before Final Merge)

Any "no" blocks push.

1. All 5 tasks merged with CI green.
2. `docs/architecture/persistence-rpc-layer.md` + `docs/architecture/edge-functions-inventory.md` exist.
3. Every doc in `docs/architecture/` has a `## Known Gaps` section.
4. `git ls-files CLAUDE.md` returns the file; `git ls-files CLAUDE.md` returns nothing.
5. `git grep "claude\.md" -- ':!docs/archive/**'` returns zero matches.
6. `docs/README.md` links every doc shipped in Waves 2–8 that should be in the index.
7. `npm run lint` warning count ≤ baseline.
8. `npm run typecheck`: 0 errors.
9. `npm run test`: 100 % pass; case count unchanged.
10. `npm run frontend:build`: bundle sizes unchanged (doc-only wave).
11. `npm run check:advisors` + `npm run check:bundle`: green.
12. No source-code changes: `git diff main~N main -- frontend/ packages/ supabase/` returns empty (N = commits this wave).
13. No new dep in `package.json`.
14. No change to test-runner configs.
15. **Test-impact reconciled**: zero test additions. Zero test modifications.

---

## Commit & Push to Main

1. Tasks 1, 2, 3 in any order.
2. Task 4 after 1 + 3.
3. Task 5 last.
4. After all 5 merge:
   ```bash
   git checkout main && git pull
   npm run lint && npm run typecheck && npm run test && npm run frontend:build
   npm run check:advisors && npm run check:bundle
   ```
   All green.
5. On regression: revert PR within 30 min.

---

## Verification Gate (Per Task, Before Push)

For Tasks 1, 2, 4, 5:
```bash
npm run lint && npm run typecheck && npm run test
npm run check:advisors && npm run check:bundle
npm run frontend:build
git status
```

For Task 3 additionally:
```bash
git ls-files CLAUDE.md           # CLAUDE.md appears
git ls-files CLAUDE.md           # empty
git grep "claude\.md" -- ':!docs/archive/**'   # empty
```

Each `FAIL → HALT`.

---

## Key References

- `docs/audits/wave-1a/index.md` § Wave 8-docs.
- Current `CLAUDE.md` (post-Task-3) — §3 RPC mandate, §5 conventions, §7 Supabase.
- `docs/architecture/**` — domain inventory.
- `docs/operations/edge-function-budget.md` — feeds Task 1's edge-functions-inventory doc.

---

## Critical Files

**Will create**:
- `docs/architecture/persistence-rpc-layer.md` (Task 1)
- `docs/architecture/edge-functions-inventory.md` (Task 1)

**Will edit**:
- `docs/architecture/{system-overview,frontend-architecture,data-modeling,game-scheduling,practice-scheduling,team-generation,evaluation-pipeline,output-generation,multi_tenancy}.md` — append Known Gaps (Task 2)
- `CLAUDE.md` (renamed from `CLAUDE.md` — Task 3; content itself unchanged)
- Every tracked file with a `CLAUDE.md` reference outside `docs/archive/**` (Task 3 sweep) — includes `.claude/wave-*.md`, `docs/**/*.md`, `README.md` if applicable
- `docs/README.md` (Task 4)
- `docs/audits/wave-1a/index.md` (Task 5)
- `docs/expansion/98_PROGRESS_LOG.md` (Task 5)

**Will NOT edit**:
- Any file under `frontend/src/`, `packages/core/src/`, `supabase/`.
- `package.json`, `package-lock.json`.
- `vite.config.js`, `vitest.config.js`, `playwright.config.ts`, `eslint.config.js`, `tsconfig.json`, `.prettierrc`.
- Test files (any).
- `docs/archive/**` (immutable history).
- `docs/audits/wave-1a/*.md` sub-reports (frozen).

---

## Out of Scope This Wave

- Net-new content beyond the two specified docs.
- Moving docs between directories.
- Archiving stale docs.
- Rewriting existing architecture content.
- Directory restructuring.
- New diagrams / assets.
- CHANGELOG (Wave 9).
- Version bump (Wave 9).
- Any production code change.
- Any test change.
- Renaming other files beyond `CLAUDE.md` → `CLAUDE.md`.

---

## Ground Rules

- **Additive everywhere**. New arch docs, new Known Gaps sections, renamed file, expanded README index. No rewrites of existing content.
- **Archive is immutable**. `docs/archive/**` keeps its historical `CLAUDE.md` references as a record of that era; Task 3's sweep explicitly skips it.
- **Two-step rename is mandatory on Windows**. `git mv` through a temp filename avoids case-insensitive FS bugs. Even on Linux the pattern is harmless.
- **Known Gaps are reference-linked**. Every row in a Known Gaps table cites a finding ID from `docs/audits/wave-1a/`. No free-form gap claims.
- **No source-code changes**. This is strictly a docs + filename wave.
- **Rename sweep includes `.claude/wave-*.md`**. This is the ONE wave that edits prior wave plans; the edits are find-replace only (`CLAUDE.md` → `CLAUDE.md`), no content change.
- **No `--no-verify`, no `--force-push`, no direct commits to `main`**.
- **5-attempt debugging cap** per task.
