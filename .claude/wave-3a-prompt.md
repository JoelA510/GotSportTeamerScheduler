# Wave 3a — Test-Infrastructure Creation (Factories, Helpers, Setup)

## Session Context

**Prior waves**: 1a + 1b + 2 shipped. Wave 2 closed all security advisors. `docs/audits/wave-1a/index.md` has an `### Wave 3-test-infra` section — read it first.

**Wave 3 split**: 3a creates the new infrastructure under `tests/factories/` + `tests/helpers/` + extends `tests/setup.js`. 3b (separate wave plan) consumes the infra by migrating 5 existing tests and documenting the usage. Splitting keeps each plan under the 700-line cap and lets the infra PRs merge before migrations land.

**Purpose**: build the shared leverage (factories, chainable mocks, provider wrappers) that every subsequent wave's tests depend on. The goal is NOT coverage — it's eliminating boilerplate duplication.

**Motivating pain** (from Wave 1a findings):
- No factories — tests re-declare `makeOrganization`, `makeTeam`, `makePlayer` inline.
- No chain-builder helper — Supabase mocks are hand-rolled per test.
- No shared render wrapper — RTL tests inline the provider boilerplate.
- Minimal `tests/setup.js` (just `@testing-library/jest-dom`).

**Wave 3a is**:
- Creating `tests/factories/` with deterministic factory functions.
- Creating `tests/helpers/` with chain-mock, render-wrapper, auth-mock, mock-DB seeder.
- Extending `tests/setup.js` with jsdom polyfills for APIs that production code uses.
- Writing self-tests for every factory and helper.

**Wave 3a is NOT**:
- Migrating any existing test (Wave 3b).
- Writing `docs/testing/test-helpers.md` (Wave 3b).
- Adding new feature tests (Waves 4+).
- Changing test-runner config.
- Introducing Faker / deterministic-random / global timezone mocks.

---

## Pre-flight Verification

HALT on any false claim.

1. `git status` on `main` is clean.
2. `docs/audits/wave-1a/index.md` exists; read the `### Wave 3-test-infra` section.
3. `npm run test` on `main` is 100 % pass. Record file count + case count + pass rate as `## Baselines` in each PR body.
4. `npm run lint` on `main`: record warning count as baseline.
5. `npm run test:coverage`: record statements/branches/functions/lines %.
6. `tests/factories/` does NOT exist.
7. `tests/helpers/` does NOT exist.
8. `tests/setup.js` currently imports `@testing-library/jest-dom` only (confirm unchanged since Wave 1a).
9. `frontend/src/App.jsx` provider order matches `claude.md` §5 — `BrowserRouter > AuthProvider > OrganizationProvider > ImportProvider > ThemeProvider > ErrorBoundary`. If drift, reconcile Task 2's `renderWithProviders` to the current order.
10. `frontend/src/lib/mockSupabaseClient.js` exists and exports an `initialMockData` object — factory field names must match that schema.

---

## Branch Conventions

- One branch per task, cut from `main`:
  - `claude/wave-3a-factories` → Task 1
  - `claude/wave-3a-helpers` → Task 2
  - `claude/wave-3a-setup-extensions` → Task 3
- Tasks 1–3 are independent; they can merge in any order.
- PR per task. CI must be green before merge.

---

## Wave Scope

Three parallel infrastructure-creation tasks. Every task is purely additive — no existing test file is edited. Self-tests ship with each module.

---

## Task 1 — `tests/factories/`

**Commit**: `chore(test-infra): add shared test factories`

**Branch**: `claude/wave-3a-factories`

### Steps

1. Checkout `claude/wave-3a-factories` from latest `main`. Confirm `tests/factories/` does NOT exist.

