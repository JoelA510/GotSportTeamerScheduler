# Wave 3b — Test-Infrastructure Migration + Closure

## Session Context

**Prior waves**: 1a + 1b + 2 + 3a shipped. Wave 3a created:
- `tests/factories/` — 9 modules with deterministic factory functions + self-tests.
- `tests/helpers/` — `createChainMock`, `renderWithProviders`, `seedMockDb`, `mockSupabaseShape` + self-tests. (No `installAuthMock` helper: Vitest hoists `vi.mock` factories above imports, so the pattern cannot be safely extracted into a runtime function — it lives as a copy-paste idiom in `test-helpers.md` instead.)
- `tests/setup.js` extended with jsdom polyfills (`ResizeObserver`, `IntersectionObserver`, `matchMedia`, `scrollIntoView`).

**This wave's purpose**: validate Wave 3a's infra by migrating 5 representative existing tests, then publish the usage doc and close the audit-index findings.

**Why 5 tests?** Migration acts as a proof-of-concept. If the infra works for 5 varied tests (a hook, an integration test, a small pure hook, a component render, a pure-domain test), it will work for the ~45 others as future waves/chores migrate them. Migrating all 50 in one wave is too risky — this discipline keeps the PR small and reviewable.

**Wave 3b is**:
- Migrating 5 existing tests to `tests/factories/` + `tests/helpers/`.
- Writing `docs/testing/test-helpers.md`.
- Updating `docs/audits/wave-1a/index.md` to mark Wave-3-test-infra findings shipped.
- Appending to `docs/expansion/98_PROGRESS_LOG.md`.

**Wave 3b is NOT**:
- Migrating more than 5 tests.
- Adding new feature tests.
- Adding new factories or helpers (Wave 3a froze the API).
- Editing production code.
- Editing test-runner config.
- Raising coverage thresholds.

---

## Pre-flight Verification

HALT on any false claim.

1. `git status` on `main` is clean.
2. Wave 3a has merged: `tests/factories/` exists with 9 modules + 8 `__tests__/` files; `tests/helpers/` exists with 6 modules + 5 `__tests__/` files; `tests/setup.js` has the jsdom polyfills.
3. `npm run test` on `main` is 100 % pass. Record the case count as the Wave 3b baseline.
4. `npm run test:coverage`: record statements/branches/functions/lines %.
5. `docs/audits/wave-1a/index.md` `### Wave 3-test-infra` section still has findings tagged for this wave.
6. `docs/testing/` exists (contains `e2e_master_plan.md`; `test-helpers.md` does NOT yet exist).
7. The 5 migration-target test files still exist at the paths below (one or more may have been deleted since Wave 1a — if so, pick a substitute of equivalent pattern):
   - `tests/useDashboardData.test.js`
   - `tests/authIntegration.test.jsx`
   - `tests/usePermission.test.js`
   - `tests/teamPersistencePanel.test.jsx`
   - `tests/teamGeneration.test.js`

---

## Branch Conventions

- One branch per task, cut from `main`:
  - `claude/wave-3b-migrate-tests` → Task 1
  - `claude/wave-3b-docs-closure` → Task 2 (depends on Task 1)
- Task 2 must merge AFTER Task 1.

---

## Wave Scope

Two sequential tasks: migrate 5 tests, then publish the doc + close findings.

---

## Task 1 — Migrate 5 Representative Tests

**Commit**: `chore(test-infra): migrate 5 tests to shared factories + helpers`

**Branch**: `claude/wave-3b-migrate-tests`

### Migration target selection

The 5 targets are chosen to maximize pattern breadth (adjust if any has been deleted since Wave 1a):

| # | File | Pattern |
| --- | --- | --- |
| 1 | `tests/useDashboardData.test.js` | Hook + Supabase mock (heaviest `createChainMock` consumer) |
| 2 | `tests/authIntegration.test.jsx` | Cross-context integration (heaviest `renderWithProviders` consumer) |
| 3 | `tests/usePermission.test.js` | Small pure hook (factories without heavy providers) |
| 4 | `tests/teamPersistencePanel.test.jsx` | Component render (`renderWithProviders` pattern) |
| 5 | `tests/teamGeneration.test.js` | Pure domain logic (factories alone, no helpers) |

