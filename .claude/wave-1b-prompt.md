# Wave 1b — Audit Triage (P0-Trivial Fixes + Wave Distribution)

## Session Context

**Prior-wave recap**: Wave 1a shipped the READ-ONLY audit across 5 domains (code-quality, security, Supabase-performance, free-tier-usage, accessibility). Findings live under `docs/audits/wave-1a/` in 5 sub-reports, a consolidated `index.md`, and a `README.md` (7 files total). Every finding carries a `Proposed wave` tag: `1b-trivial`, `2-security`, `3-test-infra`, `4-onboarding`, `5-e2e`, `6-free-tier`, `7-db-test`, `8-docs`, or `9-release`.

**This wave's job**: (a) apply every `1b-trivial` fix inline, and (b) update `docs/audits/wave-1a/index.md` so each finding is marked `[x] fixed in Wave 1b` OR `[→] promoted to Wave N`. No finding leaves the distribution table unaccounted for.

**Trivial bar (strict)**: a fix qualifies as P0-trivial only if it meets ALL of these:
- Zero behavior change for any end-user flow.
- Zero test code modifications required.
- Fix takes ≤15 minutes including lint/typecheck/test/build verification.
- Touches ≤3 files per finding.
- No dependency add/remove/upgrade.
- No schema/migration change.
- No config change to `vercel.json`, `vitest.config.js`, `playwright.config.ts`, `vite.config.js`, `eslint.config.js`, `tsconfig.json`, or any Supabase function config.
- No PII exposure risk.
- No security-surface change (even a comment change in an RLS-adjacent migration re-files as P1 for Wave 2).

