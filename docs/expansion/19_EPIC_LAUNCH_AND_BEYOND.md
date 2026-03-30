# Epic 19: Launch & Beyond (The Final Frontier)

## Phase 1: CI/CD & Production Deployment (Protect the Baseline)
**Goal:** Lock in our 57/57 green tests. Every future PR must pass this automated gauntlet before merging.

1. **GitHub Actions Pipeline:**
   - Create `.github/workflows/ci.yml` to run `npm run test` (Vitest) and `npm run test:e2e` (Playwright) on every push to `main` and PR.
   - Ensure the Playwright job uses `--workers=1` to maintain our mock `sessionStorage` isolation.
2. **Vercel Configuration:**
   - Ensure `vercel.json` is configured for a Vite SPA.
   - Connect the repository to Vercel for automatic Preview Deployments on PRs and Production Deployments on `main`.

## Phase 2: Interactive Game Scheduler (The Final Feature)
**Goal:** Unskip the final E2E test and build the drag-and-drop Game Scheduling grid using our lightning-fast mock environment.

1. **Component Architecture:**
   - Mirror the proven `@dnd-kit` patterns from `RosterManager.jsx`.
   - Build `GameScheduleGrid` (the canvas), `TimeSlotColumn` (droppable areas), and `GameCard` (draggable matchups).
2. **Validation & Persistence:**
   - Wire the `onDragOver` and `onDragEnd` events to the core `gameScheduling.js` engine to instantly flag field double-bookings or coach conflicts.
   - Persist the moves to the mock Supabase client with `assignment_source: 'manual'`.

## Phase 3: Live Backend Transition (The Great Cutover)
**Goal:** Graduate from `mockSupabase.js` to a real Supabase Staging environment and prove our RLS policies hold up in the real world.

1. **Database & Edge Function Provisioning:**
   - Provision a Supabase project.
   - Execute the SQL migrations in `supabase/migrations/` sequentially.
   - Deploy the 4 core Edge Functions (`team-persistence`, `practice-persistence`, `game-persistence`, `calendar-feed`) via the Supabase CLI.
2. **The Environment Swap:**
   - Update `.env.local` with real Supabase credentials.
   - Set `VITE_USE_MOCK_SUPABASE=false`.
