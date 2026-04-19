# Wave 4 — OrganizationCreation Onboarding (PR #155 Salvage)

## Session Context

**Prior waves**: 1a, 1b, 2, 3a, 3b shipped. Wave 3a/3b delivered `tests/factories/` + `tests/helpers/` + the `vi.hoisted` auth-mock idiom in `docs/testing/test-helpers.md`. THIS wave is the first to consume that infrastructure in anger.

**Audit backlog**: `docs/audits/wave-1a/index.md` has a `### Wave 4-onboarding` section. Read it before Task 1.

**The PR #155 story** (per `docs/expansion/98_PROGRESS_LOG.md`): an earlier agent attempted a zero-to-one onboarding flow in PR #155. It was closed unmerged with 5 hard blockers:

1. References `organizations.url_slug` — actual column is `slug`.
2. Calls `initialize_new_tenant` with 3 args — actual signature has 4.
3. Imports 5 components that don't exist.
4. Drops critical `DashboardPage` exports.
5. Removes a test dependency.

The branch is **preserved on origin** so the useful scaffolding is salvageable — pre-flight Task 1 confirms the branch still exists and catalogs what's recoverable.

**Current state on main** (verify in pre-flight; prior commit `7116f46 feat(multi-tenant): introduce self-serve zero-to-one onboarding architecture` shipped the skeleton):
- `frontend/src/pages/OrganizationCreation.jsx` EXISTS with all 4 form fields + correct 4-arg RPC call.
- `App.jsx` mounts it as a **blocking conditional render** (lines 63–72), NOT a route. URL never becomes `/organizations/new`; logged-out zero-org users can shadow `/auth/reset-password`.
- No Zod validation (uses HTML `required` only — violates `claude.md` §3 mandate); no hook extraction; success path uses `window.location.href` (full reload); no unit tests.
- `mockSupabaseClient.js` does NOT implement `initialize_new_tenant` — works only against real Supabase.

**Wave purpose**: harden + route-wire the existing cold-start flow. A cold-logged-in user with zero orgs lands on `/organizations/new` via a proper route, form validates through Zod, mock or real `initialize_new_tenant` RPC fires, they arrive at the admin dashboard via SPA navigation. End-to-end covered by a new E2E scenario.

**Wave is**:
- Auditing PR #155 + current main state for salvage gaps.
- Implementing `initialize_new_tenant` in `frontend/src/lib/mockSupabaseClient.js` (new).
- **Refactoring** (not creating) `OrganizationCreation` — extract `useOrganizationCreation` hook, add Zod validation, switch to React Router `navigate`, add unit tests.
- **Refactoring** `App.jsx` — add `/organizations/new` route, remove the `hasNoOrgs` blocking render, add a route-based redirect for authenticated users with zero orgs.
- A new E2E feature file exercising the cold-start flow.
- Closure: audit index + progress log + architecture doc sync.

**Wave is NOT**:
- White-labeling / custom domains (out of scope for v1.0.1 entirely).
- Organization settings / editing UI (future wave).
- Org member invitations (out of scope).
- Stripe / licensing gates on creation (the `initialize_new_tenant` RPC already handles provisioning limits; no new gates here).
- Renaming `slug` → anything else (field name stays `slug`; the fix is to MATCH that name, not change it).

---

## Pre-flight Verification

HALT on any false claim.

1. `git status` on `main` is clean.
2. `docs/audits/wave-1a/index.md` `### Wave 4-onboarding` section is readable.
3. `tests/factories/` and `tests/helpers/` exist with the Wave 3a barrel files (`index.js`, `createChainMock.js`, `renderWithProviders.jsx`, `seedMockDb.js`, `mockSupabaseShape.js`). `docs/testing/test-helpers.md` exists.
4. PR #155's branch still exists on origin: `gh api repos/JoelA510/SquadLogic/pulls/155 --jq '.head.ref'` returns a branch name (likely `claude/onboarding-testing-suite` or similar). If the branch was purged, the Task 1 salvage path shifts — document the shift before starting.
5. `frontend/src/lib/mockSupabaseClient.js` exists; grep for `initialize_new_tenant` — should return 0 matches (confirming the RPC stub is missing).
6. `supabase/migrations/20260416000001_initialize_new_tenant.sql` exists (the real RPC definition). Open it — the authoritative signature is here.
7. `supabase/migrations/**/*.sql` — grep `organizations` for column list. Confirm `slug text` exists (not `url_slug`).
8. `frontend/src/App.jsx` — confirm current route table. The flow assumes:
   - `/` — dashboard (for users with an active org).
   - `/login` — login page.
   - No current `/organizations/new` route.