If during execution any "trivial" fix violates the bar, **re-file it** (update the finding's `Severity` to P1/P2 + change `Proposed wave` to the appropriate target) and move on. Do not force a non-trivial fix into this wave.

**Wave is NOT**:
- The NEXT_SESSION_PLAN §1–3 work (those are Wave 2).
- The 23 pre-existing E2E failures (Wave 5).
- Bundle-size or DB-index changes (Wave 6).
- Onboarding refactor (Wave 4).
- Architecture doc rewrites or the `claude.md` → `CLAUDE.md` rename (Wave 8).
- Version bumps or CHANGELOG entries (Wave 9).

---

## Pre-flight Verification

Verify each. **HALT** on any false claim — do NOT auto-create missing files.

1. `docs/audits/wave-1a/index.md` exists, is committed to `main`, and contains:
   - A `## Distribution table` section.
   - Sub-headings `### Wave 1b-trivial`, `### Wave 2-security`, `### Wave 3-test-infra`, `### Wave 4-onboarding`, `### Wave 5-e2e`, `### Wave 6-free-tier`, `### Wave 7-db-test`, `### Wave 8-docs`, `### Wave 9-release` (one per target).
   - A `## Top-10 register`.
   - A "Wave 1b kickoff cheat sheet" block at the bottom listing every `1b-trivial` finding as a fenced-code list (produced by Wave 1a Task 5 step 7).
2. `docs/audits/wave-1a/{code-quality,security,supabase-performance,free-tier-usage,accessibility}.md` all exist, committed.
3. `docs/audits/wave-1a/README.md` exists.
4. `git status` on `main` is clean.
5. `npm run lint` on `main` produces the warning count recorded in `docs/audits/wave-1a/code-quality.md` under `## Baselines` (hereafter **the lint baseline**). HALT on drift — if main has drifted since Wave 1a closed, open a hotfix to reconcile before starting Wave 1b.
6. `npm run typecheck` on `main` produces 0 errors.
7. `npm run test` on `main` produces the test count recorded in the same `## Baselines` block (hereafter **the test baseline**) with 100% pass rate.
8. `npm run frontend:build` on `main` is clean.
9. The "Wave 1b kickoff cheat sheet" has at least 1 finding (if zero, the wave is a no-op — open a single PR that just updates the distribution table and close the wave).
10. No finding in the `### Wave 1b-trivial` section has an `Effort` of `L` (Effort must be `XS` or `S` for a trivial — otherwise re-classify before starting).

If steps 5–8 drift, the triage must first reconcile the baseline before applying fixes (the lint baseline cannot go UP during this wave).

---

## Branch Conventions

- One branch per task, cut from `main`:
  - `claude/wave-1b-code-quality` → Task 1
  - `claude/wave-1b-security-docs` → Task 2
  - `claude/wave-1b-accessibility` → Task 3
  - `claude/wave-1b-distribution` → Task 4 (lands LAST — depends on 1–3)
- Tasks 1–3 are independent code paths; they can merge in any order.
- Task 4's PR only updates `docs/audits/wave-1a/index.md` + `docs/expansion/98_PROGRESS_LOG.md`; it lands after 1–3 so it can accurately reflect what shipped.
- **Open a PR per task; do not push directly to `main`.** Merge only when CI is green.
- Branch-to-main rebase allowed; no force-pushes to `main`.

---

## Wave Scope

Three domain-scoped fix tasks + one consolidation task. Each fix-task batches findings from its sub-report into a single reviewable PR. The consolidation task closes out the wave by marking every finding `fixed` or `promoted` in the audit index.

Each fix-task operates from a single source of truth: the corresponding `### Wave 1b-trivial` entries in `docs/audits/wave-1a/index.md`, cross-referenced to the finding's original sub-report for full context (observation + recommended fix + effort).

---

## Task 1 — Code-Quality P0-Trivial Fixes

**Commit**: `chore(triage): wave-1b code-quality P0-trivial fixes`

**Branch**: `claude/wave-1b-code-quality`

**Source**: All findings in `docs/audits/wave-1a/index.md` tagged `Proposed wave: 1b-trivial` that originate from `docs/audits/wave-1a/code-quality.md`.

### Steps

1. Checkout `claude/wave-1b-code-quality` from latest `main`.

2. **Enumerate the scope** — read the index's `### Wave 1b-trivial` section. Filter to findings where the `Location` starts with a source path (`frontend/src/`, `packages/core/src/`, `supabase/functions/`, `scripts/`, `tests/` — but NOT `docs/`). These are the Task 1 candidates. Open each one's full entry in the origin sub-report to read `Recommended fix`.

3. **Pre-flight the baselines** locally:
   ```bash
   npm run lint    2>&1 | tail -10
   npm run typecheck 2>&1 | tail -10
   npm run test    2>&1 | tail -10
   ```
   Record the numbers in the PR description under `## Baselines`.

4. **Apply fixes one finding at a time**:
   - For each finding, edit only the file(s) in its `Location`.
   - After each finding, run `npm run lint` (fast); if it goes UP, revert and re-file.
   - Keep each finding's fix as a distinct logical chunk in the diff (but all commits roll into a single `chore(triage):` commit — no per-finding commits in this wave; splitting happens in later waves).
   - Common Task 1 categories and their trivial mechanics:
     - **Unused imports**: delete the import line only. If the name is used via side effect (`import 'foo/style.css'`), this is not an unused import — skip.
     - **Unused variables**: delete the variable if truly unreferenced. If it's a destructured prop, prefer `_name` prefix over removal (preserves callsite shape).
     - **Stale comments / dead links**: fix the text.
     - **Typos**: fix the character(s).
     - **Small whitespace / formatter drift**: `npm run format` on the affected file (do NOT run `npm run format` across the whole repo — scope the command with a path argument).
     - **Redundant early-return branches**: only if zero control-flow risk.
     - **`console.log` that should be `logger.info`**: swap the call; keep the arg list identical.
   - **Do NOT**:
     - Rename anything exported.
     - Move code between files.
     - Refactor function bodies.
     - Touch `packages/core/src/**` domain invariants.
     - Modify JSDoc parameter types (re-file as `2-security` or `3-test-infra` depending on scope).

5. **Verification between batches** (every ~5 findings):
   ```bash
   npm run lint
   npm run typecheck
   npm run test
   ```
   - Lint warning count must be ≤ baseline (should be LESS after this task).
   - Typecheck = 0 errors.
   - Test pass rate = 100%; count unchanged.

6. **Final task verification** — full gate before push:
   ```bash
   npm run lint
   npm run typecheck
   npm run test
   npm run frontend:build
   git status
   ```
   Each `FAIL → HALT`.

7. **Record outcomes** — for each finding processed, capture the outcome (`fixed`, `re-filed`, or `skipped — not trivial`) in a scratch list. This feeds Task 4's distribution update.

8. Commit (single commit per this task's PR). Push branch. Open PR titled `chore(triage): wave-1b code-quality P0-trivial fixes` with:
   - `## Baselines` block (before / after lint warnings + test count).
   - `## Outcomes` table: `| Finding | Before | After | Location changed |`.
   - `## Out of scope` list: any re-filed findings with their new severity + wave.

### Tests to add (Task 1)

None. Trivial fixes do not add tests. If a fix requires a test, it's not trivial — re-file to `3-test-infra`.

### Out of scope (Task 1)

- Security findings (Task 2 owns).
- Accessibility attribute adds (Task 3 owns).
- Supabase performance / DB work (Wave 6).
- Type-safety expansions (re-file to Wave 3 or Wave 9).
- ESLint rule additions or config edits.
- Dependency bumps.
- Test file edits.
- Migration edits.

---

## Task 2 — Security / Config / Docs P0-Trivial Fixes

**Commit**: `chore(triage): wave-1b security & config P0-trivial fixes`

**Branch**: `claude/wave-1b-security-docs`

**Source**: All findings in `docs/audits/wave-1a/index.md` tagged `Proposed wave: 1b-trivial` that originate from `docs/audits/wave-1a/security.md` OR `docs/audits/wave-1a/code-quality.md` where the `Location` is `docs/**`, `.env.*.example`, `README.md`, `claude.md`, `vercel.json`, or `.github/workflows/*.yml`.

Typical items here:
- Stale doc links.
- `.env.*.example` comments out-of-date.
- README badges showing wrong build/test status.
- CSP directive ordering (without semantic change).
- Commented-out TODO blocks in migrations (that can be safely deleted).

**NOT in scope for this task** (these ALL go to Wave 2):
- Any RLS policy edit.
- Any `SECURITY DEFINER` → `SECURITY INVOKER` change.
- Any `SET search_path` addition to a function.
- Any `raw-imports` bucket policy change.
- Any new env var addition.
- Any `npm audit fix` run.
- Any Dependabot upgrade.

### Steps

1. Checkout `claude/wave-1b-security-docs` from latest `main`.
2. Enumerate the scope — filter the index as described in "Source" above.
3. Apply fixes one finding at a time (same discipline as Task 1 Step 4).
4. **No `.env.local` / `.env.test` edits.** Only `.env.*.example` files.
5. **No `vercel.json` structural edits** — only whitespace / comment / ordering. Any directive add/remove/change re-files to Wave 2.
6. **Documentation edits must preserve prettier formatting** — run `npm run format -- <file>` before committing.
7. Verification gate:
   ```bash
   npm run lint && npm run typecheck && npm run test && npm run frontend:build && git status
   ```
   Each `FAIL → HALT`.
8. Commit, push, open PR with the same structure as Task 1 (Baselines, Outcomes, Out of scope).

### Tests to add (Task 2)

None.

### Out of scope (Task 2)

- Everything listed under "NOT in scope for this task" above.
- `claude.md` rename or restructure (Wave 8).
- `docs/architecture/*.md` content edits (Wave 8).
- Doc gap closure (Wave 8).

---

## Task 3 — Accessibility P0-Trivial Fixes

**Commit**: `chore(triage): wave-1b accessibility P0-trivial fixes`

**Branch**: `claude/wave-1b-accessibility`

**Source**: All findings in `docs/audits/wave-1a/index.md` tagged `Proposed wave: 1b-trivial` that originate from `docs/audits/wave-1a/accessibility.md`.

**Trivial a11y fixes** (this is the canonical list — anything NOT here is not trivial):
- `<img alt="">` add where alt is clearly decorative.
- `<img alt="<descriptive text>">` where the surrounding copy gives an obvious descriptive value.
- `aria-label="<icon name>"` add to icon-only `<button>` wrapping a lucide-react `<Icon />` where the icon's semantic is clear from context (e.g., `<X />` → `"Close"`, `<Trash2 />` → `"Delete"`, `<Plus />` → `"Add"`).
- `type="button"` add to `<button>` elements in forms that are NOT submit/reset.
- `role="status"` / `aria-live="polite"` add to a toast container that clearly has that role.
- `htmlFor=` attribute wiring on a `<label>` that already sits next to an `<input id="...">`.
- `<html lang="en">` add in `frontend/index.html` if missing.

**NOT in scope for this task** (re-file for Wave 5 or Wave 8):
- Any new `<DndContext>` `announcements` or `screenReaderInstructions` prop (runtime behavior — Wave 5).
- Any focus-trap addition to a modal (requires logic — Wave 5).
- Any skip-to-content link addition (requires layout surgery — Wave 5).
- Any color-token change (even a minor one — Wave 5 or Wave 6).
- Any `prefers-reduced-motion` media query addition (requires CSS surgery + testing — re-file as `Wave 5` if critical, `Wave 6` if cosmetic).
- Any heading-hierarchy restructure.

### Steps

1. Checkout `claude/wave-1b-accessibility` from latest `main`.
2. Enumerate scope from the index.
3. Apply fixes one finding at a time.
4. **Every `aria-label` / `alt` value must be reviewed** — do NOT auto-generate values. If the surrounding component doesn't clearly communicate the icon's purpose, re-file to Wave 5 (where axe-core + designer review can decide).
5. **Do NOT refactor JSX structure** to add a label — add attribute in place. If in-place isn't possible, re-file.
6. Verification gate:
   ```bash
   npm run lint && npm run typecheck && npm run test && npm run frontend:build && git status
   ```
7. Commit, push, open PR. PR body same structure as Task 1 + an extra `## Attribute additions` table: `| Component | File:Line | Attribute | Value |`.

### Tests to add (Task 3)

None. If an attribute addition would "meaningfully improve test selector stability" and you're tempted to change a test to use the new `aria-label`: DO NOT. That's Wave 5 work. Leave existing selectors alone.

### Out of scope (Task 3)

- Everything under "NOT in scope for this task" above.
- Design-token / color-contrast changes.
- Motion / animation edits.
- Refactoring any drag-and-drop implementation.
- Adding @dnd-kit prop wiring.

---

## Task 4 — Distribution Update + Wave Promotion

**Commit**: `docs(audit): wave-1b distribution update`

**Branch**: `claude/wave-1b-distribution`

**Depends on**: Tasks 1–3 merged to `main`.

**Output**: `docs/audits/wave-1a/index.md` (update in-place) + `docs/expansion/98_PROGRESS_LOG.md` (append entry).

### Steps

1. Checkout `claude/wave-1b-distribution` from latest `main` AFTER Tasks 1–3 merge. Confirm `git log` shows three `chore(triage): wave-1b ...` commits.

2. **Collect outcomes** — read the three merged PRs' `## Outcomes` tables. Build a unified map: `finding_id → outcome (fixed | re-filed | skipped)`.

3. **Update `docs/audits/wave-1a/index.md`**:

   a. In the distribution table, for each finding:
   - If `outcome = fixed` → prepend `✅ ` to the title cell; change `Proposed wave` column to `1b (shipped)`.
   - If `outcome = re-filed` → prepend `🔁 ` to the title cell; change `Proposed wave` to the NEW target wave + update severity per the re-file.
   - If `outcome = skipped (not trivial)` → prepend `⏭ ` to the title cell; change `Proposed wave` to the agreed-upon later wave.
   
   b. Under each target wave's sub-heading, the finding's line stays the same OR gets moved to reflect the new wave. Maintain ordering (severity → effort → location).
   
   c. **Introduce a new section `## Wave 1b closure report`** directly below the top-10 register. Structure:
   - `### Shipped` — list of fixed findings by file path.
   - `### Re-filed` — table: `| Finding | Was | Now | Reason |`.
   - `### Skipped` — table: `| Finding | Reason skipped | Target wave |`.
   - `### Baseline deltas` — before/after lint warning count, test file count, test case count, bundle size.
   - `### Follow-ups to Waves 2–9` — flat list, sorted by target wave, of EVERY non-trivial finding that will land in a later wave. This becomes the authoritative source each later wave's pre-flight reads.

4. **Update `docs/expansion/98_PROGRESS_LOG.md`** — append a dated entry:
   ```
   ## 2026-MM-DD — Wave 1b audit triage
   
   Three fix PRs + one distribution PR shipped.
   
   - Fixed findings: N
   - Re-filed findings: M
   - Skipped findings: K
   - Lint warning delta: -X
   - See docs/audits/wave-1a/index.md § Wave 1b closure report.
   ```
   Keep the entry <15 lines.

5. Verification gate:
   ```bash
   npm run lint            # unchanged from post-Task-3 baseline
   npm run typecheck       # 0 errors
   npm run test            # 100% pass; count unchanged
   npm run format -- docs/audits/wave-1a/index.md docs/expansion/98_PROGRESS_LOG.md
   git status              # only the two doc files changed
   ```
   Each `FAIL → HALT`.

6. **Self-check**: no finding in `docs/audits/wave-1a/index.md` retains a `Proposed wave` of `1b-trivial` after this task. Every finding is either `1b (shipped)` or a specific later wave.

7. Commit, push, open PR. PR body summarizes the closure report.

### Tests to add (Task 4)

None.

### Out of scope (Task 4)

- Editing any Wave 2–9 plan file (`.claude/wave-*.md`). Future wave plans already include a pre-flight step that reads the audit index — do NOT mutate future wave plans from this task.
- Creating new audit sub-reports.
- Recomputing anything in the original sub-reports (they are frozen artifacts).

---

## Documentation Currency Pass

Handled by Task 4:
1. `docs/audits/wave-1a/index.md` — updated per Task 4 Step 3.
2. `docs/expansion/98_PROGRESS_LOG.md` — dated entry per Task 4 Step 4.

No other docs change. **Do NOT** touch `claude.md`, `docs/README.md`, `docs/architecture/*.md`, `docs/expansion/03_ROADMAP.md`, or `docs/expansion/NEXT_SESSION_PLAN.md` in this wave (Wave 8 covers architecture docs; Wave 2 updates NEXT_SESSION_PLAN closure).

---

## Wave Review (Mandatory Before Final Merge)

Walk the checklist. Any "no" blocks push.

1. All 4 tasks merged to `main` with verification gates green.
2. `npm run lint` on `main` after Task 4 merges: warning count ≤ the baseline from Wave 1a's `code-quality.md`.
3. `npm run typecheck` on `main`: 0 errors.
4. `npm run test` on `main`: 100% pass; file + case counts unchanged from baseline (may be ≥ baseline only if a re-filed finding added a test, which violates trivial — HALT if so).
5. `npm run frontend:build` on `main`: clean; bundle sizes unchanged or smaller than baseline.
6. `npm run test:e2e -- --workers=1` on `main` (full CI run): passing count unchanged from baseline (40/63). Wave 1b must not regress any E2E scenario. Any new E2E failure is a HALT — revert the offending task.
7. `docs/audits/wave-1a/index.md`: no finding retains `Proposed wave: 1b-trivial`.
8. `docs/audits/wave-1a/index.md`: new `## Wave 1b closure report` section is populated with Shipped / Re-filed / Skipped / Baseline deltas / Follow-ups.
9. `docs/expansion/98_PROGRESS_LOG.md`: dated Wave 1b entry appended.
10. No file under `supabase/migrations/` changed.
11. No file under `supabase/functions/` changed (unless a trivial comment fix that passed the strict bar).
12. No new dependency in `package.json`.
13. No change to `vitest.config.js`, `playwright.config.ts`, `vite.config.js`, `eslint.config.js`, `tsconfig.json`.
14. **Test-impact reconciled**: the assertion in step 4 — test count unchanged — is THE key signal that trivial discipline held. If it didn't, decide per-finding whether to keep the added test (re-file to Wave 3/5) or revert the offending fix.

---

## Commit & Push to Main

1. Tasks 1–3 PRs can merge in any order.
2. Task 4 PR merges LAST.
3. After all 4 merge:
   ```bash
   git checkout main && git pull
   npm install
   npm run lint && npm run typecheck && npm run test && npm run frontend:build
   ```
   All green. CI runs `test:e2e --workers=1` on merge; wait for it and confirm green before declaring the wave shipped.
4. If CI goes red on the merge to `main`, open a hotfix PR immediately (`fix(ci): revert <failing finding>`); do not leave `main` red.

---

## Verification Gate (Per Task, Before Push)

For Tasks 1, 2, 3:

```bash
npm run lint              # warning count ≤ baseline (should be LESS after this wave)
npm run typecheck         # 0 errors
npm run test              # 100% pass; count unchanged
npm run frontend:build    # clean
git status                # clean (only the expected edits)
```

`FAIL → HALT` per command. Do NOT `--no-verify` any git hook.

For Task 4 additionally:
```bash
npm run format -- docs/audits/wave-1a/index.md docs/expansion/98_PROGRESS_LOG.md
```

Do NOT run `npm run test:e2e` per-task (cost). CI runs it on merge; Wave Review step 6 verifies E2E baseline held after all four tasks merged.

---

## Key References

- `claude.md` — project conventions, especially §5 (Coding Conventions) and §3 (Workflow).
- `docs/audits/wave-1a/index.md` — the authoritative findings source.
- `docs/audits/wave-1a/code-quality.md` / `security.md` / `accessibility.md` — per-finding detail.
- `docs/expansion/98_PROGRESS_LOG.md` — append target at wave close.
- `.claude/wave-execution-protocol.md` — halt conditions (if shipped by this point; otherwise follow the spirit inline here).

---

## Critical Files

**Will edit (Task 1 — scope depends on audit findings; estimates)**:
- `frontend/src/**/*.jsx` (likely 5–15 files touched; ≤2 attribute-level edits each)
- `packages/core/src/**/*.js` (likely 0–5 files touched)
- `supabase/functions/**/*.ts` (likely 0–2 files touched, comment-level)

**Will edit (Task 2)**:
- `docs/**/*.md` (link fixes, stale references)
- `.env.example`, `.env.local.example`, `.env.test.example` (comment refreshes only)
- `README.md` (badge or link fixes only)

**Will edit (Task 3)**:
- `frontend/src/**/*.jsx` (attribute additions only; ≤20 files; ≤30 additions total estimated)
- `frontend/index.html` (single `<html lang>` edit if missing)

**Will edit (Task 4)**:
- `docs/audits/wave-1a/index.md`
- `docs/expansion/98_PROGRESS_LOG.md`

**Will NOT edit in any task**:
- `supabase/migrations/**` (Wave 2, Wave 6, Wave 7).
- `supabase/functions/**` logic (comment-only fixes OK in Task 1).
- `tests/**` (Wave 3 or Wave 5).
- `package.json`, `package-lock.json` (dependency changes forbidden here).
- `vitest.config.js`, `playwright.config.ts`, `vite.config.js`, `eslint.config.js`, `tsconfig.json`, `.prettierrc`.
- `vercel.json` (directive edits).
- `claude.md` (Wave 8 rename).
- `docs/architecture/*.md` (Wave 8 gap-closure).
- `docs/expansion/03_ROADMAP.md` (Wave 8 or 9).
- `docs/expansion/NEXT_SESSION_PLAN.md` (Wave 2 closure).
- `.claude/wave-*-prompt.md` (future-wave plans).

---

## Out of Scope This Wave

- Anything beyond P0-trivial (re-file to a later wave).
- NEXT_SESSION_PLAN §1.1–§3.1 items (Wave 2 — `SECURITY INVOKER` on import_efficiency_metrics, `raw-imports` bucket policy, search_path on 6 functions, leaked-password protection, VITE_SENTRY_DSN).
- Dependabot vulnerability upgrades (Wave 2).
- 23 pre-existing E2E failures (Wave 5).
- Onboarding refactor / PR #155 salvage (Wave 4).
- Bundle-size / DB-index / storage-retention work (Wave 6).
- pgTAP CI runner / CSP nonce hardening (Wave 7).
- `claude.md` → `CLAUDE.md` rename (Wave 8).
- Architecture doc gap-closure (Wave 8).
- v1.0.1 version bump + CHANGELOG + release tag (Wave 9).
- Any test file modification.
- Any migration.
- Any feature work.

---

## Ground Rules

- **Trivial discipline is sacred**. If a fix stops feeling trivial mid-edit, `git checkout -- <file>` and re-file the finding. Do NOT force it.
- **One finding per edit-group**. Never bundle multiple findings into one change that's hard to revert.
- **Revert-first on regression**. If `npm run test` regresses after applying a fix: revert that specific fix, re-file the finding, move on.
- **No auto-format sprees**. `npm run format` is ONLY invoked with an explicit path argument.
- **Preserve import order**. When removing an unused import, do not reorder the others.
- **Never touch a test file** in Wave 1b. If you "need" to, re-file the finding to Wave 3 (test-infra) or Wave 5 (E2E).
- **Commit messages**: use the exact `Commit:` lines specified. Conventional-commits only. No emoji in commit messages.
- **PR body template**: Baselines + Outcomes + Out-of-scope + Attribute-additions (Task 3 only). Keep under ~400 words.
- **5-attempt debugging cap** per finding. If stuck after 5 attempts, re-file and move on.
- **No `--no-verify` / `--force-push`**.
- **CI green is load-bearing**: if merge-to-`main` CI goes red, hotfix or revert — do not ignore.