2. **Create the factory directory**:
   ```
   tests/factories/
   ├── index.js            # barrel: re-exports every factory
   ├── organization.js     # makeOrganization, makeOrganizationMember
   ├── user.js             # makeUser, makeAuthSession
   ├── season.js           # makeSeason, makeDivision
   ├── team.js             # makeTeam, makeTeamPlayer
   ├── player.js           # makePlayer
   ├── scheduling.js       # makeGameSlot, makePracticeAssignment, makeField, makeFieldBlackout
   ├── audit.js            # makeAuditLogEntry
   └── run.js              # makeSchedulerRun, makeEvaluationRun, makeEvaluationFinding
   ```

3. **Factory conventions** (apply uniformly):
   - **Deterministic defaults** — no `crypto.randomUUID()`, no `Math.random()`, no `new Date()`. Use stable values: `'org-1'`, `'user-1'`, ISO string `'2026-01-01T00:00:00Z'`. Tests needing multiple distinct rows pass `overrides` with suffixes (`'org-1'`, `'org-2'`).
   - **Single `overrides` parameter**, defaults to `{}`. Spread overrides LAST.
   - **Plain objects** (not class instances) — JSON-serializable for sessionStorage.
   - **Schema honesty** — every field must exist in `supabase/migrations/**/*.sql`. Phantom fields = HALT, re-file as audit finding.
   - **Pure functions** — no side effects, no I/O.

   Template:
   ```js
   // tests/factories/organization.js
   export function makeOrganization(overrides = {}) {
     return {
       id: 'org-1',
       name: 'Test Organization',
       slug: 'test-org',
       created_at: '2026-01-01T00:00:00Z',
       updated_at: '2026-01-01T00:00:00Z',
       ...overrides,
     };
   }

   export function makeOrganizationMember(overrides = {}) {
     return {
       id: 'member-1',
       organization_id: 'org-1',
       user_id: 'user-1',
       role: 'admin',
       created_at: '2026-01-01T00:00:00Z',
       ...overrides,
     };
   }
   ```

4. **Cross-reference the real schema** for every field. Sources of truth:
   - Column types: `supabase/migrations/**/*.sql`.
   - `initialMockData` shape: `frontend/src/lib/mockSupabaseClient.js`.
   If a field diverges, fix the factory to match real state — not the other way around.

5. **Write factory self-tests** at `tests/factories/__tests__/<name>.test.js`. Each factory module gets ~5 lines of tests:
   - No-args call returns expected default shape.
   - Overrides merge correctly (override keys win).
   - Explicit `undefined` override wins (sanity check for merge semantics).

6. **Verification gate**:
   ```bash
   npm run lint
   npm run typecheck
   npm run test                  # case count increases by the factory self-tests
   npm run frontend:build        # unchanged (no production import)
   git status                    # only tests/factories/** added
   ```
   Each `FAIL → HALT`.

7. Commit, push, open PR. Include `## Factories added` table: `| module | exports | case count |`.

### Tests to add (Task 1)

- `tests/factories/__tests__/organization.test.js`
- `tests/factories/__tests__/user.test.js`
- `tests/factories/__tests__/season.test.js`
- `tests/factories/__tests__/team.test.js`
- `tests/factories/__tests__/player.test.js`
- `tests/factories/__tests__/scheduling.test.js`
- `tests/factories/__tests__/audit.test.js`
- `tests/factories/__tests__/run.test.js`

### Out of scope (Task 1)

- Consuming factories from any existing test file (Wave 3b).
- TypeScript `.ts` factories (project uses `.js` + JSDoc).
- Factory variants (`makeTeamMinimal`, `makeTeamFull`) — overrides are sufficient.
- Faker or any external dependency.
- E2E fixture files.

---

## Task 2 — `tests/helpers/`

**Commit**: `chore(test-infra): add shared test helpers (chain mock, render wrapper, auth mock, seeder)`

**Branch**: `claude/wave-3a-helpers`

### Steps

1. Checkout `claude/wave-3a-helpers` from latest `main`. Confirm `tests/helpers/` does NOT exist.

