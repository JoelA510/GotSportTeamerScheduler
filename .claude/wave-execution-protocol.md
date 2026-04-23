# Wave Execution Protocol

**Audience**: any agent (Opus 4.7, Sonnet 4.6, future models) executing a wave plan in `.claude/wave-*-prompt.md`.

**Status**: binding. Every `FAIL → HALT` clause in this document is load-bearing. Skipping a halt gate because "the work seems obvious" has shipped regressions before — the wave plans + this protocol exist because that pattern is common enough to encode.

**How to use**: at the start of every wave execution session, read the wave's plan AND this protocol. The plan is the spec; this protocol is the enforcement layer. When the plan says "FAIL → HALT" or "Verification gate" or "Wave Review", this doc defines what those mean in practice.

**Self-verification at the end**: §12 lists the commands that confirm this protocol still reflects reality. Run them if you suspect drift between the protocol and the repo.

---

## 1. Hierarchy of Execution

Every wave follows this sequence in order. No skipping, no reordering.

```
Pre-flight verification
    ↓
[per task]
    Branch creation
    Test-infrastructure additions (if any)
    At-risk existing-test mitigations
    Implementation
    New tests
    Per-task verification gate
    Commit + push + open PR
    PR merges after CI green
    ↓
Documentation Currency Pass
    ↓
Wave Review
    ↓
Commit + push final closure
```

Each arrow is a halt point. A failure at any stage STOPS the wave. Do not jump ahead to "clean up later". Diagnose, fix, or re-file as a separate finding — then resume.

---

## 2. Pre-flight Verification

Every wave plan opens with a numbered pre-flight list. The rules:

- **Each item is a fact assertion.** Either it's true or the wave cannot start.
- **Do NOT auto-fix pre-flight failures.** If item 5 says "`tests/factories/` exists" and it doesn't, that's a planning/reality mismatch, not a missing directory to create. Halt + surface to the operator. Wave plans assume prior waves shipped; if a prior wave is missing artifacts, the current wave is premature.
- **Read the audit-index section BEFORE Task 1.** Every wave plan references `docs/audits/wave-1a/index.md` § the relevant wave tag. Those findings are scope; you cannot ship the wave without addressing them (fix, waive, or re-file).
- **Baselines are load-bearing.** Capture them fresh at pre-flight time — don't copy numbers from the wave plan. Record in the PR description so the Wave Review can compare.

Pre-flight failure modes + responses:

| Symptom | Response |
| --- | --- |
| File assertion false ("`X` exists") | HALT; surface. Do not create. |
| Script assertion false (`npm run <script>` missing) | HALT; a prior wave hasn't shipped. Check `.claude/wave-*-prompt.md` sequence. |
| Baseline test count has drifted since the wave was planned | Update the PR description with the fresh baseline; if the drift is > 5 %, surface to the operator before continuing. |
| Migration naming convention doesn't match (`YYYY_MM_DD_*` vs `YYYYMMDDHHMMSS_*`) | HALT; reconcile. All post-v1.0 migrations use `YYYYMMDDHHMMSS_*`. |
| Supabase advisor dashboard has NEW ERROR findings not in the plan | HALT; Wave 2 + Wave 7a close advisor findings. A new ERROR means regression — fix first. |

---

## 3. Branching + PR Discipline

Every task gets its own branch cut from `main`:

```
claude/wave-<N>-<task-slug>
```

Examples from the plans: `claude/wave-6a-advisor-lint`, `claude/wave-7a-pgtap-rls-tests`, `claude/wave-9b-release-tag`.

**PR flow** (non-negotiable unless the wave plan explicitly authorizes direct-to-main):

1. Push the branch; open PR against `main`.
2. Wait for CI to run.
3. CI green is required before merge.
4. Merge, then delete the branch.
5. Move to the next task.

