# SquadLogic — Test Checklist

**Before running:** Ensure all commits have been pushed to `main`, dependencies are installed (`npm install`), and `.env.test` has been created from `.env.test.example`.

---

## Prerequisites

```bash
npm install
cp .env.test.example .env.test   # fill in real test credentials
```

---

## Step 1 — Lint & Typecheck

Run these first. Failing lint or type errors indicate something to fix before tests.

```bash
npm run lint
npm run typecheck
```

---

## Step 2 — Unit & Integration Tests (Vitest)

Single command to run all 46 unit/integration test files:

```bash
npm run test
```

For coverage report:

```bash
npm run test:coverage
```

### Full file list

| #   | File                                         | What it covers                                                               |
| --- | -------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | `tests/calendarFeed.test.js`                 | Calendar feed Edge Function — token validation, ICS generation, expiry check |
| 2   | `tests/configurePersistenceEndpoint.test.js` | Persistence endpoint configuration and URL resolution                        |
| 3   | `tests/evaluationPipeline.test.js`           | Scheduler evaluation pipeline — run creation, findings, metrics              |
| 4   | `tests/gameMetrics.test.js`                  | Game scheduling metrics and balance scoring                                  |
| 5   | `tests/gamePersistenceApi.test.js`           | Game persistence API — HTTP layer contracts                                  |
| 6   | `tests/gamePersistenceHandler.test.js`       | Game persistence handler — internal logic                                    |
| 7   | `tests/gameScheduling.test.js`               | Game scheduling algorithm — slot assignment, conflict detection              |
| 8   | `tests/gameSupabase.test.js`                 | Game Supabase integration — DB queries and upserts                           |
| 9   | `tests/logger.test.js`                       | Logger utility — dev/prod gating                                             |
| 10  | `tests/normalization.test.js`                | Data normalization — CSV field mapping, name parsing                         |
| 11  | `tests/outputGeneration.test.js`             | Output generation — PDF/CSV export formatting                                |
| 12  | `tests/performance.test.js`                  | Performance benchmarks — scheduling speed under load                         |
| 13  | `tests/persistenceHandler.test.js`           | Generic persistence handler base logic                                       |
| 14  | `tests/practiceMetrics.test.js`              | Practice scheduling metrics                                                  |
| 15  | `tests/practicePersistenceApi.test.js`       | Practice persistence API — HTTP layer contracts                              |
| 16  | `tests/practicePersistenceHandler.test.js`   | Practice persistence handler — internal logic                                |
| 17  | `tests/practiceScheduling.test.js`           | Practice scheduling algorithm — slot expansion, day-of-week logic            |
| 18  | `tests/practiceSchedulingTimezone.test.js`   | Practice scheduling with timezone edge cases                                 |
| 19  | `tests/practiceSlotExpansion.test.js`        | Practice slot date range expansion                                           |
| 20  | `tests/practiceSupabase.test.js`             | Practice Supabase integration                                                |
| 21  | `tests/rosterSizing.test.js`                 | Roster sizing rules — min/max player constraints                             |
| 22  | `tests/teamDiagnostics.test.js`              | Team diagnostics — imbalance detection, error reporting                      |
| 23  | `tests/teamGeneration.test.js`               | Team generation algorithm — player assignment logic                          |
| 24  | `tests/teamGenerationSeed.test.js`           | Team generation determinism with fixed seed                                  |
| 25  | `tests/teamPersistenceApi.test.js`           | Team persistence API — HTTP layer contracts                                  |
| 26  | `tests/teamPersistenceClient.test.js`        | Team persistence client — SDK wrapper                                        |
| 27  | `tests/teamPersistenceEdgeConfig.test.js`    | Edge Function role config parsing                                            |
| 28  | `tests/teamPersistenceEdgeHandler.test.js`   | Team persistence Edge Function handler                                       |
| 29  | `tests/teamPersistenceHandler.test.js`       | Team persistence handler — internal logic                                    |
| 30  | `tests/teamPersistencePanel.test.js`         | TeamPersistencePanel React component                                         |
| 31  | `tests/teamPersistenceSnapshot.test.js`      | Persistence snapshot diffing and comparison                                  |
| 32  | `tests/teamSupabase.test.js`                 | Team Supabase integration                                                    |
| 33  | `tests/useDashboardData.test.js`             | useDashboardData hook — data fetching and aggregation                        |
| 34  | `tests/usePermission.test.js`                | usePermission hook — role-based permission checks                            |
| 35  | `tests/usePracticeAssignments.test.js`       | usePracticeAssignments hook                                                  |
| 36  | `tests/useTeamAnalysis.test.js`              | useTeamAnalysis hook — balance scoring                                       |
| 37  | `tests/verifyRpcUsage.test.js`               | Verifies RPC calls use correct patterns (no direct table access)             |

### Security-critical tests to verify specifically

These tests directly validate Phase 1–4 security work. If any fail, investigate before deploying:

```bash
npx vitest run tests/calendarFeed.test.js      # Token expiry (H-2)
npx vitest run tests/usePermission.test.js     # RBAC (H-3)
npx vitest run tests/verifyRpcUsage.test.js    # RPC org-scope enforcement (M-5)
npx vitest run tests/normalization.test.js     # Header alias mapping (L-3)
npx vitest run tests/logger.test.js            # Dev-only logging (L-1)
```

