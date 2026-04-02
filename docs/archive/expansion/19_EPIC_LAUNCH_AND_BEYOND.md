# Epic 19: Launch & Beyond (The Final Frontier)

> [!NOTE]
> This is the **summary version** of Epic 19. For the detailed execution plan with per-task model assignments, time estimates, and risk register, see [19_EPIC_LAUNCH_AND_BEYOND_CLAUDE.md](./19_EPIC_LAUNCH_AND_BEYOND_CLAUDE.md).

## Phase 1: CI/CD & Production Deployment ✅ Complete
**Goal:** Lock in our 57/57 green tests. Every future PR must pass this automated gauntlet before merging.

1. **GitHub Actions Pipeline:** `.github/workflows/ci.yml` runs Vitest + Playwright-BDD on every push to `main` and PR. Includes Supabase free-tier keep-alive cron.
2. **Vercel Configuration:** Connected to repository for automatic Preview Deployments on PRs and Production Deployments on `main`.

## Phase 2: Interactive Game Scheduler ✅ Complete
**Goal:** Unskip the final E2E test and build the drag-and-drop Game Scheduling grid using our lightning-fast mock environment.

1. **Component Architecture:** 5 new components in `frontend/src/components/scheduling/` — `GameScheduleGrid`, `FieldColumn`, `TimeSlotDropZone`, `GameCard`, `GameConflictBanner`.
2. **Validation & Persistence:** Real-time field availability and coach conflict validation during drag. Persists with `assignment_source: 'manual'`.

## Phase 3: Live Backend Transition ✅ Complete
**Goal:** Graduate from `mockSupabase.js` to a real Supabase staging environment and prove our RLS policies hold up in the real world.

1. **Database & Edge Function Provisioning:** 34 migrations applied, 5 Edge Functions deployed.
2. **The Environment Swap:** `VITE_USE_MOCK_SUPABASE=false` in production; mock client retained for E2E tests.
3. **Production Cutover:** See `PRODUCTION_CUTOVER_RUNBOOK.md` for the complete operational runbook.
