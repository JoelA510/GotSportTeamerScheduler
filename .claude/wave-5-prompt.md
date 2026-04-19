# Wave 5 — E2E Stabilization + `@axe-core/playwright`

## Session Context

**Prior waves**: 1a, 1b, 2, 3a, 3b, 4 shipped. Wave 3 built `tests/factories/` + `tests/helpers/`; Wave 4 proved the infra on a real feature.

**E2E baseline entering Wave 5**: 40/63 passing per `TEST_CHECKLIST.md:112`, plus +2 or +3 new passing scenarios from Wave 4 Task 5 (cold-start onboarding). So the concrete starting line is **42–43 / 64–66 scenarios passing**. The exact number is captured by Task 1's pre-flight.

**Wave purpose**: bring the E2E suite to **63/63 (or 66/66 if Wave 4 added 3)** with any remaining exemptions documented in a waiver table pointing at a future wave/backlog item. Plus integrate `@axe-core/playwright` on 10 high-traffic scenarios so a11y regressions become CI-visible.

**Audit backlog**: `docs/audits/wave-1a/index.md` has a `### Wave 5-e2e` section. Read it before Task 1. Wave 1a Task 4.5 (accessibility audit) produced findings tagged `5-e2e` — they land in Task 1's axe-integration work.

**Known failures entering this wave** (per `TEST_CHECKLIST.md` and `docs/expansion/98_PROGRESS_LOG.md`):
1. **Readiness-score selector drift** — scheduling evaluation component changed; test selector no longer matches.
2. **"Drafting Summary" / "Upload to Storage" / "Import Complete!" text expectations** — CSV import flow UI copy changed; tests assert the old copy.
3. **Calendar subscription modal** — token-regenerate flow selector / dialog structure drift.
4. **Twins-RSVP** — team_communication scenarios with sibling players.
5. **Team real-time chat** — messaging scenarios.

Counts per cluster are estimates; Task 1 pre-flight snapshots exact failing-scenario list via `npm run test:e2e` + parsed output.

**Wave is**:
- Install `@axe-core/playwright` + build an `expectNoA11yViolations(page)` fixture.
- Apply the axe fixture to 10 high-traffic scenarios.
- Fix the 5 known failure clusters (readiness-score / import-text / calendar / twins-RSVP / chat).
- Extract shared E2E fixtures to `tests/e2e/fixtures/` where repetition justifies it (minimum-surface-area).
- Document any remaining exemptions in a waiver table at `docs/testing/e2e-waivers.md`.
- Closure: update audit index + progress log + `docs/testing/e2e_master_plan.md`.

