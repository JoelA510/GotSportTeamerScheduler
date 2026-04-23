# Wave 6a — Free-Tier Guards: Bundle Budgets + Advisor Lint (Client/CI)

## Session Context

**Prior waves**: 1a, 1b, 2, 3a, 3b, 4, 5 shipped. Wave 2 closed the security-advisor backlog; Wave 5 stabilized E2E. With security + tests in hand, the remaining hardening concern is **cost discipline** on the free tiers.

**Wave 6 split**: per-Phase-2 plan, Wave 6 is large (~770 estimated lines of plan). Splitting into 6a (client/CI guards) + 6b (DB / Edge Function / storage guards) matches the 1a/1b and 3a/3b patterns.

**Wave 6a purpose**: stand up CI-enforced guardrails on the CLIENT side so future changes can't silently blow the free-tier budget:
1. **Bundle-size budget** — fail CI if main chunk > 300 KB gzipped or any per-route lazy chunk > 80 KB gzipped. Fix any lazy-loading gaps surfaced by the audit.
2. **Advisor-pattern lint** — static check of migration files + SQL functions catching the categories Supabase's advisor dashboard flags (SECURITY DEFINER without `search_path`, tables without RLS, public SELECT grants on domain tables). Runs in CI with no credentials required.

Both gates protect Waves 6b, 7, 8, 9 from regressing what earlier waves fixed.

**Audit backlog**: `docs/audits/wave-1a/index.md` has `### Wave 6-free-tier` findings. Wave 1a Task 4 (`free-tier-usage.md`) produced the baseline budget projections; this wave adopts those numbers as the enforced caps.

**Wave 6a is**:
- `scripts/check-bundle-size.js` + CI step + per-chunk budgets.
- `scripts/advisor-lint.js` (or similar name) + CI step + static migration/function linting.
- `docs/operations/bundle-budget.md` (new) documenting the budgets + rationale.
- `docs/operations/advisor-lint.md` (new) documenting the patterns the lint catches.
- Lazy-loading fixes for any route the audit flagged.
- Closure.

**Wave 6a is NOT**:
- Edge Function invocation reductions (Wave 6b).
- DB index additions (Wave 6b).
- Storage retention crons (Wave 6b).
- Paid-tier migration planning (out of scope entirely for v1.0.1).
- Lighthouse CI integration (Wave 9).
- Rewriting production code for performance (beyond lazy-loading fixes).

---

## Pre-flight Verification

HALT on any false claim.

1. `git status` on `main` is clean.
2. `docs/audits/wave-1a/free-tier-usage.md` + `## Bundle-size inventory` table readable; use it as the budget source-of-truth.
3. `docs/audits/wave-1a/supabase-performance.md` exists; read it for the security-function patterns the advisor-lint needs to catch.
4. `npm run frontend:build` on `main`: capture current chunk sizes (main + per-route). These are the baseline; budgets must accommodate them + some headroom.
5. `.github/workflows/ci.yml` exists and has a test step that runs after `frontend:build`. New CI steps insert there.
6. `package.json` has `"type": "module"` and supports ESM in `scripts/` — new scripts can be `.mjs` or `.js` with ESM syntax.
7. No existing `scripts/check-bundle-size*` file; no existing `scripts/advisor-lint*` file.
8. Baseline: `npm run lint` / `npm run typecheck` / `npm run test` all green.

---

## Branch Conventions

- One branch per task, cut from `main`:
  - `claude/wave-6a-bundle-budget` → Task 1
  - `claude/wave-6a-advisor-lint` → Task 2
  - `claude/wave-6a-closure` → Task 3 (lands LAST — depends on 1 + 2)
- Tasks 1 and 2 are independent; either order.
- PR per task. CI green before merge.

---

## Wave Scope

Two parallel guard tasks + one closure. Each guard produces: (a) a CLI-runnable script, (b) a CI step, (c) a documentation page with the rationale + how-to-update-budgets.

---

## Task 1 — Bundle-Size Budget

**Commit**: `chore(perf): add bundle-size budget CI guard`

**Branch**: `claude/wave-6a-bundle-budget`

### Steps

1. Checkout `claude/wave-6a-bundle-budget` from latest `main`.

2. **Capture current chunk sizes** — run `npm run frontend:build`, parse the Vite output (chunks in `dist/assets/*.js`). Record raw + gzipped sizes for each chunk. This feeds the budget file.