2. **Create the helper directory**:
   ```
   tests/helpers/
   ├── index.js                      # barrel
   ├── createChainMock.js            # Supabase chainable query-builder mock
   ├── renderWithProviders.jsx       # RTL render + provider wrapping
   ├── seedMockDb.js                 # sessionStorage mock-DB seeder (E2E-friendly)
   └── mockSupabaseShape.js          # default object shape for vi.mock('supabaseClient')
   ```

   **Not a helper — documented as a template**: the auth-context hoisted-mock pattern (`vi.hoisted` + `vi.mock('@/contexts/AuthContext', ...)`) can NOT be safely extracted into a reusable function. Vitest hoists `vi.mock()` factories above all imports, so a helper function called at runtime cannot install a mock that will be in effect when the mocked module is first imported. The pattern lives in `docs/testing/test-helpers.md` (Wave 3b) as a copy-paste idiom that tests paste at the top of their file. Do NOT ship an `installAuthMock.js` helper.

3. **`createChainMock.js`** — chainable builder mirroring `supabase.from(...).select(...).eq(...).single()`:

   ```js
   // Usage:
   //   const chain = createChainMock({ data: [{ id: '1' }], error: null });
   //   supabase.from.mockReturnValue(chain);
   //   // await chain.select().eq('org_id', 'org-1').single()
   //   //   → { data: [{ id: '1' }], error: null }

   export function createChainMock(resolvedValue) {
     const target = {
       ...resolvedValue,
       // Forward BOTH promise handlers (onFulfilled, onRejected) and any
       // future args. A single-arg signature breaks Vitest/JSDOM internals
       // that rely on the standard Promise shape.
       then: (...args) => Promise.resolve(resolvedValue).then(...args),
     };
     const proxy = new Proxy(target, {
       get(t, prop) {
         if (prop === 'then') return t.then;
         if (prop === 'data' || prop === 'error') return t[prop];
         // Let symbols (Symbol.toStringTag, Symbol.iterator, …) and common
         // introspection properties (toJSON, constructor) fall through to
         // the target. Without this, JSON.stringify, console.log, and test-
         // runner diffing can infinite-recurse or throw.
         if (typeof prop === 'symbol' || prop === 'toJSON' || prop === 'constructor') {
           return t[prop];
         }
         return () => proxy;
       },
     });
     return proxy;
   }
   ```

   The proxy returns itself for every method call (chains), and resolves to `resolvedValue` when awaited. Tests needing method-specific behavior override per-call by calling `createChainMock(...)` again.

4. **`renderWithProviders.jsx`** — RTL `render()` wrapped with the project's provider chain. Provider order MUST mirror `frontend/src/App.jsx` (see pre-flight item 9).

   ```jsx
   import { MemoryRouter } from 'react-router-dom';
   import { render } from '@testing-library/react';
   import { AuthProvider } from '../../frontend/src/contexts/AuthContext.jsx';
   import { OrganizationProvider } from '../../frontend/src/contexts/OrganizationContext.jsx';
   import { ImportProvider } from '../../frontend/src/contexts/ImportContext.jsx';
   import { ThemeProvider } from '../../frontend/src/contexts/ThemeContext.jsx';
   import { makeOrganization, makeUser } from '../factories/index.js';

   export function renderWithProviders(ui, options = {}) {
     const {
       user = makeUser(),
       organization = makeOrganization(),
       route = '/',
       ...rtlOptions
     } = options;

     sessionStorage.setItem('squadlogic_mock_user', JSON.stringify(user));
     localStorage.setItem('squadlogic_active_org', organization.id);

     function Wrapper({ children }) {
       return (
         <MemoryRouter initialEntries={[route]}>
           <AuthProvider>
             <OrganizationProvider>
               <ImportProvider>
                 <ThemeProvider>{children}</ThemeProvider>
               </ImportProvider>
             </OrganizationProvider>
           </AuthProvider>
         </MemoryRouter>
       );
     }

     return render(ui, { wrapper: Wrapper, ...rtlOptions });
   }
   ```

   Note: `<BrowserRouter>` in `App.jsx` becomes `<MemoryRouter>` for tests (avoids jsdom URL issues). `<ErrorBoundary>` is omitted intentionally — tests that need to assert error boundaries wrap manually.

