# Next Dev Session: Final Production Push

## Context

SquadLogic v1.0 is ~95% production-ready. Three commits landed today (2026-04-16)
closed most of the `push-to-prod.md` checklist — security hardening migration,
`initialize_new_tenant` onboarding RPC, UI/UX polish, and the
`data_retention_cron` pg_cron migration. **The inherited docs are inconsistent
with the code**: `push-to-prod.md` still lists 20 open tasks that the migrations
and commits show are already shipped, and `TEST_CERTIFICATION_PHASE_10.md`
(Apr 7) reports an E2E failure that commit `b4675e3` (Apr 8) claims to have
fixed. The progress log stops at Phase 9 (Apr 9), so today's work is unlogged.

This session finishes the push to prod by (1) verifying the gaps the audit
actually found, (2) building the cold-start UX that zero-to-one onboarding
needs to feel finished, (3) flipping CSP to enforcing, and (4) rationalizing
the docs so they match reality before launch.

---

## What's already done (no action needed)

Verified against `supabase/migrations/`, `supabase/functions/`,
`frontend/src/`, and `vercel.json`:

- RLS org-scoping on all 15 tables (`20260309000000_rls_remediation.sql`,
  `20260324000000_phase1_rls_unification.sql`)
- Registration policy fix (`20260324000001_fix_registration_policies.sql`)
- Edge Function org membership checks via `supabase/functions/_shared/auth.ts`
  `getUserOrgIds()` on all 7 functions
- Server-side CSV validation — `frontend/src/contexts/ImportContext.jsx` routes
  through the `import-validation` Edge Function before writing staging rows
- Onboarding RPC + wizard — `20260416000001_initialize_new_tenant.sql` +
  `frontend/src/pages/OrganizationCreation.jsx`
- Rate limiting — `supabase/functions/_shared/rateLimit.ts` (sliding window)
- Logger gated on `import.meta.env.PROD` — `frontend/src/lib/logger.js:29`
- Sentry init gated on `VITE_SENTRY_DSN` — `frontend/src/main.jsx:14`
- pg_cron retention jobs — `20260416000002_data_retention_cron.sql`
  (export_jobs/7d, staging_players/30d, audit_log/180d)
- Security headers in `vercel.json` (X-Frame-Options, X-Content-Type-Options,
  Referrer-Policy, Permissions-Policy)

---

## Remaining work

### 1. Verify & measure (do this first — may short-circuit later steps)

1.1 Run the verification sequence from `TEST_CHECKLIST.md`:
```
npm run lint && npm run typecheck && npm run test && npm run test:e2e
```
Expected: 63/63 E2E passing per `b4675e3`. If `auth_setup.ts` still hangs at
login in mock mode (the Phase 10 symptom), fix it before anything else —
check `tests/e2e/steps/auth_setup.ts:31-74` and
`frontend/src/lib/mockSupabaseClient.js` auth seeding.

1.2 `npm audit --production` — confirm the 6 CVEs from
`PRODUCTION_READINESS_PLAN.md §1.4` are resolved or documented as accepted.
If any remain, `npm audit fix` and re-run the test suite.

1.3 `npm run frontend:build` — confirm clean production bundle.

### 2. CSP enforcement

Flip `vercel.json:13` from `Content-Security-Policy-Report-Only` to
`Content-Security-Policy`. Keep the exact same policy string. After deploy,
exercise the golden paths (import, team gen, practice schedule, game
schedule, team portal, calendar token) in the browser and watch the console
for violations; if any fire, add the offending source to `connect-src` /
`img-src` rather than loosening `script-src`.

**File:** `vercel.json`

### 3. Cold-start empty states

Build empty-state UI for users who just created an org and have no data.
Reuse the `glass-panel` / `glass-panel-premium` tokens from `index.css` —
do not introduce new colors or shadows.

Three surfaces need them:

- **Dashboard** — `frontend/src/pages/DashboardPage.jsx`. When
  `useDashboardData` returns zero players / teams / schedules, render a
  single glass panel with three stacked CTAs: "Import registrations"
  (→ `/import`), "Generate teams" (disabled until import), "Schedule
  practices" (disabled until teams). Hide existing metric tiles instead of
  showing 0/0/0.
- **Team Management** — `frontend/src/pages/TeamAnalysisPage.jsx`. When
  `teams.length === 0`, show a panel prompting either auto-draft or import
  first.
- **Practice Scheduler** — `frontend/src/pages/PracticeSchedulePage.jsx`
  (and `GameSchedulePage.jsx`). When there are no field subunits or no
  teams, show the blocker upstream instead of an empty grid.

Accessibility: each empty-state container gets `role="region"` +
`aria-labelledby` pointing at its heading (matches the pattern flagged in
`push-to-prod.md §3`). Keyboard-navigable CTAs, visible focus ring.

**Files:**
- `frontend/src/pages/DashboardPage.jsx`
- `frontend/src/pages/TeamAnalysisPage.jsx`
- `frontend/src/pages/PracticeSchedulePage.jsx`
- `frontend/src/pages/GameSchedulePage.jsx`
- Reusable: consider a single
  `frontend/src/components/ui/EmptyState.jsx` if two+ surfaces share the
  exact same layout — otherwise inline per page.

### 4. Documentation cleanup

**Delete (stale, contradicted by code):**
- `push-to-prod.md` — superseded by the "already done" list above; commit
  `bf91710` already started doc cleanup.
- `TEST_CERTIFICATION_PHASE_10.md` — documents a FAIL that `b4675e3`
  resolved.