### Steps

1. Checkout `claude/wave-3b-migrate-tests` from latest `main`. Run `npm run test` — confirm 100 % pass before touching anything. Record the case count.

2. **Migrate each test, one at a time** (recommended order: 5 → 3 → 1 → 4 → 2, simplest first):
   a. Read the target test. Identify:
      - **Inline object literals** → replace with factory calls.
      - **Inline Supabase mock chains** → replace with `createChainMock`.
      - **Inline `<Provider>` wrapping** → replace with `renderWithProviders`.
      - **Hoisted auth state scaffolding** → replace with the `vi.hoisted` + `vi.mock` idiom documented in `test-helpers.md` (see Task 2 Step 2). The idiom is pasted at the TOP of the test file (above all imports of the component under test) because Vitest hoists `vi.mock()` factories — a runtime helper function cannot install a mock that affects already-imported modules.
   b. Apply replacements. Run `npm run test -- tests/<file>` after EACH micro-change to confirm the file still passes.
   c. **Every assertion must survive unchanged.** If an assertion would need to change, the factory default is wrong — HALT, fix the factory in a hotfix PR to Wave 3a's work, OR add an explicit `overrides` in the test.
   d. Delete replaced inline definitions. Do NOT leave dead code behind (unused imports, orphan helpers).

3. **Record a before/after diff per file** in the PR body:
   - LOC before → LOC after.
   - Inline mocks removed.
   - Factory + helper imports added.
   - Assertions preserved (should be 100 %).

4. **Full-suite verification after all 5 migrations**:
   ```bash
   npm run lint
   npm run typecheck
   npm run test                 # 100 % pass; case count UNCHANGED (migration doesn't add/remove cases)
   npm run test:coverage        # thresholds met; no regression
   npm run frontend:build       # unchanged
   git status                   # only the 5 test files modified
   ```

5. **Coverage reconciliation** — if a migration reveals a previously-covered branch is no longer covered (because a factory default took a different path than the prior inline literal), fix the factory call with an explicit override rather than changing the assertion or test. The goal is 1:1 behavioral equivalence.

6. Commit, push, open PR. PR body includes the before/after table + per-file migration notes.

### Tests to add (Task 1)

- None. Migration preserves every existing test case.

### Out of scope (Task 1)

- Migrating any of the other ~45 test files.
- Adding assertions to migrated tests.
- Refactoring production code the tests exercise.
- Deleting or renaming test files.
- Adding new factories or helpers to support migration edge cases (if an edge case requires new infra, re-file as Wave 3c or defer to a later wave).

---

## Task 2 — Documentation + Closure

**Commit**: `docs(testing): document shared test helpers + wave-3 closure`

**Branch**: `claude/wave-3b-docs-closure`

**Depends on**: Task 1 merged.

### Steps

1. Checkout `claude/wave-3b-docs-closure` from latest `main` AFTER Task 1 merges.

2. **Write `docs/testing/test-helpers.md`** (new file). Structure:

   ```markdown
   # Test Helpers & Factories

   ## Overview
   Shared test infrastructure introduced in Wave 3. The goal is leverage,
   not coverage: eliminate per-test boilerplate, keep the provider chain
   in one place, and make factories the single source of truth for mock
   data shapes.

   ## tests/factories/
   - Purpose, deterministic-defaults convention, override pattern.
   - One usage example per factory module.
   - Reference to `supabase/migrations/` as schema SSoT.
   - What NOT to add (no faker, no random UUIDs, no date math).

   ## tests/helpers/
   - `createChainMock`: when to use, proxy semantics, per-call vs reused.
   - `renderWithProviders`: options object, provider order mirroring `App.jsx`.
   - **Auth-context hoisted-mock idiom** (not a helper): copy-paste template using `vi.hoisted` + `vi.mock('@/contexts/AuthContext', …)` placed at the top of a test file. Document WHY Vitest mock hoisting forbids extraction into a runtime helper. Include an example showing mid-test login transitions via mutating the hoisted state object.
   - `seedMockDb`: E2E step-def usage via `page.evaluate`.
   - `mockSupabaseShape`: default shape for `vi.mock('@/lib/supabaseClient')`.

   ## tests/setup.js
   - Current polyfills + rationale.
   - Add-your-own discipline: polyfill only when production uses AND tests exercise.

   ## Migration patterns
   - Cite the 5 Task-1 PRs as canonical examples.
   - Short before/after snippet for the highest-leverage pattern.

   ## What NOT to add
   - Faker.
   - Global `resetAllMocks`.
   - Provider variants without a concrete consumer.
   - Timezone / locale locks.
   - Global fetch mocks.

   ## Verification for future test-adding PRs
   - Checklist: factory used? helper used? assertion preserved? coverage
     not regressed? bundle still isolated?
   ```