**Wave is NOT**:
- Expanding scenario coverage beyond fixing existing scenarios + adding axe (scenario-matrix expansion is Wave 9).
- Visual regression / screenshot-diff infrastructure.
- Cross-browser (Chromium only per `playwright.config.ts`).
- Mobile viewport scenarios.
- Lighthouse runs (Wave 9).
- Changing `playwright.config.ts` structure (workers, retries, timeouts stay).
- Color-contrast / keyboard-navigation deep audits (they land on axe's baseline; follow-ups re-file).

---

## Pre-flight Verification

HALT on any false claim.

1. `git status` on `main` is clean.
2. `docs/audits/wave-1a/index.md` `### Wave 5-e2e` section readable.
3. Wave 3 infra present: `tests/factories/`, `tests/helpers/`, `tests/setup.js` polyfills, `docs/testing/test-helpers.md`.
4. `tests/helpers/seedMockDb.js` exports `seedMockDb` (used heavily in Task 1 fixture scaffolding).
5. `tests/e2e/features/` contains the expected `.feature` files — snapshot the list. At minimum:
   - `Pillar1_Engine.feature`, `Pillar2_CoachDailyLoop.feature`
   - `calendar_sync.feature`, `team_communication.feature`
   - `ingestion_hardening.feature`, `dashboard_workflow.feature`
   - `rbac_multi_tenancy.feature` (if adjusted for Wave 4 cold-start)
   - Plus Wave 4's `onboarding_cold_start.feature`.
6. `tests/e2e/steps/` contains the step files. Extractable duplicates confirmed during Task 1.
7. `playwright.config.ts` sets workers per the current config (CI runs `--workers=1`). Don't change the config.
8. Baselines captured on `main`:
   - `npm run test:e2e -- --workers=1 --reporter=list 2>&1 | tee /tmp/e2e-baseline.txt` — capture pass/fail count + failing scenario names.
   - `npm run lint` warning count.
   - `npm run test` case count + coverage.
   - `npm run frontend:build` bundle sizes.
9. No `@axe-core/*` package is present in `package.json` yet (confirm via `grep "@axe-core" package.json`).
10. `docs/testing/e2e_master_plan.md` exists; read it before Task 6 to understand the existing E2E documentation conventions.

If the failing-scenario list from Step 8 doesn't match the 5 clusters described above, the wave's task split may need adjustment — surface to the user before Task 2.

---

## Branch Conventions

- One branch per task, cut from `main`:
  - `claude/wave-5-axe-integration` → Task 1
  - `claude/wave-5-readiness-and-import-text` → Task 2
  - `claude/wave-5-calendar-modal` → Task 3
  - `claude/wave-5-twins-rsvp` → Task 4
  - `claude/wave-5-team-chat` → Task 5
  - `claude/wave-5-closure` → Task 6 (lands LAST — depends on 1–5)

- Task 1 is independent — can merge at any time relative to fix tasks.
- Tasks 2–5 are independent; can merge in any order.
- Task 6 lands last.

PR per task. CI green before each merge.

---

## Wave Scope

Six tasks: one axe integration, four scenario-cluster fixes, one closure. Every fix-task targets a named cluster of failing scenarios and produces a scenario-level delta the PR body documents.

**Guiding principle**: prefer test-side fixes (updating selectors / seeding / waits) over production-code fixes. Production changes allowed when:
- A selector is genuinely fragile (text-only on dynamic copy) — add `data-testid` on the production component.
- A race condition exists in the production code (not just in the test).
- An accessibility attribute is missing (per axe findings in Task 1).

Each production-side change is itemized in the PR body with justification.

---

## Task 1 — `@axe-core/playwright` Integration

**Commit**: `test(e2e): add @axe-core/playwright with expectNoA11yViolations fixture`

**Branch**: `claude/wave-5-axe-integration`

### Steps

1. Checkout `claude/wave-5-axe-integration` from latest `main`.

2. **Install `@axe-core/playwright`**:
   ```bash
   npm install --save-dev @axe-core/playwright
   ```
   This is a NEW dev dependency — counts against Wave 5's dep budget (1 addition). No other deps in this task.

3. **Create the fixture** at `tests/e2e/fixtures/a11y.ts`:
   ```ts
   import type { Page } from '@playwright/test';
   import AxeBuilder from '@axe-core/playwright';

   // Returns a summary of violations. Tests call it and assert .violations.length === 0.
   // Distinguish:
   //   - withTags(tags): rule-SETS like 'wcag2aa' / 'wcag21aa' / 'best-practice'
   //   - withRules(ids): specific rule IDs like 'color-contrast' / 'label'
   export async function expectNoA11yViolations(page: Page, options: {
     includeTags?: string[];      // optional: restrict to tagsets (e.g., ['wcag2aa'])
     includeRules?: string[];     // optional: restrict to specific rule IDs
     excludeSelectors?: string[]; // optional: ignore known-problematic selectors
   } = {}) {
     const builder = new AxeBuilder({ page });
     if (options.includeTags) builder.withTags(options.includeTags);
     if (options.includeRules) builder.withRules(options.includeRules);
     if (options.excludeSelectors) {
       for (const sel of options.excludeSelectors) builder.exclude(sel);
     }
     const results = await builder.analyze();
     return results;
   }
   ```
   Default configuration: `@axe-core` runs its full rule set. Consumers narrow by tagset (`includeTags: ['wcag2aa']`) OR by specific rules (`includeRules: ['color-contrast']`) — the two options are composable.

4. **Define the target scenarios** — apply `expectNoA11yViolations` at the final step of each of these 10 scenarios (edit `.feature` files to add an `And the page should have no accessibility violations` step):
   - Login flow (existing auth scenario).
   - Dashboard load (`dashboard_workflow.feature`).
   - Import wizard (`ingestion_hardening.feature` — one representative scenario).
   - Team roster view (`Pillar1_Engine.feature` team-formation scenario).
   - Game schedule grid (`Pillar2_CoachDailyLoop.feature` or `admin_overrides.feature`).
   - Practice schedule (`practice_schedule_locking.feature`).
   - Facility management (`facility_management.feature`).
   - Team communication (`team_communication.feature`).
   - Calendar sync (`calendar_sync.feature`).
   - Settings page (via `sidebar_context_switching.feature` or a new minimal scenario).
   - **Plus**: cold-start onboarding from Wave 4's `onboarding_cold_start.feature`.

   If any listed scenario is CURRENTLY failing (not passing baseline), skip the axe addition for that scenario until Tasks 2–5 stabilize it, then retroactively add the axe step. Document which scenarios deferred.

5. **Wire the step definition** — extend `tests/e2e/steps/common_steps.ts` (or similar) with a standard static import at the TOP of the file and a synchronous reference inside the step body:
   ```ts
   // Top of tests/e2e/steps/common_steps.ts (with the other imports)
   import { expectNoA11yViolations } from '../fixtures/a11y';

   // Step body (wherever step defs live)
   Then('the page should have no accessibility violations', async function () {
     const { page } = this;
     const results = await expectNoA11yViolations(page);
     if (results.violations.length > 0) {
       console.log('Axe violations:', JSON.stringify(results.violations, null, 2));
     }
     expect(results.violations).toEqual([]);
   });
   ```
   Do NOT use `await import('../fixtures/a11y')` inside the step body — static imports match the rest of the step-def file and avoid per-step module-resolution overhead.

6. **Regenerate** `.features-gen-local/` via `bddgen`. Run the 10 axe-enriched scenarios locally: `npm run test:e2e -- --workers=1`.

7. **Triage baseline violations**:
   - Scenarios whose axe assertion passes: commit as-is.
   - Scenarios whose axe assertion fails with violations: for EACH violation decide:
     - **Easy inline fix** (missing `aria-label`, `type="button"` → add to production code in Task 1; trivial bar similar to Wave 1b).
     - **Non-trivial fix** (color contrast, layout surgery, focus-trap refactor) → keep the axe step but configure `excludeSelectors` to skip the failing selector + file a finding in `docs/testing/e2e-waivers.md` pointing at a future wave or backlog.
   - Target: all 10 scenarios ship with an axe assertion, either passing outright or passing with documented `excludeSelectors`.

8. **Dev dep budget**: only `@axe-core/playwright` in this task. Do NOT bundle other deps.

9. **Free-tier posture**: axe-core runs in-browser during Playwright; CI cost addition is ~1–2 s per scenario × 10 = ~20 s/run. Acceptable.

10. Verification gate:
    ```bash
    npm run lint
    npm run typecheck
    npm run test                          # unchanged from baseline
    npm run frontend:build                # unchanged
    npm run test:e2e -- --workers=1       # all 10 axe-enriched scenarios pass (with exclusions if needed)
    git status
    ```

11. Commit, push, open PR. PR body includes: violation counts before/after per scenario, any `excludeSelectors` configurations, any production-side a11y fixes applied.

### Tests to add (Task 1)

- `tests/e2e/fixtures/a11y.ts` (new).
- Step definition in `tests/e2e/steps/common_steps.ts` (or similar).
- `.feature` file additions: one `Then` step per of the 10–11 target scenarios.
- Any trivial a11y fix to production code (each fix ≤ 3 files, ≤ 15 min per Wave 1b's trivial bar).

### Out of scope (Task 1)

- Fixing non-trivial a11y issues (deferred via waivers).
- Adding axe assertions to scenarios beyond the 10–11 listed.
- Configuring axe for non-default rule sets outside the 10 target scenarios.
- Refactoring the step-def structure.
- Adding visual-regression baselines.

---

## Task 2 — Readiness-Score + Import-Text Fixes

**Commit**: `fix(e2e): stabilize readiness-score + import text expectations`

**Branch**: `claude/wave-5-readiness-and-import-text`

### Steps

1. Checkout `claude/wave-5-readiness-and-import-text` from latest `main`.

2. **Enumerate target scenarios** — from the Task 1 baseline snapshot, filter failing scenarios matching:
   - readiness-score / fairness selectors
   - "Drafting Summary" / "Upload to Storage" / "Import Complete!" text
   - related ingestion hardening scenarios

   Estimate: 8–12 scenarios across `Pillar1_Engine.feature`, `ingestion_hardening.feature`, `dashboard_workflow.feature`.

3. **Per-scenario diagnosis loop** (repeat for each failing scenario):
   a. Run `npm run test:e2e -- --workers=1 --grep "<scenario name>" --reporter=list` to capture the actual failure.
   b. Read the failing locator / assertion in the step definition.
   c. Compare with current DOM (run `npm run frontend:dev` in one tab, open DevTools on the scenario's page, inspect).
   d. Choose a fix path:
      - **Text drift** — update the expected text in the step def to match current copy. PREFERRED if the copy is intentional and stable.
      - **Selector brittleness** — if the production component uses a text-only selector and text is likely to drift again, add `data-testid` to the production component AND update the step def. Document the production change in PR body.
      - **Race condition** — add an `await page.waitForSelector(...)` or `await expect(locator).toBeVisible()` before the interaction. Follows the existing pattern from `claude.md` §8 E2E rules.
      - **Missing org_id seeding** — confirm the test seeds `__MOCK_DB__` entries with a valid `organization_id` matching `localStorage.squadlogic_active_org`. Per `claude.md` §8, this is the most common fix.

4. **Use Wave 3 fixtures where possible** — `tests/helpers/seedMockDb.js` for seeding; `tests/factories/` for row data shapes. If a fix touches a step file that pre-dates the fixtures, migrate the seeding in that file (but ONLY the affected scenario's seeding — don't refactor the whole step file).

5. **Production-side changes allowed when justified**:
   - Adding `data-testid` — yes.
   - Adding `aria-label` for a disambiguated selector — yes (cross-wave benefit with Task 1 axe).
   - Refactoring a component's render structure — NO (out of scope; re-file to a later wave).
   - Changing copy — NO (tests follow product, not the other way around).

6. **Per-scenario verification**:
   ```bash
   npm run test:e2e -- --workers=1 --grep "<scenario name>"
   ```
   Scenario passes. Do NOT continue to the next scenario until the current one is green.

7. **Full-suite verification** after all scenarios in this task's scope are green:
   ```bash
   npm run lint
   npm run typecheck
   npm run test                     # unchanged
   npm run frontend:build           # bundle delta documented if any data-testid added
   npm run test:e2e -- --workers=1  # target-cluster scenarios pass; other-cluster failures unchanged
   git status
   ```

8. Commit, push, open PR. PR body: scenario-level before/after table.

### Tests to add (Task 2)

- None — this task FIXES existing tests. No new scenarios.

### Out of scope (Task 2)

- Fixing calendar / twins-RSVP / team-chat scenarios (Tasks 3, 4, 5 own).
- Adding axe assertions (Task 1 already integrated).
- Adding new E2E scenarios.
- Refactoring step-file structure.
- Copy changes to production UI.

---

## Task 3 — Calendar Subscription Modal

**Commit**: `fix(e2e): stabilize calendar subscription modal scenarios`

**Branch**: `claude/wave-5-calendar-modal`

### Steps

1. Checkout `claude/wave-5-calendar-modal` from latest `main`.

2. **Scope**: scenarios in `tests/e2e/features/calendar_sync.feature` that currently fail — typically 3–5 scenarios around the subscription URL modal, token regeneration, and ICS download.

3. **Apply the per-scenario diagnosis loop** from Task 2 Step 3:
   - Modal structure drift — dialog locators may need `role="dialog"` or `aria-labelledby` anchors.
   - Token-rotation seeding — ensure `calendar_subscriptions` rows exist in `__MOCK_DB__` with valid `expires_at` (90-day default per Wave 2 Task 2 post-deploy verification).
   - Copy drift on the "Regenerate Link" button or confirmation toast — match current product copy.

4. **Check for `rotate_calendar_token` RPC** — Wave 2 updated this RPC; verify the mock client implements it (grep `mockSupabaseClient.js`). If the mock doesn't handle `rotate_calendar_token`, add a minimal implementation mirroring the real function's return shape. This is a mock-client surgery similar to Wave 4 Task 2's approach — scope it tightly.

5. **Production-side changes**: same rules as Task 2 — `data-testid` OK, structural refactor NOT OK.

6. Verification gate (same commands as Task 2 Step 7; grep on calendar scenarios).

7. Commit, push, open PR.

### Tests to add (Task 3)

- If `rotate_calendar_token` mock is added: a unit test at `tests/mockRotateCalendarToken.test.js` (≥ 3 cases: success, already-expired, non-existent team).

### Out of scope (Task 3)

- Fixing other failure clusters.
- Refactoring the calendar-feed Edge Function.
- Adding new calendar scenarios beyond fixing existing ones.

---

## Task 4 — Twins-RSVP Fix

**Commit**: `fix(e2e): stabilize twins-RSVP scenarios`

**Branch**: `claude/wave-5-twins-rsvp`

### Steps

1. Checkout `claude/wave-5-twins-rsvp` from latest `main`.

2. **Scope**: scenarios involving sibling / twin players (typically in `team_communication.feature` or `Pillar2_CoachDailyLoop.feature`). Estimate: 2–4 scenarios.

3. **Likely failure modes**:
   - Sibling-detection logic relies on shared `family_group_id` or similar; mock DB may seed siblings without it.
   - RSVP for one twin doesn't propagate or auto-resolve for the other.
   - UI displays both twins separately when the product expects a single RSVP affects both.

4. **Apply the diagnosis loop**. Extend `tests/factories/player.js` ONLY if a new field is needed (e.g., `makePlayer({ family_group_id: 'family-1' })` if that shape was missing — check against the schema first).

5. **Production-side changes**: likely minimal if any. If sibling-propagation logic is missing from the mock client, add a minimal implementation.

6. Verification gate.

7. Commit, push, open PR.

### Tests to add (Task 4)

- None unless a mock-client addition requires one (same pattern as Task 3 Step 4).

### Out of scope (Task 4)

- Building twins / sibling-relation UI improvements.
- Refactoring RSVP state management.
- Other failure clusters.

---

## Task 5 — Team Real-Time Chat Fix

**Commit**: `fix(e2e): stabilize team real-time chat scenarios`

**Branch**: `claude/wave-5-team-chat`

### Steps

1. Checkout `claude/wave-5-team-chat` from latest `main`.

2. **Scope**: scenarios in `team_communication.feature` that exercise real-time message delivery. Estimate: 2–4 scenarios.

3. **Likely failure modes**:
   - Realtime channel (`supabase.channel('team_chat')` or similar) not mocked; messages don't appear without a real Supabase backend.
   - Mock DB doesn't implement cross-session message broadcast (sessionStorage doesn't cross tabs).
   - Test polls for message text but timing is off — flaky.

4. **Strategy**: since `sessionStorage` doesn't cross tabs, true realtime testing requires either:
   - Single-tab test only (one browser context, same session) — acceptable for most scenarios.
   - A `localStorage`-based broadcast channel in the mock client — more work; defer if not critical.

   Prefer the single-tab approach. Rewrite cross-tab scenarios to single-tab or document as waivers.

5. **Mock surgery — reuse the existing realtime scaffolding**: `frontend/src/lib/mockSupabaseClient.js` ALREADY has (a) a `channel(name)` implementation around line 1168 with `.on(...)` / `.subscribe()` / `.send()` semantics AND (b) a `triggerRealtimeEvent(table, event, payload)` helper around line 456 that fans out to subscribed channel listeners. Existing code paths (e.g., the `upsert` and parts of `insert` for `field_subunits`) already call `triggerRealtimeEvent` after mutating `__MOCK_DB__`. The chat failure is almost certainly NOT a missing channel mock — it's that the chat-message insert path doesn't fire `triggerRealtimeEvent('team_chat_messages', 'INSERT', { new: row })`. Surgery:
   - Grep the mock's `insert` branch for the table name the chat component writes to (`team_chat_messages` or similar — confirm via the chat component's source).
   - Ensure that branch pushes an event into `eventsToFire` alongside existing inserts, matching the pattern at lines ~1033 where `eventsToFire.forEach((e) => triggerRealtimeEvent(e.table, e.event, e.payload))`.
   - Do NOT add a new channel implementation — the existing one covers `.on('postgres_changes', { table }, cb)` subscriptions that the chat component uses.
   - If the real product subscribes via `.on('broadcast', { event: 'new-message' }, cb)` rather than `postgres_changes`, the mock's `triggerRealtimeEvent` pathway may not match; in that case, extend the pattern minimally (one helper, no new channel shape) rather than forking the channel implementation.

6. Verification gate.

7. Commit, push, open PR.

### Tests to add (Task 5)

- Unit tests for the chat-insert realtime wiring at `tests/mockChatRealtime.test.js` (≥ 4 cases): subscribe to `team_chat_messages` via `channel(...).on('postgres_changes', ...)`; insert a message row → subscribed listener receives the `INSERT` payload; unsubscribe → subsequent inserts do NOT reach the listener; multiple subscribers → all receive the event. Tests target the existing `channel` + `triggerRealtimeEvent` helpers in `mockSupabaseClient.js` — they do NOT construct a new channel abstraction.

### Out of scope (Task 5)

- True cross-tab realtime testing (defer — document as waiver).
- Refactoring team-chat production code.
- Other failure clusters.

---

## Task 6 — Closure

**Commit**: `docs(wave-5): closure — e2e stabilization shipped`

**Branch**: `claude/wave-5-closure`

**Depends on**: Tasks 1–5 merged.

### Steps

1. Checkout `claude/wave-5-closure` from latest `main` AFTER Tasks 1–5 merge.

2. **Run full E2E suite** to confirm the final passing count:
   ```bash
   npm run test:e2e -- --workers=1 --reporter=list 2>&1 | tee /tmp/e2e-final.txt
   ```
   Count passes/fails.

3. **Create `docs/testing/e2e-waivers.md`** (new — only if any scenarios remain failing OR any axe violations were excluded):
   ```markdown
   # E2E Waivers (as of Wave 5 close)

   Scenarios or axe rules that remain exempt from the Wave 5 stabilization
   target, with their rationale and target wave.

   ## Scenario waivers

   | Scenario | File | Failure mode | Reason deferred | Target wave/backlog |
   | --- | --- | --- | --- | --- |
   | ... | ... | ... | ... | ... |

   ## Axe rule exclusions

   | Scenario | Rule id | Selector excluded | Reason | Target wave/backlog |
   | --- | --- | --- | --- | --- |
   | ... | ... | ... | ... | ... |
   ```

   If everything is green and no waivers needed, create the file with a one-line body: "No waivers — all scenarios green as of Wave 5 close."

4. **Update `docs/testing/e2e_master_plan.md`**:
   - Add a section summarizing axe integration (which scenarios, the `expectNoA11yViolations` step, fixture location).
   - Update the scenario-count if it drifted from 63 (should be baseline; Wave 4 may have added 2–3).
   - Add a pointer to `e2e-waivers.md`.

5. **Update `docs/audits/wave-1a/index.md`**:
   - For each `Wave 5-e2e` finding: prepend `✅` and set `Proposed wave` to `5 (shipped)` OR move to `Proposed wave: waived` with a pointer to the waiver entry.
   - Append a `## Wave 5 closure` section summarizing: scenarios fixed per cluster, axe-integration results, waiver count.

6. **Append to `docs/expansion/98_PROGRESS_LOG.md`**:
   ```
   ## 2026-MM-DD — Wave 5 E2E stabilization + axe-core

   Six PRs shipped:
   - Task 1: @axe-core/playwright integration (fixture + 10-11 scenarios).
   - Task 2: readiness-score + import-text fixes (N scenarios).
   - Task 3: calendar subscription modal (N scenarios).
   - Task 4: twins-RSVP (N scenarios).
   - Task 5: team real-time chat (N scenarios).
   - Task 6: closure.

   E2E pass-count: baseline 40-43 → final X/Y (+Z new passes, W waived).
   Axe integration: 10-11 scenarios gated; V violations excluded with
   documented waivers.
   New dev dep: @axe-core/playwright.
   ```

7. Verification:
   ```bash
   npm run lint
   npm run typecheck
   npm run test
   npm run frontend:build
   npm run test:e2e -- --workers=1      # final count matches expectations
   npm run format -- docs/testing/e2e-waivers.md docs/testing/e2e_master_plan.md docs/audits/wave-1a/index.md docs/expansion/98_PROGRESS_LOG.md
   git status
   ```

8. Commit, push, open PR.

### Tests to add (Task 6)

- None.

### Out of scope (Task 6)

- Fixing any remaining failing scenario (they go to waivers OR the next wave).
- Expanding axe coverage beyond what Task 1 shipped.
- Editing any `.claude/wave-*-prompt.md` file.
- Archiving existing testing docs.

---

## Documentation Currency Pass

Handled by Task 6:
1. `docs/testing/e2e-waivers.md` (new — empty body OK if no waivers).
2. `docs/testing/e2e_master_plan.md` — axe integration + scenario count + waiver pointer.
3. `docs/audits/wave-1a/index.md` — Wave-5 findings marked shipped / waived.
4. `docs/expansion/98_PROGRESS_LOG.md` — dated entry.

Do NOT touch: `claude.md`, `docs/architecture/**`, `docs/security/**`, `docs/operations/**`, any `.claude/wave-*.md`.

---

## Wave Review (Mandatory Before Final Merge)

Any "no" blocks push.

1. All 6 tasks merged with CI green.
2. `@axe-core/playwright` is in `package.json` devDependencies; lockfile updated.
3. `tests/e2e/fixtures/a11y.ts` exists and exports `expectNoA11yViolations`.
4. 10–11 scenarios invoke `Then the page should have no accessibility violations`.
5. `npm run test:e2e -- --workers=1` on `main` post-closure:
   - Passing count = **baseline + all Task-2–5 fixes - any waived scenarios**.
   - Target: 63/63 (or 66/66 after Wave 4 additions) when waivers are zero.
   - Each waived scenario has an entry in `docs/testing/e2e-waivers.md`.
6. `npm run lint` on `main`: warning count ≤ baseline.
7. `npm run typecheck` on `main`: 0 errors.
8. `npm run test` on `main`: 100 % pass; case count = baseline + any mock-client tests added (Task 3 rotate-token, Task 5 realtime-channel).
9. `npm run frontend:build` on `main`: bundle sizes unchanged or documented (production-side `data-testid` adds are rounding-error).
10. No change to `playwright.config.ts`, `vitest.config.js`, `vite.config.js`, `eslint.config.js`, `tsconfig.json`, `.prettierrc`.
11. `docs/testing/e2e-waivers.md` exists (even if empty).
12. `docs/testing/e2e_master_plan.md` documents axe integration.
13. **Test-impact reconciled**: the only case-count increases are the mock-client tests in Tasks 3 + 5. No unit tests added "incidentally" during E2E fixes.
14. No new dev dep beyond `@axe-core/playwright`.
15. **Free-tier posture preserved**: no new Edge Function invocations, no new scheduled jobs, no new realtime channels in production (mock-channel is tests-only).

---

## Commit & Push to Main

1. Task 1 can merge any time.
2. Tasks 2–5 in any order.
3. Task 6 lands LAST.
4. Each PR: CI green → merge → next.
5. On regression: revert PR within 30 min.

---

## Verification Gate (Per Task, Before Push)

For Tasks 1, 2, 3, 4, 5:
```bash
npm run lint
npm run typecheck
npm run test                     # unchanged unless mock surgery added tests
npm run frontend:build           # unchanged or rounding-error delta
npm run test:e2e -- --workers=1 --grep "<scope>"   # target scenarios pass
git status
```

For Task 6:
```bash
npm run lint && npm run typecheck && npm run test && npm run frontend:build
npm run test:e2e -- --workers=1                                # full suite
npm run format -- docs/testing/e2e-waivers.md docs/testing/e2e_master_plan.md docs/audits/wave-1a/index.md docs/expansion/98_PROGRESS_LOG.md
```

Each `FAIL → HALT`.

---

## Key References

- `claude.md` — §8 Testing (E2E rules, especially the `organization_id` seeding rule).
- `docs/audits/wave-1a/index.md` — Wave-5-e2e findings section.
- `docs/audits/wave-1a/accessibility.md` — a11y findings feed Task 1's axe triage.
- `docs/testing/test-helpers.md` — `seedMockDb`, `createChainMock`, factories.
- `docs/testing/e2e_master_plan.md` — E2E architecture (updated by Task 6).
- `TEST_CHECKLIST.md:112` — the "23 pre-existing failures" note.
- `tests/e2e/features/` — feature files inventory.
- `tests/e2e/steps/` — step-def inventory.
- `frontend/src/lib/mockSupabaseClient.js` — mock client (touched by Tasks 3, 5 if needed).
- `playwright.config.ts` — don't change.

---

## Critical Files

**Will create**:
- `tests/e2e/fixtures/a11y.ts` (Task 1)
- `docs/testing/e2e-waivers.md` (Task 6 — possibly empty body)
- `tests/mockRotateCalendarToken.test.js` (Task 3 — only if mock surgery required)
- `tests/mockChatRealtime.test.js` (Task 5 — only if chat-insert wiring surgery required)

**Will edit**:
- `package.json`, `package-lock.json` (Task 1 — axe-core dep)
- `tests/e2e/features/*.feature` (Tasks 1–5 as needed)
- `tests/e2e/steps/common_steps.ts` (Task 1 — axe step def)
- `tests/e2e/steps/*.ts` (Tasks 2–5 as needed)
- `tests/factories/*.js` (Tasks 2–5 — ONLY new fields to match schema, never new factories)
- `frontend/src/lib/mockSupabaseClient.js` (Tasks 3, 5 — minimal RPC/channel surgery)
- `frontend/src/**/*.jsx` (Tasks 1–5 — `data-testid` and `aria-label` adds only; no structural refactors)
- `docs/testing/e2e_master_plan.md` (Task 6)
- `docs/audits/wave-1a/index.md` (Task 6)
- `docs/expansion/98_PROGRESS_LOG.md` (Task 6)

**Will NOT edit**:
- `claude.md`, any `.claude/wave-*.md`.
- `supabase/migrations/**` (no schema changes in this wave).
- `supabase/functions/**` (no Edge Function changes).
- `playwright.config.ts`, `vitest.config.js`, `vite.config.js`, `eslint.config.js`, `tsconfig.json`, `.prettierrc`.
- `tests/factories/index.js`, `tests/helpers/**`, `tests/setup.js` (Wave 3 froze these).
- Copy / content in production UI (tests follow product).
- `docs/architecture/**`, `docs/security/**`, `docs/operations/**`.
- `docs/audits/wave-1a/*.md` sub-reports (frozen).

---

## Out of Scope This Wave

- Adding new E2E scenarios beyond Wave 4's additions (Wave 9 handles scenario-matrix expansion).
- Visual regression / screenshot-diff infrastructure.
- Cross-browser (Chromium only).
- Mobile viewport scenarios.
- Lighthouse runs (Wave 9).
- Changing `playwright.config.ts`.
- Color-contrast or keyboard-navigation deep audits (follow-ups from axe baseline).
- Refactoring existing step-file structure.
- Copy changes to production UI.
- Rewriting production components to fix "test fragility" beyond `data-testid` / `aria-label` adds.
- Coverage-threshold changes (Wave 9).
- pgTAP / DB-layer tests (Wave 7).
- Doc gap closure beyond `e2e_master_plan.md` (Wave 8).

---

## Ground Rules

- **Diagnosis loop discipline**. Each failing scenario: reproduce → root-cause → smallest-fix → verify. No speculative refactoring.
- **Test follows product**. If product copy changed intentionally, tests update to match. Never change product copy to make tests green.
- **Production changes allowed but itemized**. Each `data-testid` / `aria-label` addition appears in the PR body with justification.
- **Minimum mock surgery**. Tasks 3 + 5 may touch `mockSupabaseClient.js` for RPC / channel shims — keep scope tight; tests + shim, nothing else.
- **Free-tier preserved**. No new Edge Function, no new scheduled job, no new realtime subscription in production code.
- **One dep, one task**. `@axe-core/playwright` lands in Task 1 only. No other dep additions.
- **Waivers are honest**. A waived scenario is tracked in `e2e-waivers.md` with a concrete future-wave target. No indefinite waivers.
- **Wave 3 infra is the way**. Use `seedMockDb` + factories + `createChainMock` throughout. Don't hand-roll new mocks.
- **No `--no-verify`, no `--force-push`, no direct commits to `main`**.
- **5-attempt debugging cap** per failing scenario. If stuck, move that scenario to the waiver table and continue.