3. **Set budgets** at `docs/operations/bundle-budget.md`:
   ```markdown
   # Frontend Bundle Budget

   Vercel Hobby free tier caps egress at 100 GB/month. To stay comfortably
   inside that at 100-org traffic projections (see docs/audits/wave-1a/free-tier-usage.md),
   per-asset budgets are:

   | Asset | Gzipped budget | Current (MM-DD) | Headroom |
   | --- | --- | --- | --- |
   | Main entry chunk (`dist/assets/index-*.js`) | 300 KB | N KB | M % |
   | Per-route lazy chunk (each) | 80 KB | max N KB | M % |
   | Total first-paint assets (HTML + CSS + main JS) | 500 KB | N KB | M % |
   | Total `dist/` (non-compressed) | 5 MB | N MB | M % |

   ## Rationale
   - Main chunk ≤ 300 KB gzipped: keeps TTI under 3 s on throttled 3G.
   - Per-route ≤ 80 KB: avoids janky route transitions.
   - Total first-paint ≤ 500 KB: stays under the observed 90th-percentile
     mobile connection for typical users.

   ## When a PR exceeds a budget
   1. If the cause is a new feature genuinely worth the bytes: update this
      file with a brief justification and bump the budget.
   2. If the cause is accidental (unused import not tree-shaken, non-lazy
      route, unoptimized dep): fix the cause. Do not bump the budget.
   3. If the cause is a new dep: pin the version and document gzipped cost
      in the PR body.
   ```