---

## Step 3 — E2E Tests (Playwright + BDD)

Requires a running dev server (started automatically by Playwright config).

```bash
npm run test:e2e
```

Interactive UI mode (useful for debugging failures):

```bash
npm run test:e2e:ui
```

> [!TIP]
> **Remediation Status**: As of March 2026, the E2E suite is stabilized (57/57 passing). To maintain this, ensure all mock data injections include a valid `organization_id` matching the org in `localStorage`, or React hooks will filter the data into an empty state.

### Feature files (BDD scenarios)

| #   | Feature file                          | What it covers                                                          |
| --- | ------------------------------------- | ----------------------------------------------------------------------- |
| 1   | `Pillar1_Engine.feature`              | Core scheduling engine — end-to-end team formation and game generation  |
| 2   | `Pillar2_CoachDailyLoop.feature`      | Coach daily workflow — view schedule, RSVP, team portal                 |
| 3   | `admin_overrides.feature`             | Admin drag-and-drop overrides on generated schedules                    |
| 4   | `async_and_optimistic_ui.feature`     | Optimistic UI updates and async operation handling                      |
| 5   | `calendar_sync.feature`               | Calendar subscription URL, ICS download, token regeneration             |
| 6   | `dashboard_workflow.feature`          | Dashboard data display and workflow progression                         |
| 7   | `facility_management.feature`         | Field and location CRUD operations                                      |
| 8   | `field_management_efficiency.feature` | Bulk field operations and validation                                    |
| 9   | `ingestion_hardening.feature`         | CSV import validation — strict headers, size limits, sanitization       |
| 10  | `network_resilience.feature`          | Offline behaviour, retry logic, error recovery                          |
| 11  | `output_operationalization.feature`   | Export generation — PDF, CSV, email triggers                            |
| 12  | `practice_schedule_locking.feature`   | Practice schedule locking after publication                             |
| 13  | `rbac_multi_tenancy.feature`          | Role-based access — admin vs coach vs parent views, cross-org isolation |
| 14  | `registration_compliance.feature`     | Registration form flow and waiver tracking                              |
| 15  | `reporting.feature`                   | Admin reporting dashboard — metrics and charts                          |
| 16  | `roster_conflict_detection.feature`   | Duplicate player detection and conflict warnings                        |
| 17  | `sidebar_context_switching.feature`   | Org/season switcher in sidebar                                          |
| 18  | `team_communication.feature`          | Team messaging and RSVP submission                                      |
| 19  | `visual_micro_interactions.feature`   | Animations, hover states, loading indicators                            |
| 20  | `visual_rbac_enforcement.feature`     | UI elements hidden/shown based on role                                  |

### Security-critical E2E scenarios to verify specifically

```bash
npx playwright test --grep "cross.org\|unauthorized\|RBAC\|rbac\|calendar token\|import.*validation"
```

### E2E Stabilization & Debugging

- **Mock Scoping**: All `page.evaluate` mock injections **must** include an `organization_id` matching the active org in `localStorage`.
- **Concurrency**: For maximum stability of shared `sessionStorage` mocks, run the full suite with `--workers=1`.
- **Debugging**: If tests fail to find data, check the `__MOCK_DB__` key in `sessionStorage` via Browser DevTools.
- **All scenarios active**: As of April 2026, no scenarios are `@skipped`. The Game Schedule Grid has been fully implemented.

---

## Step 4 — Build Verification

Confirms the production bundle compiles cleanly with no type or module errors:

```bash
npm run frontend:build
```

---

## Step 5 — Post-Deploy (manual, once live)

After pushing to Vercel and applying Supabase migrations:

1. **CSP violations** — Open browser DevTools → Console. Verify zero `Content-Security-Policy-Report-Only` violations during normal app use. When clean for a sprint, change `Content-Security-Policy-Report-Only` → `Content-Security-Policy` in `vercel.json`.

2. **Supabase migrations** — All 34 migrations have been applied to the production database. For the complete migration history and deployment verification steps, see `docs/expansion/PRODUCTION_CUTOVER_RUNBOOK.md`.

3. **Audit log smoke test** — As an admin user, perform one team save and one CSV import. Then run in Supabase SQL editor:

   ```sql
   SELECT action, resource_type, created_at
   FROM audit_log
   ORDER BY created_at DESC
   LIMIT 5;
   ```

   Expect to see `team.saved` and `import.started` rows.

4. **RLS cross-org smoke test** — With two separate org admin accounts, verify that querying `game_slots`, `practice_assignments`, and `team_players` from org A returns zero rows from org B.

5. **Calendar token expiry** — Verify the "Regenerate Link" button in Team Portal calls `rotate_calendar_token` RPC and returns a new token with `expires_at` ~90 days out.

---

## Quick Reference — All Commands

```bash
# Full check sequence (run in order)
npm install
npm run lint
npm run typecheck
npm run test
npm run test:coverage
npm run test:e2e
npm run frontend:build
```