9. Baselines on `main`:
   - `npm run test`: case count + pass rate.
   - `npm run lint`: warning count.
   - `npm run test:coverage`: thresholds met.
   - `npm run frontend:build`: bundle sizes.
   - `npm run test:e2e -- --workers=1`: passing count (should match post-Wave-2 baseline).

If the real RPC signature in migration `20260416000001_initialize_new_tenant.sql` has been changed since Wave 1 discovery (4-arg → 5-arg, renamed args, etc.), Task 2's mock implementation must mirror the CURRENT signature.

---

## Branch Conventions

- One branch per task, cut from `main`:
  - `claude/wave-4-salvage-audit` → Task 1 (read-only design doc)
  - `claude/wave-4-mock-rpc` → Task 2 (mock client RPC)
  - `claude/wave-4-org-creation-ui` → Task 3 (component + hook)
  - `claude/wave-4-route-wiring` → Task 4 (router + nav)
  - `claude/wave-4-e2e-cold-start` → Task 5 (E2E scenario)
  - `claude/wave-4-closure` → Task 6 (docs + audit index)

Dependencies:
- Task 1 → Tasks 2, 3 (design informs implementation).
- Tasks 2, 3 parallel after Task 1.
- Task 4 depends on Task 3 (needs the component).
- Task 5 depends on Tasks 2 + 3 + 4.
- Task 6 depends on all.

PR per task. CI must be green before each merge.

---

## Wave Scope

Six tasks: one design audit, three implementation, one E2E, one closure. End-to-end deliverable is `/organizations/new` rendering the form, mock + real RPC paths working, E2E scenario green.

---

## Task 1 — PR #155 Salvage Audit

**Commit**: `chore(audit): wave-4 pr-155 salvage map`

**Branch**: `claude/wave-4-salvage-audit`

**Output**: `docs/audits/wave-4-salvage/pr-155-design.md` (new file) — READ-ONLY audit.

### Steps

1. Checkout `claude/wave-4-salvage-audit` from latest `main`.

2. **Inspect PR #155's branch**:
   ```bash
   gh pr view 155 --json headRefName,files
   gh pr checkout 155    # OR: git fetch origin <branch> && git checkout -b wave-4-salvage-inspect origin/<branch>
   ```
   Do NOT merge or cherry-pick anything in this task — just read.

3. **Enumerate what PR #155 tried to ship** — walk every file it added / modified / removed. For each, categorize:
   - `keep` — adopt as-is in Wave 4 (the file was fine).
   - `fix` — adopt with specific corrections (list the corrections).
   - `reject` — do not adopt (the file was misguided OR has been superseded).
   - `already-shipped` — the change landed in a subsequent PR; no action needed.

4. **Resolve each of the 5 hard blockers** explicitly in the design doc:
   - **Blocker 1 — `url_slug` vs `slug`**: confirm the real column is `slug` (pre-flight item 7). Every reference in the salvaged code must use `slug`.
   - **Blocker 2 — `initialize_new_tenant` signature**: read `supabase/migrations/20260416000001_initialize_new_tenant.sql` and document the EXACT current signature (arg names + types + order + return shape). Every caller must match.
   - **Blocker 3 — 5 non-existent components**: list the 5 by name. For each, decide: (a) skip entirely, (b) inline the required JSX into `OrganizationCreation` (Task 3), or (c) build as a new shared component. Most should be inlined (minimum-surface-area principle).
   - **Blocker 4 — dropped `DashboardPage` exports**: identify what PR #155 removed. Those exports stay in Wave 4.
   - **Blocker 5 — removed test dependency**: identify which dep + why. Restoration path: keep the dep in `package.json`.

5. **Write `docs/audits/wave-4-salvage/pr-155-design.md`**. Structure:
   - `## Overview` — what PR #155 tried to ship (1 paragraph).
   - `## File-by-file salvage map` — table: `| Path | Action | Notes |`.
   - `## Hard-blocker resolution` — one section per blocker with the resolution.
   - `## Design for Wave 4 implementation` — high-level shape (routes, components, hooks, RPC calls) that Tasks 2–5 follow.
   - `## Out of scope` — explicitly list things PR #155 tried that we are NOT adopting.

6. **Do NOT merge PR #155**. Do NOT cherry-pick into this branch. This task produces only the audit doc.

7. **Cleanup**: `git checkout <wave-4-salvage-audit-branch>` to return to your working branch. Any branch created for inspection in Step 2 is local-only; do not push it.

8. Verification gate:
   ```bash
   npm run lint
   npm run typecheck
   npm run test
   npm run frontend:build
   git status                    # only docs/audits/wave-4-salvage/pr-155-design.md added
   ```