4. **Script at `scripts/check-bundle-size.js`** (or `.mjs`):
   - Runs after `npm run frontend:build`.
   - Walks `dist/assets/`, gzips each `.js` in memory (use Node's `zlib` — no new deps).
   - **Reads budgets from a single shared JSON config** at `config/bundle-budget.json` — the script does NOT hardcode numbers. The markdown doc is HUMAN-READABLE reference; the JSON is machine-readable source of truth; the script reads JSON. Adding a budget = edit JSON + update markdown. The two never drift because markdown links to the JSON and the script imports it.
   - `config/bundle-budget.json` shape:
     ```json
     {
       "main": { "gzippedKb": 300 },
       "perRouteLazy": { "gzippedKb": 80 },
       "totalFirstPaint": { "gzippedKb": 500 },
       "totalDist": { "rawMb": 5 }
     }
     ```
   - The markdown file (`docs/operations/bundle-budget.md`) references `config/bundle-budget.json` as the canonical source and explains each key's meaning. A drift check in the doc: "If you edit the JSON, update the rationale table in this file — CI does not enforce that the two match semantically, only that the JSON is valid."
   - Fails with exit code 1 + clear message on overshoot: `BUDGET FAIL: dist/assets/foo.js = 85 KB gzipped > budget 80 KB (perRouteLazy)`.
   - Reports all chunks + their status (pass/fail) in a table for humans.

5. **Add npm script** to `package.json`:
   ```json
   "scripts": {
     ...
     "check:bundle": "node scripts/check-bundle-size.js"
   }
   ```

6. **CI step** — append to `.github/workflows/ci.yml` after the `frontend:build` step:
   ```yaml
   - name: Check bundle budget
     run: npm run check:bundle
   ```
   This fails the build if any budget is exceeded.

7. **Audit lazy-loading gaps** — from Wave 1a Task 4's findings, identify pages / routes NOT currently lazy-loaded. For each:
   - Update `frontend/src/App.jsx` to use `React.lazy()` + `<Suspense>`.
   - Re-run `npm run frontend:build` — confirm the now-lazy chunk splits out.
   - If the chunk is still over 80 KB after split, the page genuinely has that much code — document in `bundle-budget.md` and bump the budget OR re-file to a follow-up wave.

8. **Do NOT**:
   - Add new bundling deps (webpack, rollup plugins, etc.).
   - Switch build tool.
   - Rewrite production code to "save bytes" — scope creep.
   - Change tree-shaking config.
   - Preload / prefetch optimizations (Wave 9).

9. Verification gate:
   ```bash
   npm run lint
   npm run typecheck
   npm run test
   npm run frontend:build
   npm run check:bundle          # passes
   git status
   ```
   `FAIL → HALT`.

10. Commit, push, open PR. PR body includes:
    - Before/after table of chunk sizes per budget.
    - Lazy-loading fixes applied (which routes, which chunks split).
    - Any budget bump justified.

### Tests to add (Task 1)

- `tests/checkBundleSize.test.js` — unit tests for the script's core logic:
  - Given a mock file size, it correctly classifies pass/fail.
  - Given a budget, it fails loudly on overshoot.
  - Given zero files, it does not false-pass (should error that build output is missing).
  - ≥ 4 test cases.

### Out of scope (Task 1)

- Image optimization.
- Code splitting beyond lazy-loaded routes.
- Minification config changes.
- CDN configuration.
- HTTP/2 push / preload hints.
- Integrating Lighthouse CI (Wave 9).
- Paid-tier Vercel considerations.

---

## Task 2 — Advisor-Pattern Lint

**Commit**: `chore(security): add supabase-advisor-pattern lint guard`

**Branch**: `claude/wave-6a-advisor-lint`

### Steps

1. Checkout `claude/wave-6a-advisor-lint` from latest `main`.

2. **Identify the advisor patterns worth catching statically** — Wave 2 fixed these specific patterns; the lint's job is to PREVENT regression. From `docs/audits/wave-1a/supabase-performance.md` + Wave 2 closure, the high-confidence patterns are:
   - **`SECURITY DEFINER` function without `SET search_path`** — **block-level check**. A naive sequential grep for `SECURITY DEFINER` followed by `SET search_path` is UNSAFE for files that contain multiple functions: a `SET search_path` in function B would spuriously satisfy the check for function A declared earlier. The lint MUST parse each function definition as a discrete block and check each block in isolation.
     - Block detection regex (adjust as needed): match `CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+[^(]+\([^)]*\)` followed by everything up to the closing `LANGUAGE \w+;` on its own line OR the next top-level `CREATE` / end-of-file.
     - Inside each matched block: if the block contains `SECURITY DEFINER` (outside comments and strings) AND does NOT contain `SET search_path` (also outside comments), report a violation with file path + function name + line number.
     - Comment-stripping: strip `--...` line comments and `/* ... */` block comments before checking presence-patterns to avoid false positives / false negatives.
   - **View declaration missing `security_invoker`**: `CREATE VIEW public.foo AS ...` OR `CREATE OR REPLACE VIEW public.foo AS ...` without `WITH (security_invoker = on)` OR without a `SECURITY INVOKER` modifier.
   - **Table declared without RLS enabled**: `CREATE TABLE public.foo (...)` without a corresponding `ALTER TABLE public.foo ENABLE ROW LEVEL SECURITY;` within the same migration file.
   - **`VITE_*` prefix on secret-ish env var names**: grep `.env.example` + `.env.test.example` for `VITE_*SECRET*` / `VITE_*PRIVATE*` / `VITE_*TOKEN*` / `VITE_SERVICE_ROLE*`.
   - **`USING (true)` or `WITH CHECK (true)` in RLS policies**: permissive catch-all policies on public-facing tables.

3. **Script at `scripts/advisor-lint.js`** (or `.mjs`):
   - Reads every `.sql` file under `supabase/migrations/` + every `.env.*.example` at repo root.
   - Runs each pattern check as a separate function.
   - Reports violations with file path + line number + pattern name + brief remediation hint.
   - Exit code 0 on zero violations; 1 on any.
   - Optional: accept a `--ignore <path>` flag for per-file waivers (gracefully — no global disable).

4. **Start with a clean baseline** — run the lint once before shipping. If it finds violations on `main` (Wave 2 closed most, but edge cases may remain):
   - For each: either fix inline in this PR (trivial) OR add to a waiver list at the top of `scripts/advisor-lint.js` with a comment pointing at the follow-up work. Ship only with either zero violations OR a documented waiver list.

5. **Add npm script**:
   ```json
   "scripts": {
     ...
     "check:advisors": "node scripts/advisor-lint.js"
   }
   ```

6. **CI step** — append to `.github/workflows/ci.yml` after lint:
   ```yaml
   - name: Check Supabase advisor patterns
     run: npm run check:advisors
   ```

7. **Document at `docs/operations/advisor-lint.md`**:
   - Pattern list + rationale per pattern.
   - How to add a new pattern (append a function + call it from the runner).
   - Waiver policy: only with a linked issue or follow-up wave number.
   - What this lint does NOT catch (runtime advisor checks that need DB connection — Supabase Dashboard still required for those).

8. **Do NOT**:
   - Run the Supabase CLI advisor (requires credentials).
   - Add schema-diff or live-DB checks.
   - Lint outside `supabase/migrations/` and `.env.*.example` (scope creep).
   - Introduce a new linter framework (no ESLint plugin, no custom AST parser — regex is sufficient for these patterns).

9. Verification gate:
   ```bash
   npm run lint
   npm run typecheck
   npm run test
   npm run check:advisors        # passes (or has documented waivers only)
   git status
   ```

10. Commit, push, open PR. PR body lists the patterns the lint catches + any baseline violations + any waivers.

### Tests to add (Task 2)

- `tests/advisorLint.test.js` — unit tests for each pattern's detection logic:
  - A fixture SQL file with `SECURITY DEFINER` + no `SET search_path` → lint reports it.
  - A fixture with `SECURITY DEFINER` + `SET search_path = public` in the same function block → lint passes.
  - **Multi-function block regression case**: a fixture where function A is `SECURITY DEFINER` with NO `SET search_path`, and function B in the SAME FILE has both `SECURITY DEFINER` AND `SET search_path`. Lint MUST report function A specifically (naive grep would false-pass).
  - Comment-stripping case: `SECURITY DEFINER` inside a `-- line comment` or `/* block comment */` does NOT trigger the rule.
  - A fixture `CREATE VIEW` without `security_invoker` → reports.
  - A fixture `CREATE TABLE` without matching `ENABLE ROW LEVEL SECURITY` → reports.
  - A fixture `USING (true)` → reports.
  - A fixture `.env.example` with `VITE_SERVICE_ROLE_KEY` → reports.
  - ≥ 10 test cases covering both detection AND negative (should-not-fire) cases.

### Out of scope (Task 2)

- Schema-diff checks.
- Pre-commit hook integration (CI-only for this wave; pre-commit is a future ergonomics win).
- Integrating the Supabase CLI advisor.
- RLS policy semantic correctness (the lint catches obvious holes, not nuanced policy flaws).
- Linting `supabase/functions/**` TypeScript (that's ESLint's job).
- Auto-fix mode.

---

## Task 3 — Closure

**Commit**: `docs(wave-6a): closure — client/ci free-tier guards shipped`

**Branch**: `claude/wave-6a-closure`

**Depends on**: Tasks 1 + 2 merged.

### Steps

1. Checkout `claude/wave-6a-closure` from latest `main` AFTER Tasks 1 + 2 merge.

2. **Update `docs/audits/wave-1a/index.md`** — mark Wave-6-free-tier findings that Wave 6a shipped (bundle-related + advisor-lint-related):
   - Prepend `✅` to shipped findings.
   - Set `Proposed wave` to `6a (shipped)`.
   - Leave Edge Function / DB-index / storage-retention findings as `6b` — those stay in 6b.

3. **Append to `docs/expansion/98_PROGRESS_LOG.md`**:
   ```
   ## 2026-MM-DD — Wave 6a client/CI free-tier guards

   Three PRs shipped:
   - Task 1: scripts/check-bundle-size.js + CI step + docs/operations/bundle-budget.md.
     Lazy-loading fixes on N routes; main chunk K KB gzipped (budget 300 KB).
   - Task 2: scripts/advisor-lint.js + CI step + docs/operations/advisor-lint.md.
     Catches SECURITY DEFINER without search_path, views without security_invoker,
     tables without RLS, permissive RLS policies, VITE_* secret leaks.
   - Task 3: closure.

   No new dependencies. CI runtime impact: +2-3s (bundle check) + <1s (advisor lint).
   ```

4. Verification:
   ```bash
   npm run lint
   npm run typecheck
   npm run test
   npm run frontend:build
   npm run check:bundle
   npm run check:advisors
   npm run format -- docs/audits/wave-1a/index.md docs/expansion/98_PROGRESS_LOG.md
   git status
   ```

5. Commit, push, open PR.

### Tests to add (Task 3)

- None.

### Out of scope (Task 3)

- Editing `.claude/wave-*.md`.
- Archiving docs.
- Updating `docs/architecture/*.md` (Wave 8 owns).

---

## Documentation Currency Pass

Handled across Tasks 1–3:
1. `docs/operations/bundle-budget.md` (new — Task 1).
2. `docs/operations/advisor-lint.md` (new — Task 2).
3. `docs/audits/wave-1a/index.md` — findings marked shipped (Task 3).
4. `docs/expansion/98_PROGRESS_LOG.md` — dated entry (Task 3).

Do NOT touch: `CLAUDE.md`, `docs/architecture/**`, `docs/security/**`, `docs/testing/**`, any `.claude/wave-*.md`.

---

## Wave Review (Mandatory Before Final Merge)

Any "no" blocks push.

1. All 3 tasks merged; CI green on `main`.
2. `scripts/check-bundle-size.js` exists and runs via `npm run check:bundle`.
3. `scripts/advisor-lint.js` exists and runs via `npm run check:advisors`.
4. `.github/workflows/ci.yml` runs both scripts after existing steps.
5. `docs/operations/bundle-budget.md` + `docs/operations/advisor-lint.md` exist.
6. Bundle budget currently PASSES on `main` (not pinned at the limit — headroom documented).
7. Advisor lint currently PASSES on `main` (zero violations OR documented waivers).
8. No new production dependency in `package.json`.
9. No change to `vite.config.js`, `vitest.config.js`, `playwright.config.ts`, `eslint.config.js`, `tsconfig.json`, `.prettierrc`.
10. No schema change (no migration added in this wave).
11. No Edge Function change.
12. **Test-impact reconciled**: only tests added are for the two new scripts (~12 unit tests total). No incidental additions.
13. E2E baseline unchanged — `npm run test:e2e -- --workers=1` passing count matches the post-Wave-5 baseline.

---

## Commit & Push to Main

1. Tasks 1 + 2 in either order.
2. Task 3 lands LAST.
3. After all 3 merge:
   ```bash
   git checkout main && git pull
   npm install
   npm run lint && npm run typecheck && npm run test && npm run frontend:build
   npm run check:bundle && npm run check:advisors
   ```
   All green.

---

## Verification Gate (Per Task, Before Push)

For Task 1:
```bash
npm run lint
npm run typecheck
npm run test
npm run frontend:build
npm run check:bundle
git status
```

For Task 2:
```bash
npm run lint
npm run typecheck
npm run test
npm run check:advisors
git status
```

For Task 3:
```bash
npm run lint && npm run typecheck && npm run test
npm run frontend:build && npm run check:bundle && npm run check:advisors
npm run format -- docs/audits/wave-1a/index.md docs/expansion/98_PROGRESS_LOG.md
git status
```

Each `FAIL → HALT`.

---

## Key References

- `CLAUDE.md` — §11 CI pipeline.
- `docs/audits/wave-1a/free-tier-usage.md` — budget baselines.
- `docs/audits/wave-1a/supabase-performance.md` — advisor-pattern source.
- `.github/workflows/ci.yml` — where new steps insert.
- `package.json` — npm scripts to extend.
- `frontend/src/App.jsx` — route table for lazy-loading audit.

---

## Critical Files

**Will create**:
- `scripts/check-bundle-size.js` (Task 1)
- `config/bundle-budget.json` (Task 1 — SSOT for the budget numbers)
- `scripts/advisor-lint.js` (Task 2)
- `docs/operations/bundle-budget.md` (Task 1 — references the JSON)
- `docs/operations/advisor-lint.md` (Task 2)
- `tests/checkBundleSize.test.js` (Task 1)
- `tests/advisorLint.test.js` (Task 2)

**Will edit**:
- `package.json` (Tasks 1, 2 — new scripts; no new deps)
- `.github/workflows/ci.yml` (Tasks 1, 2 — new CI steps)
- `frontend/src/App.jsx` (Task 1 — lazy-loading fixes if any)
- `docs/audits/wave-1a/index.md` (Task 3)
- `docs/expansion/98_PROGRESS_LOG.md` (Task 3)

**Will NOT edit**:
- `CLAUDE.md`, any `.claude/wave-*.md`.
- `supabase/migrations/**`, `supabase/functions/**`.
- `vite.config.js`, `vitest.config.js`, `playwright.config.ts`, `eslint.config.js`, `tsconfig.json`, `.prettierrc`.
- `package-lock.json` beyond what `npm install` generates from script additions.
- `frontend/src/components/**`, `packages/core/src/**` (unless a lazy-loading fix requires touching the route's page component).
- `docs/architecture/**`, `docs/security/**`, `docs/testing/**`.

---

## Out of Scope This Wave (6a)

- Edge Function invocation reductions (Wave 6b).
- DB index migrations (Wave 6b).
- Storage retention crons (Wave 6b).
- Image optimization.
- CDN / preload hints.
- Lighthouse CI (Wave 9).
- Paid-tier considerations.
- Pre-commit hook integration.
- Schema-diff / live-DB advisor checks (credentials required).
- ESLint plugin development.
- Supabase CLI advisor integration.

---

## Ground Rules

- **Budgets are load-bearing**: a PR that exceeds a budget fails CI and stays failed until the cause is either fixed or the budget is bumped (with justification). No silent bumps.
- **Advisor lint is prevention**: it re-catches what Wave 2 fixed. A new migration that regresses one of Wave 2's fixes = CI failure.
- **No deps**: both scripts use Node built-ins (`zlib`, `fs`, `path`, `url`). No `gzip-size`, no `glob`, no `execa`. Keep install footprint zero.
- **Scripts are testable**: each script's core logic lives in pure functions, testable without invoking the script as a subprocess.
- **CI speed matters**: bundle check < 3 s, advisor lint < 1 s. Neither blocks developer iteration.
- **Waivers are accountable**: every waiver points at a follow-up wave or issue.
- **No `--no-verify`, no `--force-push`, no direct commits to `main`**.
- **5-attempt debugging cap** per task.