5. **`seedMockDb.js`** — E2E-facing seeder callable via `page.evaluate(seedMockDb, tables)`:

   ```js
   // Pure function; MUST serialize to the browser context.
   // Callers: Playwright step defs passing factory-built rows.

   export function seedMockDb(tables) {
     const current = JSON.parse(sessionStorage.getItem('__MOCK_DB__') || '{}');
     for (const [table, rows] of Object.entries(tables)) {
       current[table] = [...(current[table] || []), ...rows];
     }
     sessionStorage.setItem('__MOCK_DB__', JSON.stringify(current));
   }
   ```

   No imports — `page.evaluate` serializes the function body and runs it in the browser. Factories resolve in the node test context; their plain-object outputs pass into `page.evaluate` as JSON-safe args.

6. **`mockSupabaseShape.js`** — default shape for `vi.mock('@/lib/supabaseClient')`:

   ```js
   import { vi } from 'vitest';

   export const mockSupabaseShape = () => ({
     supabase: {
       from: vi.fn(),
       rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
       auth: {
         getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
         onAuthStateChange: vi.fn().mockReturnValue({
           data: { subscription: { unsubscribe: vi.fn() } },
         }),
         signOut: vi.fn().mockResolvedValue({ error: null }),
       },
       channel: vi.fn().mockReturnValue({
         on: vi.fn().mockReturnThis(),
         subscribe: vi.fn().mockReturnThis(),
         unsubscribe: vi.fn(),
       }),
       storage: {
         from: vi.fn().mockReturnValue({
           upload: vi.fn().mockResolvedValue({ data: null, error: null }),
           createSignedUrl: vi.fn().mockResolvedValue({
             data: { signedUrl: 'https://mock.url/signed' },
             error: null,
           }),
         }),
       },
     },
   });
   ```

7. **Write helper self-tests** at `tests/helpers/__tests__/<name>.test.{js,jsx}`:
   - `createChainMock`: chain `.select().eq().single()` resolves; `await chain` returns `resolvedValue`; `.data` + `.error` accessible directly on the proxy; `JSON.stringify(chain)` and `console.log(chain)` do not infinite-recurse or throw; a `.then()` call with both `onFulfilled` and `onRejected` forwards both.
   - `renderWithProviders`: renders a child without error; localStorage active-org matches the passed `organization.id`; memoryRouter initial route matches.
   - `seedMockDb`: appends rows to the mock DB; doesn't clobber existing tables.
   - `mockSupabaseShape`: every expected method is a `vi.fn()` (spy).

8. Verification gate (same as Task 1).

9. Commit, push, open PR.

### Tests to add (Task 2)

- `tests/helpers/__tests__/createChainMock.test.js`
- `tests/helpers/__tests__/renderWithProviders.test.jsx`
- `tests/helpers/__tests__/seedMockDb.test.js`
- `tests/helpers/__tests__/mockSupabaseShape.test.js`

### Out of scope (Task 2)