**Direct push to `main` is forbidden** for execution work. Exception: `.claude/` planning docs ship to main directly OR via PR (per PR-#159 era agreement — operator confirms mode at bootstrap time; current project uses PR flow for all planning commits).

**Force-push is forbidden**. If a branch gets into a bad state, revert via a new commit. If a merge is bad, revert via `git revert <sha>` + new PR.

**`--no-verify` is forbidden**. If a git hook fails, investigate + fix. A hook failure usually signals something the verification gate would catch anyway.

---

## 4. Task Implementation

Every task in a wave plan has:

- A commit message (use it verbatim).
- A branch name (use it verbatim).
- Numbered steps.
- A verification gate (§5).
- "Tests to add" list.
- "Out of scope" list (binding — if you're about to edit something listed here, STOP).

**Test ordering within a task** — this is where most drift happens:

1. **Build test infrastructure first.** Factories, helpers, setup polyfills (Wave 3a-style additions). If a task needs new shared infra, land it first; otherwise you'll duplicate boilerplate.
2. **Update at-risk existing tests second.** The plan lists them. Apply the mocks/extensions BEFORE implementing so you can confirm existing tests still pass pre-change.
3. **Implement the task body third.** The product code.
4. **Add new tests fourth.** Covering the new behavior from step 3.
5. **Run the full test suite fifth.** 100 % pass required.

If you skip order — e.g., implement first, then try to fix at-risk tests after — you'll chase phantom failures that existed before your change.

**Trivial-fix discipline** (Wave 1b; also applies to inline fixes in later waves' baselines like Wave 9a Lighthouse triage):

- Zero behavior change.
- Zero test modifications required.
- ≤ 15 minutes per fix.
- ≤ 3 files per fix.
- No new dependency.
- No migration / config / schema change.

If a fix violates the bar during execution, re-file it (update the finding's severity + target wave) and move on. Do NOT force a non-trivial fix into a trivial slot.

**5-attempt debugging cap per task/scenario/finding**: after 5 attempts at a single failing thing, STOP. Surface findings in the PR body + re-file as a later-wave item. The cap is there because 6+ attempts signals a structural issue the current wave's scope can't address.

---

## 5. Per-Task Verification Gate

Every task runs this gate BEFORE push. `FAIL → HALT` per command — fix the failure, then re-run the ENTIRE gate:

```bash
npm run lint              # 0 errors; warnings ≤ baseline
npm run typecheck         # 0 errors
npm run test              # 100 % pass; case count matches expectation (baseline ± planned delta)
npm run frontend:build    # clean
git status                # only expected files changed
```

**After Wave 6a ships**, add:
```bash
npm run check:advisors    # zero new SECURITY DEFINER / RLS / VITE_* secret patterns
npm run check:bundle      # chunks within config/bundle-budget.json budgets
```

**After Wave 9a ships**, add:
```bash
npm run lighthouse:local  # all assertions in .lighthouserc.js pass
```

Per-task E2E is generally skipped (cost). CI runs E2E on merge; the Wave Review step verifies baseline held. Exception: tasks explicitly marked "runs E2E" (e.g., Wave 4 Task 5, Wave 5 Tasks 2–5, Wave 7b Task 2).

**Failure responses**:

- `npm run lint` goes UP from baseline → revert the offending change; re-file or fix within the task.
- `npm run typecheck` fails → fix in the task; never bypass with `// @ts-ignore` except where the plan authorizes.
- `npm run test` fails → fix the test or the code. If the failure is intermittent, investigate per §10 before labeling it a flake. If the intermittent behavior correlates with your diff (new async path, new shared state, new timing), fix or revert in this PR. Only re-file as a Wave-5 follow-up when the flake is pre-existing AND the failing test is unrelated to your diff (confirmed via `git diff --name-only origin/main...HEAD -- <test-file>` returning empty) AND the wave plan does not explicitly own flake-fixing; if the wave plan does own flake-fixing, fix it in this PR rather than deferring.
- `npm run frontend:build` fails → STOP. Broken build on main is unacceptable. Fix or revert.
- `git status` shows unexpected files → diagnose. A stray `.env` in the diff is a security incident; a stray dist file is a gitignore miss.

---

## 6. Documentation Currency Pass

Every wave plan lists specific doc edits its tasks must produce. This pass is **BLOCKING** — a wave doesn't close until every listed doc change lands.

Rules:

- **The list in the plan is authoritative.** If the plan says "append to `docs/expansion/98_PROGRESS_LOG.md`", skipping it means the wave didn't close.
- **Don't add doc edits the plan doesn't list.** If you find yourself wanting to update a doc not in the plan, that's Wave 8's job OR a separate PR. Scope creep here bleeds into later waves.
- **Architecture docs stay additive.** Wave 8 introduced "Known Gaps" sections; later waves APPEND to those tables (don't rewrite the architecture doc content above the heading).
- **Audit index is the source of truth for closure markers.** Every wave marks its findings `✅ shipped` (or waives with pointer) in `docs/audits/wave-1a/index.md`. Wave Review verifies this.
- **`CHANGELOG.md` is Wave 9a-owned.** Pre-Wave-9a, nothing writes to it.
- **Progress log is append-only.** Never rewrite historical entries.

---

## 7. Wave Review

Every wave plan has a Wave Review checklist. Run it literally — each item is a `yes` / `no`, and `no` blocks the final push.

Common Wave Review items across plans:

- All tasks merged with CI green.
- Test / lint / typecheck / build baselines preserved (or documented delta).
- No new dependency unless the plan explicitly authorized one.
- No change to test-runner config (`vitest.config.js`, `playwright.config.ts`) unless the plan authorized.
- No change to `tests/factories/` or `tests/helpers/` — those are frozen after Wave 3a.
- Test-impact reconciled — any test count delta matches what the plan said tests-to-add would add.
- E2E baseline unchanged from the previous wave's closure (unless the current wave explicitly adds scenarios).
- `config/bundle-budget.json` budgets met (Wave 6a+).
- No new `pg_cron` jobs (Wave 6b added retention cron via GitHub Actions, not pg_cron; later waves maintain that discipline).
- `docs/audits/wave-1a/index.md` closure markers applied.

If any item is "no", the wave is incomplete. Do not push the closure commit. Diagnose + fix + re-run the review.

---

## 8. Commit & Push Final

After Wave Review passes:

1. Merge the final task's PR to `main`.
2. `git checkout main && git pull`.
3. Run the full verification gate ONE MORE TIME on `main`:
   ```bash
   npm install
   npm run lint && npm run typecheck && npm run test && npm run frontend:build
   # Plus Wave 6a+ gates:
   npm run check:advisors && npm run check:bundle
   # Plus Wave 9a+ gate:
   npm run lighthouse:local  # if applicable for the wave
   ```
4. CI will run E2E on the merge commit. Wait for it. Green before declaring wave-shipped.
5. If CI goes red on `main`, revert the offending PR within 30 minutes. Never leave `main` red.

**Post-deploy verification** (waves that ship migrations / config changes):

- Wave 2: Supabase advisor dashboard snapshot (0 ERROR, 0 high-severity WARN).
- Wave 6b: prod storage dashboard after 31 days shows stable/declining size (retention cron working).
- Wave 7a: pgTAP workflow green on next `supabase/**` PR.
- Wave 7b: Sentry error lands in dashboard from manual-throw smoke.
- Wave 9b: `v1.0.1` tag + GitHub Release visible.

---

## 9. Special-Case Halts (SquadLogic-specific)

### 9.1 Migration apply failure

If `supabase db push` fails applying a migration to staging OR prod:

- Do NOT edit the already-applied migration. It's shipped; editing in place creates drift.
- Open a NEW migration (next `YYYYMMDDHHMMSS_*.sql`) that does the corrective DDL.
- If the failure is destructive (column lost, rows deleted), use the corresponding `docs/sql/reverts/*.sql` script to roll back on that environment, then ship a fresh forward migration.
- Surface in the PR body + halt until reconciled.

### 9.2 RLS regression (pgTAP failure)

If Wave 7a's pgTAP tests fail on a PR that touches `supabase/**`:

- HALT. Do not merge.
- Read the failing test's assertion. A pgTAP failure means an RLS invariant was violated — cross-org leak, admin/coach separation broken, anon gate open.
- Fix the RLS policy (not the test). If the test's expectation was wrong, fix the test WITH a clear rationale in the PR body.

### 9.3 Advisor-lint regression (Wave 6a)

If `scripts/advisor-lint.js` flags new violations:

- HALT. Do not merge.
- The lint catches regressions of Wave 2's fixes: SECURITY DEFINER without search_path; tables without RLS; `USING (true)` RLS policies; `VITE_*` secret names.
- Fix the migration (add `SET search_path = public`; add `ENABLE ROW LEVEL SECURITY`; tighten the policy; rename the env var).

### 9.4 Bundle-budget regression (Wave 6a)

If `scripts/check-bundle-size.js` fails:

- HALT. Do not merge.
- Diagnose: which chunk exceeded; is it accidental (missed lazy-load, unoptimized image) or intentional (new feature genuinely worth the bytes)?
- Accidental → fix the cause.
- Intentional → bump the budget in `config/bundle-budget.json` WITH a rationale in the PR body + `docs/operations/bundle-budget.md` update.

### 9.5 Lighthouse-budget regression (Wave 9a)

If `npm run lighthouse:local` or the Lighthouse CI workflow fails:

- HALT. Do not merge.
- Triage: error-level assertions block ship; warn-level can loosen with rationale.
- Apply Wave-1b-trivial fixes inline if applicable (missing meta, alt, lang); otherwise re-file as a v1.1 follow-up + loosen the threshold with a one-line rationale.

### 9.6 E2E baseline regression (Wave 5)

If `npm run test:e2e -- --workers=1` passing count drops below the Wave 5 closure target:

- HALT. Do not merge.
- If the regression is in a scenario the current PR touches: fix or re-scope.
- If the regression is in an unrelated scenario: that's flake. Run the suite again. If persistent, a prior wave's fix regressed → revert the offender, re-file.

### 9.7 CSP violation

If Wave 7b's CSP regression E2E scenarios surface violations OR a manual prod smoke surfaces a console violation:

- HALT. Do not merge to prod.
- Diagnose: is the blocked origin legitimate (new Supabase host, new analytics)? If so, update `vercel.json` `connect-src` / `img-src` / etc.
- If the violation is from inline-script or inline-style introduced by the PR: remove the inline pattern. Never loosen CSP to accommodate.

### 9.8 Free-tier budget blown

If any of these trip the respective threshold:

- Supabase DB > 500 MB → immediate HALT; re-evaluate retention + audit_log trim.
- Supabase Storage > 1 GB → HALT; verify Wave 6b's cleanup-raw-imports Actions workflow ran.
- Vercel bandwidth > 100 GB/mo → HALT; re-run bundle budget + check for asset leakage.
- Supabase Edge Function invocations > 500 K/mo → HALT; verify Wave 6b's TTL caches on the top-3 hot functions are intact.
- GitHub Actions > 2000 min/mo → HALT; conditional triggers (Wave 7a, Wave 9a) may have regressed unconditional.

Each threshold maps to a Wave 6 artifact. If you trip one, a Wave 6 guardrail likely regressed.

### 9.9 Secrets exposure

`scripts/advisor-lint.js` catches `VITE_*SECRET*` / `VITE_*PRIVATE*` / `VITE_*TOKEN*` patterns in `.env.*.example`. If one slips through:

- HALT IMMEDIATELY.
- If the env var was committed (not just referenced), rotate the credential in the corresponding service (Supabase dashboard, Vercel env vars, etc.).
- File a dependabot-waiver-style doc entry at `docs/security/secret-incidents.md` (create if missing) with the rotation confirmation.
- Never `git revert` a secret-leak commit alone — the leaked value is still in history. Rotation is the only remediation.

### 9.10 Type-check drift in hand-edited files

If `npm run typecheck` flags a newly-failing file you HAVEN'T edited this PR:

- HALT. Diagnose before touching anything — the fix path depends on the cause.
- **Caused by your diff** (this PR modifies a shared type / exported signature — e.g. `src/types/**`, a re-exported module, a shared Supabase-generated type — and the failing file is a consumer): the current PR is the direct cause. Fix the consumer files in THIS PR. Breaking `main` because "I didn't edit that file" is not acceptable; merging would land a red build.
- **Pre-existing (latent) drift** (your diff doesn't touch the shared type; `git blame` shows a prior wave introduced the mismatch): don't auto-fix here. Re-file as a separate PR scoped to the original introducer's wave.
- Decision rule: if `git diff origin/main...HEAD -- <shared-type-path>` is non-empty AND the failing file imports from that path, treat as caused-by-your-diff.

### 9.11 Conditional-CI trigger regression

If a wave's conditional-trigger workflow (`pgtap.yml` on `supabase/**`; `lighthouse.yml` on `frontend/**`) starts running on EVERY PR:

- HALT the offending PR. The `paths:` filter has broken.
- Verify the workflow's `on.pull_request.paths` list still scopes narrowly.
- If a filter was accidentally removed, restore it in a fresh PR.

### 9.12 `CLAUDE.md` case drift

Post-Wave-8, the file is `CLAUDE.md` (uppercase). If a PR introduces a `CLAUDE.md` (lowercase) reference outside `docs/archive/**`:

- Wave 8's sweep should have caught it at the time; if something reintroduces the lowercase form, treat it as a regression.
- `git grep "claude\.md" -- ':!docs/archive/**'` returns ZERO on healthy `main`.
- Fix the reference in a follow-up commit before merging the offending PR.

---

## 10. Model Accountability

For non-Opus-4.7 agents executing these plans: **if you skip a halt gate because "the work seems obvious", you will probably ship a regression.**

Specific risk patterns to resist:

- **"The test is flaky; re-run until it passes, then ship."** — No. Investigate the flake. Document if real. Revert the change if the flake correlates with your PR.
- **"The lint warning is cosmetic; I'll fix it later."** — No. Fix before push. "Later" is a lie in a multi-agent system.
- **"The advisor-lint caught something, but it's in a migration I didn't touch."** — Fix it anyway. If your PR's CI is red, your PR doesn't merge.
- **"I'll skip the Docs Currency Pass this time because nothing in this task changes behavior."** — Every task in every wave plan lists doc edits. Skipping leaves a Wave Review failure for the next agent.
- **"The bundle budget is hitting an obscure third-party dep; I'll loosen the budget."** — Loosening is the LAST option. First: check if the dep is reachable from production code. Second: lazy-load. Third: find an alternative. Only then bump.
- **"Manual prod smoke is annoying; I'll skip and rely on CI."** — Wave 9b's manual smokes exist because CI can't observe the Sentry dashboard, Supabase advisor, Vercel headers, or cron-workflow state. Skipping means shipping untested prod state.

The plans assume an agent will sometimes be tempted to shortcut. The gates are the shortcut-catcher. Trust them.

---

## 11. Pointer to Recurring Prompts

Day-to-day wave execution uses `.claude/wave-recurring-prompts.md` (Phase 6 artifact). That file is the **operational loop**: paste one of its prompts into a fresh Code session, the agent executes one task of the current wave, the pointer advances, next iteration continues.

- PROMPT A: runs a task within a wave.
- PROMPT B: finalizes a wave (Docs Currency Pass + Wave Review + push to main).

This protocol (`wave-execution-protocol.md`) is the RULES; the recurring-prompts file is the OPERATIONS. Both are required at execution time — the agent reads both before acting.

---

## 12. Self-Verification

Run these commands to confirm this protocol reflects reality. If any fail, the protocol has drifted OR the repo state has — reconcile before proceeding with any wave.

```bash
# 1. All 14 wave plans exist.
ls .claude/wave-1a-prompt.md .claude/wave-1b-prompt.md \
   .claude/wave-2-prompt.md \
   .claude/wave-3a-prompt.md .claude/wave-3b-prompt.md \
   .claude/wave-4-prompt.md .claude/wave-5-prompt.md \
   .claude/wave-6a-prompt.md .claude/wave-6b-prompt.md \
   .claude/wave-7a-prompt.md .claude/wave-7b-prompt.md \
   .claude/wave-8-prompt.md \
   .claude/wave-9a-prompt.md .claude/wave-9b-prompt.md

# 2. The agent-instructions file is CLAUDE.md (uppercase) post-Wave-8.
git ls-files CLAUDE.md         # returns CLAUDE.md
git ls-files claude.md         # returns nothing (or archive references only)

# 3. Baseline scripts exist at whatever wave point the protocol is being read.
# Before Wave 6a ships, check:advisors/check:bundle are absent; after, present.
npm run lint --silent 2>/dev/null | head -1
npm run typecheck --silent 2>/dev/null | head -1

# 4. Audit index distribution table is present.
test -f docs/audits/wave-1a/index.md && grep -q "## Distribution table" docs/audits/wave-1a/index.md && echo "audit index OK"

# 5. Progress log is append-only (confirm structure).
head -5 docs/expansion/98_PROGRESS_LOG.md

# 6. No lowercase `CLAUDE.md` references outside archive post-Wave-8.
git grep "claude\.md" -- ':!docs/archive/**' ; echo "(empty is good post-Wave-8)"

# 7. Wave 6a CI gates are green on main (post-Wave-6a).
# npm run check:advisors && npm run check:bundle

# 8. Wave 7a pgTAP harness is present (post-Wave-7a).
# test -f supabase/tests/_template.sql && echo "pgTAP harness OK"

# 9. Wave 9a Lighthouse config is present (post-Wave-9a).
# test -f .lighthouserc.js && echo "Lighthouse config OK"

# 10. Wave 9b tag shipped (terminal state).
# git tag -l v1.0.1
```

If any check fails when it shouldn't, the protocol OR the repo has drifted. STOP + reconcile before running any wave.

---

## Appendix: Conventions Pointer

- **Commit messages**: conventional commits (`feat(...)`, `fix(...)`, `chore(...)`, `docs(...)`, `test(...)`, `perf(...)`, `style(...)`). Exact prefix per wave plan's "Commit:" line.
- **Branch names**: `claude/wave-<N>-<slug>` for execution; `docs/planning-*` for planning docs.
- **Migration naming**: `YYYYMMDDHHMMSS_<descriptive-slug>.sql` (14-digit concatenated UTC datetime; no underscores between parts).
- **PR body structure**: `## Baselines`, `## Outcomes`, `## Out of scope` (patterns from Wave 1b onward).
- **Audit-finding format**: Severity · Location · Observation · Impact · Fix · Wave · Effort (Wave 1a template; every audit-doc finding follows it).

If a future wave changes any convention, both this protocol AND the prior wave plans need reconciliation. Changes to conventions surface as their own wave with its own plan.