3. **Update `docs/README.md`** — add a link to `docs/testing/test-helpers.md` under the Testing section. ONE new link, no restructure.

4. **Update `docs/audits/wave-1a/index.md`** — for each Wave-3-test-infra finding, prepend `✅` and set `Proposed wave` to `3 (shipped)`. If migration in Task 1 exposed a finding better suited to a later wave, re-file rather than force-shipping.

5. **Append to `docs/expansion/98_PROGRESS_LOG.md`**:
   ```
   ## 2026-MM-DD — Wave 3 test-infra consolidation

   Wave 3a (3 PRs):
   - tests/factories/ (9 modules, N factories)
   - tests/helpers/ (5 helpers)
   - tests/setup.js extensions (4 polyfills)

   Wave 3b (2 PRs):
   - 5 tests migrated: useDashboardData, authIntegration, usePermission,
     teamPersistencePanel, teamGeneration
   - docs/testing/test-helpers.md

   Net case-count delta: +N (factory + helper self-tests only).
   Coverage: unchanged.
   Bundle: unchanged (tests/* isolated).
   ```

6. Verification:
   ```bash
   npm run lint
   npm run typecheck
   npm run test
   npm run frontend:build
   npm run format -- docs/testing/test-helpers.md docs/README.md docs/audits/wave-1a/index.md docs/expansion/98_PROGRESS_LOG.md
   git status
   ```

7. Commit, push, open PR.

### Tests to add (Task 2)

- None.

### Out of scope (Task 2)

- Editing `docs/testing/e2e_master_plan.md` (Wave 5 owns E2E doc sync).
- Archiving any existing testing doc.
- Editing any `.claude/wave-*-prompt.md` file.
- Editing architecture docs (Wave 8 owns gap closure).

---

## Documentation Currency Pass

Handled by Task 2:
1. `docs/testing/test-helpers.md` (new).
2. `docs/README.md` — one new link.
3. `docs/audits/wave-1a/index.md` — Wave-3 findings marked shipped.
4. `docs/expansion/98_PROGRESS_LOG.md` — dated entry.

Do NOT touch: `claude.md`, `docs/architecture/**`, `docs/security/**`, `docs/expansion/03_ROADMAP.md`, any `.claude/wave-*.md` file.

---

## Wave Review (Mandatory Before Final Merge)

Any "no" blocks push.

1. Both tasks merged with CI green.
2. **No production code changes**: `git diff main~2 main -- frontend/ packages/ supabase/` empty.
3. `npm run lint` on `main`: warning count ≤ baseline.
4. `npm run typecheck` on `main`: 0 errors.
5. `npm run test` on `main`: 100 % pass; case count UNCHANGED from Wave 3a close (migration preserves cases).
6. `npm run test:coverage`: thresholds unchanged or improved; no regression.
7. `npm run frontend:build`: bundle sizes unchanged.
8. `npm run test:e2e -- --workers=1` on `main`: passing count unchanged from Wave 2 baseline (no E2E regression from migration).
9. 5 test files migrated (or 4 if one was adversarial; document the skip in Task 1 PR body with the reason).
10. `docs/testing/test-helpers.md` published.
11. `docs/audits/wave-1a/index.md` has ✅ on every Wave-3-test-infra finding or a documented re-file to a later wave.
12. `docs/expansion/98_PROGRESS_LOG.md` entry appended.
13. No new dependency in `package.json`.
14. No change to any test-runner config (`vitest.config.js`, `playwright.config.ts`).
15. **Test-impact reconciled**: case count unchanged. If any case was added or removed during migration, explain in Wave Review with a justification.