- `tsc_full_output.txt` — 6 KB of stale `tsc` errors from
  `tests/autoScheduler.test.js`; `npm run typecheck` is the source of truth.
- `implementation_plan_phase_7_remediation.md` — work landed in
  `20260406180000_phase_7_analytics_persistence.sql` and is summarized in
  the roadmap.

**Archive (keep content, mark superseded):**
- `PRODUCTION_READINESS_PLAN.md` — move to
  `docs/archive/operations/production-readiness-plan-2026-04-12.md`.
  `docs/operations/production-cutover.md` is the active runbook.

**Update:**
- `docs/operations/production-cutover.md` — says "34 migrations / 5 Edge
  Functions deployed". Disk now has 37 migrations / 7 Edge Functions. Update
  the counts, and add a line in §"What does NOT need a runbook step"
  saying the newest migrations
  (`20260416000000_security_hardening`,
  `20260416000001_initialize_new_tenant`,
  `20260416000002_data_retention_cron`) plus the
  `import-validation` and `fairness-scoring` Edge Functions still need to
  be applied/deployed — or confirm they were.
- `docs/expansion/98_PROGRESS_LOG.md` — append Phase 10 (Apr 7 pre-flight
  cert) + today's rows: `SECURITY-HARDEN` (Apr 16 — migration + code),
  `ONBOARDING-10` (Apr 16 — initialize_new_tenant + wizard),
  `UI-POLISH` (Apr 16 — a11y + density pass),
  `OPS-CUTOVER` (Apr 16 — pg_cron retention + doc sync),
  `DOC-CLEANUP` (Apr 16 — this session).
- `docs/README.md` — prepend a Quick Navigation row for
  `docs/operations/ENVIRONMENT.md` (it's missing from the index) and
  reorder the table so Ops / Runbook sits above per-phase governance docs.
  Add one-liner at the top: "v1.0 GA — see
  `docs/operations/production-cutover.md` for launch status."
- `README.md` — the "Phase 10 pre-flight complete, post-launch monitoring
  in effect" status sentence is missing from the Overview.
- `TEST_CHECKLIST.md` — line 112 still says "57/57 passing". Update to
  63/63 once §1.1 verification passes.

### 5. Post-deploy smoke tests (run after merge to `main`)

Per `TEST_CHECKLIST.md §5`:

- Audit log smoke test (one save + one import → verify rows)
- Cross-org RLS smoke (two admin accounts, confirm zero cross-reads on
  `game_slots`, `practice_assignments`, `team_players`)
- Calendar token rotate (`rotate_calendar_token` RPC returns new
  `expires_at` ~90 days out)
- Sentry DSN: confirm `VITE_SENTRY_DSN` is set in Vercel prod env and the
  first synthetic error lands in the Sentry project.

---

## Critical files

| File | Purpose in this session |
|---|---|
| `vercel.json` | Flip CSP to enforcing |
| `frontend/src/pages/DashboardPage.jsx` | Cold-start empty state |
| `frontend/src/pages/TeamAnalysisPage.jsx` | Cold-start empty state |
| `frontend/src/pages/PracticeSchedulePage.jsx` | Cold-start empty state |
| `frontend/src/pages/GameSchedulePage.jsx` | Cold-start empty state |
| `frontend/src/hooks/useDashboardData.js` | Source of truth for "empty" signal |
| `frontend/src/index.css` | Reuse `glass-panel`, `glass-button`, tokens — no new colors |
| `docs/operations/production-cutover.md` | Update migration + EF counts |
| `docs/expansion/98_PROGRESS_LOG.md` | Append Phase 10 + Apr 16 entries |
| `docs/README.md` | Add ENVIRONMENT.md to index, reorder |
| `TEST_CHECKLIST.md` | Update E2E count 57 → 63 |

---

## Reusable patterns to lean on

- **Empty-state container** — use `glass-panel-premium` wrapper, the
  `text-display` heading class, and `animate-fadeIn` for the entry. See
  `frontend/src/components/teaming/TeamPersistencePanel.jsx` for an
  existing glass-panel layout to mirror.
- **RBAC gating in CTAs** — `usePermission` hook (see
  `frontend/src/hooks/usePermission.js`) for hiding "Import" CTA from
  non-admin roles.
- **Data hooks for empty signal** — `useDashboardData`,
  `useTeamSummary`, `usePracticeAssignments` already return zero-friendly
  shapes; treat `counts.players === 0 && counts.teams === 0` as the
  cold-start trigger.

---

## Verification

Per-step:

1. **CSP** — Deploy preview on Vercel, open DevTools Console on all main
   routes, confirm zero CSP violations. Then promote to prod.
2. **Empty states** — Create a fresh org via the onboarding wizard in mock
   mode (`VITE_USE_MOCK_SUPABASE=true npm run frontend:dev`); confirm
   Dashboard / Team / Practice / Game pages render the empty state, not
   a blank grid. Tab through with keyboard — focus ring visible on every
   CTA. Run `npm run test:e2e -- --grep "dashboard_workflow"` to confirm
   no regression in the existing empty-dashboard assertions.
3. **Docs** — `git grep -l "push-to-prod\|PHASE_10\|tsc_full_output"`
   should return zero cross-references after deletes. Open
   `docs/README.md` and confirm every linked path exists.
4. **Progress log** — `docs/expansion/98_PROGRESS_LOG.md` final row
   dates matches `git log --format=%cd --date=short -1` for today.

Full sequence before PR:

```
npm run lint
npm run typecheck
npm run test
npm run test:e2e -- --workers=1
npm run frontend:build
npm audit --production
```

All six must pass. Then commit on `claude/plan-next-steps-4vKXj` and push.