9. Commit, push, open PR.

### Tests to add (Task 1)

- None. Audit task.

### Out of scope (Task 1)

- Cherry-picking or merging any code.
- Editing any non-doc file.
- Adopting the PR #155 tests verbatim (Task 3 + 5 write new tests against the current infra).

---

## Task 2 — Mock `initialize_new_tenant` RPC

**Commit**: `feat(mock): implement initialize_new_tenant RPC in mockSupabaseClient`

**Branch**: `claude/wave-4-mock-rpc`

**Depends on**: Task 1 merged (for the signature documentation).

### Steps

1. Checkout `claude/wave-4-mock-rpc` from latest `main` AFTER Task 1 merges. Read `docs/audits/wave-4-salvage/pr-155-design.md` § Hard-blocker resolution → Blocker 2 for the EXACT signature.

2. **Extend `frontend/src/lib/mockSupabaseClient.js`**:
   - Add an `initialize_new_tenant` case to the `.rpc(name, args)` dispatcher (if the mock has one) or introduce the pattern.
   - Signature MUST match the real migration's `initialize_new_tenant(arg1, arg2, arg3, arg4)` verbatim — including default values, nullability, and return shape.
   - Mock behavior:
     - Validate inputs: non-empty org name, valid slug shape (`[a-z0-9-]+`, 3–50 chars).
     - Idempotency: if `slug` already exists in `initialMockData.organizations`, return the "slug taken" error matching the real function's error shape.
     - Success path: insert a new row into `organizations`, insert an `organization_members` row with the caller's user_id + role `admin`, insert a default `season_settings` row if the real function does, append an `audit_log` row matching the real function's metadata, return the new org's id (or whatever the real function returns).
   - Use factory-compatible shapes so `tests/factories/organization.js` + `organization_member.js` remain the SSoT.

3. **Write unit tests** at `tests/mockInitializeNewTenant.test.js`:
   - Import `mockSupabaseClient` directly (the module under test).
   - Use `tests/factories/` — import `makeUser`, `makeOrganization`, `makeOrganizationMember`.
   - Assertions:
     - Calling `.rpc('initialize_new_tenant', validArgs)` returns `{ data: <shape>, error: null }`.
     - Subsequent `.from('organizations').select()` returns the new org.
     - Subsequent `.from('organization_members').select()` includes the caller as `admin`.
     - `.from('audit_log').select()` includes the provisioning entry.
     - Duplicate slug returns the expected error shape; no side-effects to the mock DB.
     - Invalid args (empty name, bad slug, missing user_id) return the expected validation error shape.
   - ≥ 6 test cases.

4. **Do NOT** change the real RPC (migration stays untouched). Do NOT add any other mock-client functionality beyond what `initialize_new_tenant` needs.

5. Verification gate:
   ```bash
   npm run lint
   npm run typecheck
   npm run test                    # case count increases by the new test cases
   npm run frontend:build          # bundle sizes may shift marginally (mock-only); document the delta
   git status                      # only the two files touched
   ```

6. Commit, push, open PR.

### Tests to add (Task 2)

- `tests/mockInitializeNewTenant.test.js`

### Out of scope (Task 2)