- Consuming helpers from any existing test file (Wave 3b).
- Replacing `frontend/src/lib/mockSupabaseClient.js`.
- Storybook / Chromatic.
- React Query / TanStack Query providers (project doesn't use them).
- A second `renderWith*` variant.

---

## Task 3 — `tests/setup.js` Extensions

**Commit**: `chore(test-infra): extend tests/setup.js with jsdom polyfills`

**Branch**: `claude/wave-3a-setup-extensions`

### Steps

1. Checkout `claude/wave-3a-setup-extensions` from latest `main`. Confirm `tests/setup.js` still imports only `@testing-library/jest-dom`.

2. **Identify jsdom gaps** — grep production source (`frontend/src/` + `packages/core/src/`) for these browser APIs. Polyfill only those that (a) production uses AND (b) are exercised by existing tests:
   - `ResizeObserver` — @dnd-kit consumes.
   - `IntersectionObserver` — recharts / lazy-loading may consume.
   - `matchMedia` — design-system media queries consume.
   - `scrollIntoView` — UI patterns consume.

3. **Extend `tests/setup.js` additively** with the canonical idempotent idiom. Apply to every polyfill:

   ```js
   import '@testing-library/jest-dom';

   // jsdom lacks ResizeObserver; @dnd-kit relies on it.
   globalThis.ResizeObserver = globalThis.ResizeObserver || class {
     observe() {}
     unobserve() {}
     disconnect() {}
   };

   // jsdom lacks IntersectionObserver.
   globalThis.IntersectionObserver = globalThis.IntersectionObserver || class {
     constructor() {}
     observe() {}
     unobserve() {}
     disconnect() {}
     takeRecords() { return []; }
   };

   // jsdom lacks matchMedia.
   if (!globalThis.matchMedia) {
     globalThis.matchMedia = (query) => ({
       matches: false,
       media: query,
       onchange: null,
       addListener: () => {},
       removeListener: () => {},
       addEventListener: () => {},
       removeEventListener: () => {},
       dispatchEvent: () => false,
     });
   }

   // jsdom doesn't always stub scrollIntoView on Element.prototype.
   if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
     Element.prototype.scrollIntoView = () => {};
   }
   ```

   Every guard uses `|| existing` / `if (!…)` so re-running setup is idempotent (critical for watch mode).

4. **Do NOT add**:
   - Global `beforeEach` / `afterEach` test-suite hooks.
   - `vi.resetAllMocks()` global.
   - Mocks of production modules (that's per-test `vi.mock()`).
   - Env var overrides (that's Vitest config + `.env.test`).
   - Timezone or locale locks.

5. **Verify no test regression**:
   ```bash
   npm run lint
   npm run typecheck
   npm run test               # existing tests MUST still pass; case count unchanged
   git status                 # only tests/setup.js modified
   ```

6. Commit, push, open PR. Include `## Polyfills added` list with the production-code grep that justified each.

### Tests to add (Task 3)

- None. `tests/setup.js` runs implicitly; direct unit tests of polyfills provide negative value.

### Out of scope (Task 3)

- Changing `vitest.config.js` (setup path, include glob, coverage thresholds).
- Changing `playwright.config.ts`.
- Adding a Vitest plugin.
- Mocking `fetch` globally.
- Faker setup.

---

## Documentation Currency Pass

Handled by Wave 3b closure. Wave 3a touches NO docs.

Do NOT edit:
- `docs/**` — `docs/testing/test-helpers.md` ships in Wave 3b.
- `docs/audits/wave-1a/index.md` — Wave 3b marks findings shipped.
- `docs/expansion/98_PROGRESS_LOG.md` — Wave 3b appends.
- `claude.md`.
- Any `.claude/wave-*.md` file.
- Any production source.

---

## Wave Review (Mandatory Before Declaring 3a Complete)

Any "no" blocks the Wave 3b kickoff.

1. All 3 tasks merged with CI green.
2. **No production code touched**: `git diff main~3 main -- frontend/ packages/ supabase/` empty.
3. `npm run lint` on `main`: warning count ≤ baseline.
4. `npm run typecheck` on `main`: 0 errors.
5. `npm run test` on `main`: 100 % pass; case count = baseline + N (N = factory + helper self-tests). Task 3 adds 0.
6. `npm run test:coverage`: thresholds unchanged; no regression.
7. `npm run frontend:build`: bundle sizes unchanged. Factories + helpers live under `tests/` and MUST NOT leak into production.
8. `tests/factories/` has 9 source modules + 8 `__tests__/` files.
9. `tests/helpers/` has 5 source modules + 4 `__tests__/` files.
10. `tests/setup.js` extended additively (no deletions).
11. No new dependency in `package.json`.
12. No change to `vitest.config.js`, `playwright.config.ts`, `vite.config.js`, `eslint.config.js`, `tsconfig.json`, `.prettierrc`.
13. E2E baseline unchanged — `npm run test:e2e -- --workers=1` passing count matches the post-Wave-2 baseline.
14. **Bundle isolation confirmed**: production build contains zero references to `tests/factories` or `tests/helpers` paths.

---

## Commit & Push to Main

1. Tasks 1–3 PRs can merge in any order.
2. After all 3 merge:
   ```bash
   git checkout main && git pull
   npm install
   npm run lint && npm run typecheck && npm run test && npm run frontend:build
   ```
   All green. CI runs E2E; wait for green.
3. If any task regresses `main`: open a `revert:` PR within 30 minutes.

---

## Verification Gate (Per Task, Before Push)

For all three tasks:
```bash
npm run lint
npm run typecheck
npm run test
npm run frontend:build
git status
```

Each `FAIL → HALT`. Do NOT run `npm run test:e2e` per-task (cost).

---

## Key References

- `claude.md` — §5 (Coding Conventions), §8 (Testing).
- `docs/audits/wave-1a/index.md` — Wave-3-test-infra findings section.
- `docs/audits/wave-1a/code-quality.md` — full finding context.
- `frontend/src/App.jsx` — provider order SSoT for `renderWithProviders`.
- `frontend/src/lib/supabaseClient.js` — client shape that `createChainMock` + `mockSupabaseShape` mirror.
- `frontend/src/lib/mockSupabaseClient.js` — sessionStorage mock; `seedMockDb` writes to its key.
- `vitest.config.js` — setup file path; test include glob.

---

## Critical Files

**Will create (Task 1)**:
- `tests/factories/index.js`
- `tests/factories/organization.js`
- `tests/factories/user.js`
- `tests/factories/season.js`
- `tests/factories/team.js`
- `tests/factories/player.js`
- `tests/factories/scheduling.js`
- `tests/factories/audit.js`
- `tests/factories/run.js`
- `tests/factories/__tests__/*.test.js` (8 files)

**Will create (Task 2)**:
- `tests/helpers/index.js`
- `tests/helpers/createChainMock.js`
- `tests/helpers/renderWithProviders.jsx`
- `tests/helpers/seedMockDb.js`
- `tests/helpers/mockSupabaseShape.js`
- `tests/helpers/__tests__/*.test.{js,jsx}` (4 files)

**Will edit (Task 3)**:
- `tests/setup.js` — additive polyfills only.

**Will NOT edit**:
- `claude.md`, any `.claude/wave-*.md`.
- Any file under `frontend/src/`, `packages/core/src/`, `supabase/`.
- Any existing test file under `tests/`.
- `package.json`, `package-lock.json`.
- `vitest.config.js`, `playwright.config.ts`, `vite.config.js`, `eslint.config.js`, `tsconfig.json`, `.prettierrc`.
- `tests/e2e/**`.
- `docs/**`.

---

## Out of Scope This Wave

- Migrating any existing test (Wave 3b).
- Documenting helpers in `docs/testing/test-helpers.md` (Wave 3b).
- Raising coverage thresholds (Wave 9).
- `@axe-core/playwright` (Wave 5).
- pgTAP / DB test runner (Wave 7).
- E2E fixture consolidation (Wave 5).
- TypeScript conversion of tests.
- Restructuring test directories.
- Lighthouse / perf (Wave 9).
- Any production code change.

---

## Ground Rules

- **Additive only**. Three tasks create files; Task 3 also appends to `tests/setup.js`.
- **Deterministic defaults**. No `Math.random`, `Date.now`, `crypto.randomUUID` inside factory defaults.
- **Schema honesty**. Every factory field matches the real schema. Phantom fields = HALT, re-file.
- **Provider order is sacred**. `renderWithProviders` mirrors `App.jsx` exactly.
- **Bundle purity**. Factories + helpers live under `tests/` and never import into production code. Wave Review step 14 verifies.
- **Test-runner config is off-limits**. No edits to `vitest.config.js`, `playwright.config.ts`.
- **No `--no-verify`, no `--force-push`, no direct commits to `main`**.
- **5-attempt debugging cap** per task.
