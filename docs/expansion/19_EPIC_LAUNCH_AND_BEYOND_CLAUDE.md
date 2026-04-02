# Epic 19: Launch & Beyond — From 57 Green Tests to v1.0 Production

> [!NOTE]
> **STATUS: ALL PHASES COMPLETE** — Phase 1 (CI/CD), Phase 2 (Game Scheduler), and Phase 3 (Live Backend) have all been implemented. This document is retained as the detailed execution record.

**Date:** March 30, 2026
**Baseline:** 57/57 E2E tests passing (Playwright-BDD), full Vitest unit suite green
**Author:** Joel + Claude (Planning Session)

---

## Execution Order: B → A → C

**CI/CD first → Feature Work second → Live Backend last.**

Path B (CI/CD) is the safety net. Every line of code written in Paths A and C will be protected by automated regression on every push. Path A (Game Scheduler) comes next because building on the mock client is fast — instant iteration, no network latency or migration debugging. Path C (Live Backend) is last because it's inherently the riskiest (real data, real auth, real RLS enforcement) and benefits from having both the safety net and the complete feature set already in place.

---

## Phase 1: CI/CD & Production Deployment ✅

*Goal: Every PR is automatically validated. The `main` branch is always deployable.*

### Task 1.0 — Fix Cross-Platform Dependency (Immediate Blocker)
**Model: Haiku 4.5**

Remove `@rollup/rollup-win32-x64-msvc` from `package.json` dependencies. This Windows-specific binary was explicitly pinned and prevents `npm install` from succeeding on the Ubuntu CI runner. Vite/Rollup resolve their own platform-specific binaries via optional dependencies automatically — no manual pinning needed. Regenerate `package-lock.json` after removal.

### Task 1.1 — GitHub Actions: Unified CI Workflow
**Model: Sonnet 4.6**

Create `.github/workflows/ci.yml` that runs on every push to `main` and every PR:

**Job 1 — Unit Tests:**
- Checkout repo, set up Node 20, `npm ci`
- Run `npm run test` (Vitest)
- Upload coverage report as artifact

**Job 2 — E2E Tests:**
- Checkout repo, set up Node 20, `npm ci`
- Install Playwright browsers: `npx playwright install --with-deps chromium`
- Run `npx bddgen && npx playwright test --workers=1 --reporter=list`
- Upload Playwright HTML report + trace files as artifacts on failure
- The `webServer` block in `playwright.config.ts` auto-starts Vite with `VITE_USE_MOCK_SUPABASE=true` — no real Supabase credentials needed in CI

**Why a single workflow file with two jobs:** Simpler to maintain than two separate files. Jobs run in parallel by default, so there's no speed penalty. A single required check ("CI") is easier to configure for branch protection than two separate checks.

**Why Sonnet for Job 1, but review carefully for Job 2:** The E2E job has subtle ordering requirements — `bddgen` codegen must precede Playwright, `--workers=1` is mandatory for mock sessionStorage isolation, and the Vite dev server needs a startup health check. Worth a careful review of the generated YAML.

### Task 1.2 — Branch Protection Rules
**Model: Haiku 4.5**

Configure GitHub branch protection on `main`:
- Require the CI workflow check to pass before merge
- Require at least 1 approval (or self-approval for solo dev)
- No direct pushes to `main`

### Task 1.3 — Vercel Production Deployment
**Model: Sonnet 4.6**

Connect the repo to Vercel (the existing `vercel.json` already has security headers):
- Build command: `npm run frontend:build`
- Output directory: Vite's `dist/`
- Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (placeholders for now — the app gracefully falls back to mock mode when missing)
- Enable Preview Deployments on PRs for visual QA

**Deliverable:** PR merges to `main` → Vercel auto-deploys. Preview URLs on every PR.

### Task 1.4 — Smoke Test & Verification
**Model: Sonnet 4.6**

- Push a trivial change on a feature branch
- Verify the GitHub Actions workflow runs and passes
- Verify Vercel preview deployment is accessible
- Merge to `main`, verify production deployment
- Document the CI/CD setup in `docs/ci-cd.md`

---

## Phase 2: Interactive Game Scheduler ✅

*Goal: Unskip the final E2E test and build the drag-and-drop Game Scheduling grid.*

### Task 2.1 — Design the Component Architecture
**Model: Opus 4.6**