---

## Commit & Push to Main

1. Task 1 merges first; Task 2 merges after.
2. After both merge:
   ```bash
   git checkout main && git pull
   npm install
   npm run lint && npm run typecheck && npm run test && npm run test:coverage && npm run frontend:build
   ```
   All green. CI runs E2E; wait for green.
3. If Task 1 regresses `main` (e.g., a migrated test flakes in CI when it didn't locally): open a `revert:` PR within 30 minutes; don't leave `main` red.

---

## Verification Gate (Per Task, Before Push)

For Task 1:
```bash
npm run lint
npm run typecheck
npm run test
npm run test:coverage      # coverage must not regress
npm run frontend:build
git status
```

For Task 2 additionally:
```bash
npm run format -- docs/testing/test-helpers.md docs/README.md docs/audits/wave-1a/index.md docs/expansion/98_PROGRESS_LOG.md
```

Do NOT run `npm run test:e2e` per-task (cost). CI runs it.

---

## Key References

- `claude.md` — §5 (Coding Conventions), §8 (Testing).
- `docs/audits/wave-1a/index.md` — Wave-3-test-infra findings section.
- `tests/factories/index.js` — factory barrel (post-Wave-3a).
- `tests/helpers/index.js` — helper barrel (post-Wave-3a).
- `tests/setup.js` — polyfill coverage (post-Wave-3a).
- `frontend/src/App.jsx` — provider order SSoT (for any reconciliation).

---

## Critical Files

**Will edit (Task 1)**:
- `tests/useDashboardData.test.js`
- `tests/authIntegration.test.jsx`
- `tests/usePermission.test.js`
- `tests/teamPersistencePanel.test.jsx`
- `tests/teamGeneration.test.js`

**Will create (Task 2)**:
- `docs/testing/test-helpers.md`

**Will edit (Task 2)**:
- `docs/README.md` — one link
- `docs/audits/wave-1a/index.md` — mark Wave-3 findings shipped
- `docs/expansion/98_PROGRESS_LOG.md` — append dated entry

**Will NOT edit**:
- `claude.md`, any `.claude/wave-*.md`.
- Any file under `frontend/src/`, `packages/core/src/`, `supabase/`.
- Any other test file (only the 5 migration targets).
- `tests/factories/**`, `tests/helpers/**`, `tests/setup.js` (Wave 3a froze these).
- `package.json`, `package-lock.json`.
- `vitest.config.js`, `playwright.config.ts`, `vite.config.js`, `eslint.config.js`, `tsconfig.json`, `.prettierrc`.
- `tests/e2e/**`.
- `docs/architecture/**`, `docs/security/**`.

---

## Out of Scope This Wave

- Migrating more than 5 tests.
- Adding new factories or helpers.
- Raising coverage thresholds.
- `@axe-core/playwright` (Wave 5).
- E2E fixture consolidation (Wave 5).
- pgTAP (Wave 7).
- TypeScript conversion of tests.
- Lighthouse / perf infra (Wave 9).
- `claude.md` → `CLAUDE.md` rename (Wave 8).
- Any production code change.

---

## Ground Rules

- **Assertion preservation**. Every `expect(...)` in the migrated tests survives unchanged.
- **Coverage non-regression**. If a migration drops coverage, fix via explicit factory override, not assertion change.
- **Delete, don't comment out**. Replaced inline mocks are deleted. No `// was: ...` relics.
- **No new infra in Wave 3b**. If migration needs a new factory or helper, Wave 3a was incomplete — re-file rather than patch here.
- **One migration at a time, verify each**. Never migrate all 5 in one pass without per-file test runs.
- **Provider order is sacred**. `renderWithProviders` mirrors `App.jsx`; don't fork.
- **No `--no-verify`, no `--force-push`, no direct commits to `main`**.
- **5-attempt debugging cap** per migration. If stuck, revert THAT file's migration and move on — Task 1 can ship with 4 migrations if one is genuinely adversarial (document in PR body + re-file the skipped one).