- Modifying the real `initialize_new_tenant` SQL function.
- Implementing OTHER RPCs in the mock.
- Adding a new factory (existing `makeOrganization` / `makeOrganizationMember` suffice — extend with overrides).
- Edge Function wiring (there is no Edge Function for this flow; it's a direct RPC).

---

## Task 3 — OrganizationCreation Component + Hook

**Commit**: `feat(onboarding): add OrganizationCreation component + useOrganizationCreation hook`

**Branch**: `claude/wave-4-org-creation-ui`

**Depends on**: Task 1 merged; can run in parallel with Task 2 (uses the mock RPC only in tests, which can stub).

### Steps

1. Checkout `claude/wave-4-org-creation-ui` from latest `main` AFTER Task 1 merges.

2. **Build `frontend/src/hooks/useOrganizationCreation.js`** (new) by extracting the submission logic from the existing `frontend/src/pages/OrganizationCreation.jsx`:
   - Accepts all four RPC fields: `name`, `slug`, `timezone` (default `Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'`), `seasonYear` (default `new Date().getFullYear()`).
   - Internally uses `supabase.rpc('initialize_new_tenant', { p_name, p_slug, p_timezone, p_season_year })`.
   - Returns `{ createOrganization, loading, error, newOrgId }`.
   - On success, sets `newOrgId`; caller navigates via React Router `useNavigate()` (replace the existing `window.location.href` full-page reload).
   - **Zod schema gates all four inputs BEFORE the RPC call** (per `claude.md` §3 "Schema Rigidity"): `name` 3–100 chars; `slug` matches `/^[a-z0-9-]+$/`, 3–50 chars; `timezone` non-empty string (validate against IANA with `Intl.DateTimeFormat` round-trip if feasible, otherwise non-empty check); `seasonYear` integer between 2020 and 2100 (matches the HTML `min`/`max` bounds in the existing component); required user context.
   - Surface per-field validation errors for the component to display.

3. **Refactor `frontend/src/pages/OrganizationCreation.jsx`** (exists on main; keep at this path — pages live under `pages/` per `claude.md` §5):
   - Keep the existing form inputs (name, slug, timezone, seasonYear) + the auto-slug-generation effect.
   - Keep the existing design-system classes (`.glass-panel-premium`, `.glass-input`, `.glass-button`, etc.).
   - **Extract submission logic** to the new `useOrganizationCreation` hook (Step 2). Component becomes a controlled form that calls `createOrganization(formValues)` and reads `{ loading, error, newOrgId }` from the hook.
   - **Replace `window.location.href = '/?new_org=true'`** with React Router's `useNavigate()` + `navigate('/?new_org=true')`. Full-page reload was a workaround; React Router navigation preserves SPA state and avoids a re-bootstrap.
   - **Add a11y**: `<label htmlFor>` + `<input id>` pairing; `aria-describedby` + `role="alert"` on field errors; `role="status"` + `aria-live="polite"` on loading + success; explicit `type="submit"` / `type="button"` on every `<button>` (confirm design-system `Button`'s `type` prop handling).
   - **Preserve** the success animation + audit-log footer text. These are existing UX, not in scope to change.
   - **Handle duplicate-slug error** from Task 2's mock (and the real function) by surfacing an inline field error under the slug input, not just the banner — the error shape from the RPC should be pattern-matched.
   - **Do NOT** introduce any of PR #155's ghost components. The current skeleton doesn't have them; keep it that way.

4. **Do NOT**:
   - Add a new navigation entry in the sidebar — cold-start users have no active org, so sidebar isn't rendered anyway.
   - Introduce any of the 5 "ghost components" PR #155 imported. The design doc (Task 1) documents why each is skipped.
   - Drop any `DashboardPage` export (Blocker 4 preservation).
   - Change `package.json` dependencies except if Task 1's design doc surfaces a genuine need (unlikely).

5. **Write unit tests** at `tests/OrganizationCreation.test.jsx`:
   - Uses `tests/helpers/renderWithProviders` + `tests/factories/`.
   - Uses `tests/helpers/createChainMock` for `supabase.rpc` mocking.
   - Uses the Wave 3b hoisted-auth-mock idiom (per `docs/testing/test-helpers.md`) for the authenticated user.
   - Assertions:
     - Empty form: Submit button disabled OR schema-validation error surfaces.
     - Valid inputs: RPC is called with the correct 4-arg payload.
     - RPC success: navigates to `/` (mock the router's `navigate` fn).
     - Duplicate slug: inline field error appears; no navigation.
     - RPC error (generic): error banner appears; form not disabled permanently.
     - Loading state: submit disabled while in flight; `role="status"` announcement visible.
   - ≥ 8 test cases.

6. **Write hook-specific tests** at `tests/useOrganizationCreation.test.js`:
   - Unit tests for the hook in isolation (Zod validation paths, RPC success + error shapes, state transitions).
   - ≥ 5 test cases.

7. **No route wiring yet** — Task 4 adds the route. This task produces the component + hook as importable modules.

8. Verification gate:
   ```bash
   npm run lint
   npm run typecheck
   npm run test
   npm run frontend:build       # bundle size increases by the component; document the delta
   git status
   ```

9. Commit, push, open PR. PR body includes the bundle-size delta.

### Tests to add (Task 3)

- `tests/OrganizationCreation.test.jsx`
- `tests/useOrganizationCreation.test.js`

### Out of scope (Task 3)

- Adding a route (Task 4).
- Navigation updates (sidebar, dashboard CTA).
- Org settings UI.
- Member invitation UI.
- Custom branding / logo upload.
- Any of the 5 "ghost components".
- Edge Function wiring (direct RPC only).

---

## Task 4 — Route Wiring

**Commit**: `feat(onboarding): add /organizations/new route`

**Branch**: `claude/wave-4-route-wiring`

**Depends on**: Task 3 merged.

### Steps

1. Checkout `claude/wave-4-route-wiring` from latest `main` AFTER Task 3 merges.

2. **Refactor `frontend/src/App.jsx`** — the existing `AppContent` conditionally renders `<OrganizationCreation />` at lines 65–72 when `hasNoOrgs` is true, which (a) never updates the URL to `/organizations/new`, (b) makes any dashboard-level redirect unreachable, and (c) can shadow public routes like `/auth/reset-password` for logged-out users (because `organizations.length === 0` when no session exists). Fix by replacing the conditional return with a proper route + route-based redirect:

   a. The `React.lazy()` import for `OrganizationCreation` already exists (line 38). Keep it; no new lazy import needed.

   b. **Delete the `hasNoOrgs` conditional block** (lines 63–72 — the `const hasNoOrgs = …` declaration AND the `if (hasNoOrgs) return …` render).

   c. **Add a new `<Route>`** inside the existing `<Routes>` block:
      ```jsx
      <Route path="/organizations/new" element={<OrganizationCreation />} />
      ```
      Place it at the same level as the other public-ish routes (e.g., next to `/auth/reset-password` at line 81). Do NOT wrap it in `<ProtectedRoute>` with an org-role permission — authenticated-but-no-org is the intended user here. If the existing session gate (lines 55–61) already requires a session, that's sufficient gating.

   d. **Add a route-based redirect** for authenticated users with zero orgs. Preferred: a top-of-`AppContent` guard AFTER the session gate — `if (session && !orgLoading && organizations.length === 0 && location.pathname !== '/organizations/new') return <Navigate to="/organizations/new" replace />;`. Alternative: a wrapper inside the `/` `<Route>` element. Whichever path: logged-out users navigating to `/auth/reset-password` must still reach the reset page — verify in Step 5.

   e. **Preserve `DashboardPage` exports** (PR #155's Blocker 4): do NOT rewrite any page component, only the routing glue in `App.jsx`.

3. **Do NOT**:
   - Restructure the router layout beyond the surgical changes above.
   - Add new ProtectedRoute variants.
   - Change the sidebar navigation.
   - Introduce a landing page separate from `/login`.
   - Rename or move `OrganizationCreation.jsx` (it stays at `frontend/src/pages/`).

4. **Update unit tests** for `App.jsx` if they exist (grep `tests/App.test.*` — may not exist). Only if they do: ensure both the new route resolves AND the public-route-when-logged-out path (`/auth/reset-password`) still works.

5. **Smoke test manually** in mock mode (`VITE_USE_MOCK_SUPABASE=true` via `npm run frontend:dev`). Document the 4 paths in the PR body:
   - Logged in + 0 orgs: `/` → redirects to `/organizations/new` (URL updates; form renders).
   - Logged in + 1+ orgs: `/` → dashboard.
   - Logged out: `/auth/reset-password` → reset page (NOT shadowed by `<OrganizationCreation>`).
   - Logged out: `/organizations/new` → redirected to `/login` via existing session gate.

6. Verification gate:
   ```bash
   npm run lint
   npm run typecheck
   npm run test
   npm run frontend:build         # lazy chunk for /organizations/new appears in its own file; document size
   git status
   ```

7. Commit, push, open PR.

### Tests to add (Task 4)

- None in Vitest (route-level smoke handled by E2E in Task 5).
- If `App.jsx` has an existing route-resolution test, extend it with one assertion for the new path.

### Out of scope (Task 4)

- Any UI design change to the component itself (Task 3 owned that).
- New ProtectedRoute variants.
- Sidebar / top-nav updates.
- Landing page redesign.

---

## Task 5 — E2E Cold-Start Scenario

**Commit**: `test(e2e): add onboarding cold-start scenario`

**Branch**: `claude/wave-4-e2e-cold-start`

**Depends on**: Tasks 2 + 3 + 4 merged.

### Steps

1. Checkout `claude/wave-4-e2e-cold-start` from latest `main` AFTER Tasks 2, 3, 4 merge.

2. **Create `tests/e2e/features/onboarding_cold_start.feature`**:
   ```gherkin
   Feature: Cold-start organization creation
     A newly-registered user with zero organizations can create one
     and land on the admin dashboard.

     Scenario: Authenticated user with no org creates their first org
       Given I am logged into SquadLogic as a brand-new user with no organizations
       When I navigate to "/organizations/new"
       And I fill in the organization name "Acme Youth Soccer"
       And I fill in the organization slug "acme-youth-soccer"
       And I submit the creation form
       Then I should see the admin dashboard for "Acme Youth Soccer"
       And the audit log should contain a "tenant.provisioned" entry

     Scenario: Duplicate slug shows an inline error
       Given an organization exists with slug "taken-slug"
       And I am logged into SquadLogic as a brand-new user with no organizations
       When I navigate to "/organizations/new"
       And I fill in the organization name "Duplicate Test"
       And I fill in the organization slug "taken-slug"
       And I submit the creation form
       Then I should see an inline error "slug already taken"
       And I should remain on "/organizations/new"

     Scenario: Zero-org user lands on /organizations/new on app load
       Given I am logged into SquadLogic as a brand-new user with no organizations
       When I navigate to "/"
       Then I should be redirected to "/organizations/new"
   ```
   (Third scenario ONLY if Task 4 implemented the zero-org redirect; otherwise drop it.)

3. **Extend `tests/e2e/steps/`** — add steps in a new `tests/e2e/steps/onboarding.ts` OR reuse existing files:
   - `Given I am logged into SquadLogic as a brand-new user with no organizations` — uses `tests/helpers/seedMockDb` + `tests/factories/` to inject a user with zero org memberships.
   - `Given an organization exists with slug "<slug>"` — uses `seedMockDb` to preseed.
   - `When I navigate to "<path>"` — if already defined in `common_steps.ts`, reuse; do not duplicate.
   - `When I fill in the organization (name|slug) "<value>"` — uses form-field locators from Task 3's component.
   - `When I submit the creation form` — click the submit button by accessible name.
   - `Then I should see the admin dashboard for "<name>"` — asserts dashboard layout rendered + org name visible.
   - `Then I should see an inline error "<text>"` — asserts the error banner or field error.
   - `Then I should remain on "<path>"` — URL assertion.
   - `Then the audit log should contain a "<action>" entry` — reads `sessionStorage.__MOCK_DB__`'s `audit_log` table (via `page.evaluate`), asserts presence.

4. **Regenerate `.features-gen-local/`**:
   ```bash
   npm run test:e2e       # runs bddgen + playwright; alternative: npx bddgen alone
   ```
   Confirm the new `.spec.ts` files materialize in `.features-gen-local/` (gitignored, not committed).

5. **All 3 scenarios should pass**. Target: post-Wave-2 E2E baseline + 3 passing = baseline + 3.

6. **Do NOT**:
   - Fix unrelated pre-existing E2E failures (Wave 5 owns those).
   - Refactor existing step files beyond the minimum needed to add these steps.
   - Add visual-regression baselines.

7. Verification gate:
   ```bash
   npm run lint
   npm run typecheck
   npm run test                       # unchanged from post-Task-3
   npm run test:e2e -- --workers=1    # new count = baseline + 3 passing
   git status                         # only tests/e2e files modified
   ```

8. Commit, push, open PR. PR body includes the E2E pass-count delta.

### Tests to add (Task 5)

- `tests/e2e/features/onboarding_cold_start.feature`
- `tests/e2e/steps/onboarding.ts` (or step additions to existing step files — document in PR which)

### Out of scope (Task 5)

- Fixing any of the 23 pre-existing E2E failures (Wave 5).
- Running axe-core against these scenarios (Wave 5 integrates axe).
- Cross-browser (Chromium-only per `playwright.config.ts`).
- Visual regression.
- Accessibility-specific E2E scenarios (Wave 5).

---

## Task 6 — Closure

**Commit**: `docs(wave-4): closure — onboarding shipped`

**Branch**: `claude/wave-4-closure`

**Depends on**: Tasks 1–5 merged.

### Steps

1. Checkout `claude/wave-4-closure` from latest `main` AFTER Tasks 1–5 merge.

2. **Update `docs/audits/wave-1a/index.md`**:
   - For each `Wave 4-onboarding` finding: prepend `✅`, set `Proposed wave` to `4 (shipped)`.
   - Append a `## Wave 4 closure` section summarizing: hard-blocker resolutions, new route added, mock RPC added, E2E scenarios added, bundle-size delta, E2E pass-count delta.

3. **Update `docs/architecture/frontend-architecture.md`**:
   - Add `/organizations/new` to the route inventory.
   - Add `OrganizationCreation` to the component inventory under the appropriate feature-grouping sub-section.
   - Add `useOrganizationCreation` to the hooks inventory.
   - One-paragraph note on the cold-start flow with a pointer to `docs/audits/wave-4-salvage/pr-155-design.md` for the salvage history.

4. **Append to `docs/expansion/98_PROGRESS_LOG.md`**:
   ```
   ## 2026-MM-DD — Wave 4 onboarding (PR #155 salvage)

   Six PRs shipped:
   - Task 1: PR #155 salvage design doc.
   - Task 2: mock initialize_new_tenant RPC with 6+ unit tests.
   - Task 3: OrganizationCreation REFACTORED (Zod validation, hook
     extraction, SPA navigation, a11y) + useOrganizationCreation hook
     with 13+ unit tests.
   - Task 4: /organizations/new route wired; App.jsx hasNoOrgs
     blocking render removed in favor of route-based redirect.
   - Task 5: 3 E2E cold-start scenarios (baseline + 3 passing).
   - Task 6: closure.

   Hard blockers from PR #155 resolved:
   1. slug column (not url_slug) used throughout.
   2. initialize_new_tenant 4-arg signature honored.
   3. 5 ghost-component imports skipped (inlined or dropped).
   4. DashboardPage exports preserved.
   5. Test dependencies preserved.

   Bundle delta: +N KB lazy-chunk for /organizations/new.
   E2E baseline: before + 3 new scenarios passing.
   ```

5. **Do NOT** archive `docs/audits/wave-4-salvage/` — it stays as historical record.

6. Verification gate:
   ```bash
   npm run lint
   npm run typecheck
   npm run test
   npm run frontend:build
   npm run format -- docs/audits/wave-1a/index.md docs/architecture/frontend-architecture.md docs/expansion/98_PROGRESS_LOG.md
   git status
   ```

7. Commit, push, open PR.

### Tests to add (Task 6)

- None.

### Out of scope (Task 6)

- Editing any `.claude/wave-*.md` file.
- Archiving anything.
- Editing other architecture docs beyond `frontend-architecture.md` (Wave 8 owns broader doc gap-closure).

---

## Documentation Currency Pass

Handled by Task 6:
1. `docs/audits/wave-1a/index.md` — findings shipped.
2. `docs/architecture/frontend-architecture.md` — route + component + hook added.
3. `docs/expansion/98_PROGRESS_LOG.md` — dated entry.

Do NOT touch: `claude.md`, `docs/expansion/03_ROADMAP.md`, `docs/testing/**`, `docs/security/**`, `docs/operations/**`, any `.claude/wave-*.md`.

---

## Wave Review (Mandatory Before Final Merge)

Any "no" blocks push.

1. All 6 tasks merged with CI green.
2. `docs/audits/wave-4-salvage/pr-155-design.md` exists (Task 1).
3. `frontend/src/lib/mockSupabaseClient.js` implements `initialize_new_tenant` with signature matching the real migration.
4. `frontend/src/components/OrganizationCreation.jsx` + `frontend/src/hooks/useOrganizationCreation.js` exist and are lazy-loaded via `App.jsx`.
5. `/organizations/new` route resolves for authenticated users.
6. `tests/e2e/features/onboarding_cold_start.feature` exists with ≥ 2 (ideally 3) scenarios all passing.
7. `npm run lint` on `main`: warning count ≤ baseline.
8. `npm run typecheck` on `main`: 0 errors.
9. `npm run test` on `main`: 100 % pass; case count = baseline + Task 2 (6+) + Task 3 (13+) new cases.
10. `npm run test:coverage`: thresholds met. New component + hook + RPC mock covered.
11. `npm run frontend:build`: bundle sizes documented. New `/organizations/new` lazy chunk should be ≤ 50 KB gzipped.
12. `npm run test:e2e -- --workers=1`: passing count = baseline + 2 or +3 (the new scenarios).
13. NONE of the 5 PR #155 hard blockers were re-introduced: `grep -rn "url_slug" frontend/ packages/` returns 0; `initialize_new_tenant` calls pass 4 args; the 5 ghost-component imports are absent; `DashboardPage` still exports its canonical set; the removed test dep is still in `package.json`.
14. `docs/architecture/frontend-architecture.md` lists the new route + component + hook.
15. **Test-impact reconciled**: unit test case count delta = exactly Task 2's additions + Task 3's additions. If more were added, document why.
16. **Free-tier posture preserved**: no new Edge Function invocations, no new scheduled jobs, no new realtime channels.

---

## Commit & Push to Main

1. Task 1 lands first.
2. Tasks 2 + 3 can merge in parallel AFTER Task 1.
3. Task 4 merges AFTER Task 3.
4. Task 5 merges AFTER Tasks 2, 3, 4.
5. Task 6 lands last.
6. Each PR: CI green → merge → next.
7. On regression (lint / typecheck / test / build / E2E): revert PR within 30 min; do not leave `main` red.

---

## Verification Gate (Per Task, Before Push)

For Tasks 1, 2, 3, 4, 6:
```bash
npm run lint
npm run typecheck
npm run test
npm run frontend:build
git status
```
Each `FAIL → HALT`.

For Task 3 additionally:
```bash
npm run test:coverage        # coverage does not regress
```

For Task 5 additionally:
```bash
npm run test:e2e -- --workers=1   # new scenarios pass; baseline unchanged
```

Do NOT run `npm run test:e2e` per-task for Tasks 1–4 (cost). CI runs it on merge.

---

## Key References

- `claude.md` — §3 (workflow, RPC enforcement, Zod mandate), §5 (conventions), §6 (design system), §9 (a11y).
- `docs/audits/wave-1a/index.md` — Wave-4-onboarding findings section.
- `docs/audits/wave-4-salvage/pr-155-design.md` — salvage design (produced by Task 1).
- `docs/testing/test-helpers.md` — hoisted-auth-mock idiom + factory / helper usage.
- `supabase/migrations/20260416000001_initialize_new_tenant.sql` — real RPC signature.
- `frontend/src/lib/mockSupabaseClient.js` — mock-client module.
- `frontend/src/App.jsx` — router SSoT.
- `frontend/src/contexts/OrganizationContext.jsx` — org-switching logic (Task 4 redirect reads `organizations.length`).

---

## Critical Files

**Will create (Task 1)**:
- `docs/audits/wave-4-salvage/pr-155-design.md`

**Will edit (Task 2)**:
- `frontend/src/lib/mockSupabaseClient.js`

**Will create (Task 2)**:
- `tests/mockInitializeNewTenant.test.js`

**Will create (Task 3)**:
- `frontend/src/hooks/useOrganizationCreation.js` (new — extracted from existing page)
- `tests/OrganizationCreation.test.jsx`
- `tests/useOrganizationCreation.test.js`

**Will edit (Task 3)**:
- `frontend/src/pages/OrganizationCreation.jsx` (EXISTS — refactor: extract logic to hook, add Zod, switch from `window.location.href` to `navigate`, a11y wiring)

**Will edit (Task 4)**:
- `frontend/src/App.jsx` (delete `hasNoOrgs` conditional return at lines 63–72; add `<Route path="/organizations/new">`; add route-based redirect for zero-org users)

**Will create (Task 5)**:
- `tests/e2e/features/onboarding_cold_start.feature`
- `tests/e2e/steps/onboarding.ts` (or additions to an existing step file)

**Will edit (Task 6)**:
- `docs/audits/wave-1a/index.md`
- `docs/architecture/frontend-architecture.md`
- `docs/expansion/98_PROGRESS_LOG.md`

**Will NOT edit**:
- `claude.md`, any `.claude/wave-*.md`.
- `supabase/migrations/**` (the real `initialize_new_tenant` stays).
- `supabase/functions/**` (no Edge Function for this flow).
- `package.json`, `package-lock.json` (restoration of the test dep REMOVED by PR #155 counts as "preserving main", not a change — main already has it).
- `vitest.config.js`, `playwright.config.ts`, `vite.config.js`, `eslint.config.js`, `tsconfig.json`, `.prettierrc`.
- `tests/factories/**`, `tests/helpers/**`, `tests/setup.js` (Wave 3a froze these).
- `docs/audits/wave-1a/*.md` sub-reports (frozen).

---

## Out of Scope This Wave

- White-labeling / custom domains / custom branding.
- Org settings / editing UI.
- Org deletion UI.
- Member invitation UI.
- Licensing / Stripe gates on creation.
- Renaming `slug` column.
- Redesigning `/` dashboard beyond a zero-org guard (optional).
- Modifying other Supabase RPCs.
- Adding Edge Functions.
- Performance budgets (Wave 6).
- Axe-core a11y runtime scans (Wave 5).
- Visual regression baselines.
- CSP tightening (Wave 7).
- Doc gap closure beyond `frontend-architecture.md` (Wave 8).

---

## Ground Rules

- **Salvage, don't replay**. Task 1's design doc is authoritative. If PR #155 did something Task 1 rejected, we don't adopt it — not even with fixes.
- **Minimum-surface-area principle**. Inline JSX beats a new sub-component. 5 ghost components stay ghosts.
- **Schema honesty**. `slug` is the column name. `initialize_new_tenant` has a specific signature. Match both.
- **Test with the new infra**. Every unit test uses `tests/factories/` + `tests/helpers/` where applicable. No new inline `<Provider>` boilerplate.
- **Hoisted-auth-mock idiom** lives at the TOP of test files — never inside a function call.
- **No new Edge Function**. Direct RPC calls only (cost discipline).
- **No new dependency** in `package.json`.
- **Lazy-load the new page** in `App.jsx` (code-split discipline; bundle review step 11).
- **No `--no-verify`, no `--force-push`, no direct commits to `main`**.
- **5-attempt debugging cap** per task. If stuck, revert the task's branch and re-file the remaining work.