Study the existing patterns before writing code:
- `RosterManager.jsx` — reference for `@dnd-kit` drag-and-drop (DndContext, SortableContext, DragOverlay, cross-container moves, Supabase persistence)
- `PracticeSchedulingPage.jsx` — reference for the read-only ↔ manual override toggle
- `gameScheduling.js` (core) — already computes `coachAssignments`, detects overlaps, returns conflict metadata

**Target component tree:**
```
GameSchedulingPage.jsx (existing — extend)
├── GameReadinessPanel (existing — no changes)
├── GameConflictBanner (NEW — red banner, mirrors RosterManager's conflict display)
├── GameScheduleGrid (NEW — main interactive area)
│   ├── TimeSlotColumn (NEW — droppable columns for time slots)
│   │   └── GameCard (NEW — draggable card per game assignment)
│   └── DragOverlay → GameCardPreview (NEW — ghost card during drag)
└── TeamScheduleView (existing — read-only fallback)
```

**Why Opus:** Getting the component boundaries, state flow, and `@dnd-kit` container strategy right upfront prevents expensive rewrites.

### Task 2.2 — Build the GameConflictBanner
**Model: Sonnet 4.6**

Extract conflict data from `useGameAssignments` (which already surfaces conflicts via `gameMetrics.js`):
- Count of active conflicts (field double-bookings, coach overlaps)
- Expandable list with affected teams and time slots
- Red for hard conflicts, amber for warnings

### Task 2.3 — Build the GameScheduleGrid with Drag-and-Drop
**Model: Opus 4.6**

The most complex single task in the plan:
- `DndContext` with `closestCorners` collision detection (proven pattern from RosterManager)
- Time slots as droppable containers, game assignments as draggable items
- `handleDragOver`: validate against field availability and coach conflicts in real-time (call into `gameScheduling.js`)
- `handleDragEnd`: persist via mock Supabase with `assignment_source: 'manual'`
- `DragOverlay` with `GameCardPreview` for visual feedback
- Optimistic UI: move the card immediately, roll back on failure

**Why Opus:** Deep `@dnd-kit` integration with real-time validation, optimistic updates, and cross-container moves. The drag lifecycle handlers must be exactly right.

### Task 2.4 — Wire Up Validation Logic
**Model: Sonnet 4.6**

Connect drag-over validation to the core scheduling engine:
- `isFieldAvailable(fieldId, newSlot)` and `hasCoachConflict(coachId, newSlot)` checks on `dragOver`
- Inline feedback: green checkmark or red X on the drop target
- Prevent drop if validation fails (return item to original position)

### Task 2.5 — Implement the E2E Test (Unskip the Scenario)
**Model: Opus 4.6**

Remove `@skipped` from "Resolving game schedule conflicts" in `admin_overrides.feature` and implement step definitions:
- Seed mock data with a deliberate conflict (two games, same slot, same field)
- Navigate to Game Scheduling, verify conflict banner appears
- Use `page.locator().dragTo()` to move the game card to an open slot
- Assert conflict count decreases, card appears in new slot, mock DB updated with `assignment_source: 'manual'`

### Task 2.6 — Unit Tests for New Components
**Model: Sonnet 4.6**

Vitest coverage for `GameConflictBanner`, `GameScheduleGrid`, and the validation logic.

### Task 2.7 — Run Full Suite & Verify
**Model: Haiku 4.5**

Run `npx bddgen && npx playwright test --workers=1 --reporter=list` and `npm run test`. Target: **58/58 E2E** (57 existing + 1 unskipped) plus all unit tests green. Push to a feature branch and confirm CI catches it.

---

## Phase 3: Live Backend Transition ✅

*Goal: Graduate from `mockSupabase.js` to a real Supabase staging environment while keeping all tests green.*

### Task 3.1 — Provision Supabase Staging Project
**Model: Sonnet 4.6**

Using the Supabase MCP connector:
- Create a staging project (or verify the existing one at `mmwupqsjkikqzvmdvuzm`)
- Record the project URL and anon key

### Task 3.2 — Run SQL Migrations
**Model: Opus 4.6**

Apply the 5 migration files sequentially against the staging database:
1. `20251208000000_consolidated_schema.sql` — base tables
2. `20251214000001-003_organizations_schema.sql` — multi-tenancy
3. `20251215000000_strict_rls_multi_tenancy.sql` — RLS framework with `is_org_member()`
4. `20260309000000_rls_remediation.sql` — security fixes
5. `20260310000002_unified_rls_schema.sql` — org_id denormalization

After each migration: verify with `information_schema.tables` and test RLS by querying as an anon user.

**Why Opus:** Migration ordering, RLS verification, and catching schema conflicts requires careful sequential reasoning. A mistake here corrupts the staging database.

### Task 3.3 — Deploy Edge Functions
**Model: Sonnet 4.6**

Deploy the 5 Edge Functions: `game-persistence`, `practice-persistence`, `team-persistence`, `calendar-feed`, `import-validation`. Smoke test each (expect 401 unauthenticated, 200 with a valid JWT).

### Task 3.4 — Extract the Mock Client (The Environment Swap)
**Model: Opus 4.6**

The current `supabaseClient.js` has a binary switch: real or full mock. Create a clean separation:
- Extract mock into its own `mockSupabaseClient.js`
- Keep `supabaseClient.js` as the real-only client
- Toggle via `VITE_USE_MOCK_SUPABASE=true` (already wired in `playwright.config.ts`)
- E2E tests always use the mock (fast, deterministic); dev/staging/prod use the real client
- Local dev: update `.env.local` with real Supabase credentials, set `VITE_USE_MOCK_SUPABASE=false`

**Why Opus:** This refactor touches the most critical file in the system — the one every component imports.

### Task 3.5 — Integration Testing Against Staging
**Model: Opus 4.6**

Create `tests/integration/` that runs against real Supabase staging:
- Seed test data via Supabase admin API (not sessionStorage)
- Auth flows (sign up, sign in, role assignment)
- RLS enforcement (user A cannot see user B's org data)
- Edge Function validation (correct payloads accepted, bad payloads rejected)
- Realtime subscriptions (insert row → client receives event)
- Cleanup after each run

### Task 3.6 — Vercel Environment Configuration
**Model: Sonnet 4.6**

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for the Vercel Preview environment. Keep production environment variables separate for the final cutover. Verify a preview deployment connects to staging Supabase.

### Task 3.7 — Production Cutover Runbook
**Model: Opus 4.6**

Write the definitive runbook:
- Promote staging migrations to production Supabase
- Deploy Edge Functions to production
- Set production environment variables in Vercel
- Seed initial organization and admin user
- Verify RLS with a non-admin user
- Monitor Supabase dashboard (errors, rate limits, connection pool)
- Document rollback procedure (revert Vercel env vars → mock mode fallback)

---

## Model Selection Summary

| Model | Role | Tasks |
|---|---|---|
| **Opus 4.6** | Architecture, complex stateful code, E2E authoring, migrations, security, production runbooks | 2.1, 2.3, 2.5, 3.2, 3.4, 3.5, 3.7 |
| **Sonnet 4.6** | CI/CD YAML, pattern-following components, deployment config, unit tests | 1.1, 1.3, 1.4, 2.2, 2.4, 2.6, 3.1, 3.3, 3.6 |
| **Haiku 4.5** | Mechanical execution, simple config, test runs | 1.0, 1.2, 2.7 |
| **Gemini 3 Flash** | Not recommended — codebase relies heavily on `@dnd-kit` lifecycle semantics, Playwright-BDD, and Supabase RLS patterns that benefit from Claude's deeper reasoning | — |

## Time Estimates

| Phase | Sessions | Cumulative Test Count |
|---|---|---|
| Phase 1 (CI/CD) | 1–2 | 57 E2E + unit suite (now automated) |
| Phase 2 (Game Scheduler) | 2–3 | 58+ E2E + new unit tests |
| Phase 3 (Live Backend) | 2–3 | 58+ E2E (mock) + integration suite (live) |

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Playwright flaky in CI due to timing | Medium | High | `--workers=1`, increased timeouts, `waitForSelector` guards |
| `@dnd-kit` drag simulation unreliable in Playwright | Medium | Medium | `page.locator().dragTo()` with position offsets; fallback to `page.dispatchEvent()` |
| Supabase free-tier pauses during inactivity | High | Low | Scheduled ping via Vercel Cron or GitHub Actions cron |
| RLS policies too restrictive | Medium | High | Test every query pattern in Task 3.5 before cutover |
| Migration conflicts between schema versions | Low | High | Run on a throwaway Supabase branch first |
| Platform-specific deps break CI | **Resolved** | — | Removed `@rollup/rollup-win32-x64-msvc` (Task 1.0) |
