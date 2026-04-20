# Wave 1a — Consolidated Audit Index

**Date**: 2026-04-20
**Branch**: `claude/wave-execution-plan-87XGq`
**Scope**: cross-domain findings index from the 5 Wave 1a sub-reports.
**Sub-reports**:
- [`code-quality.md`](code-quality.md) — 22 findings
- [`security.md`](security.md) — 13 findings
- [`supabase-performance.md`](supabase-performance.md) — 12 findings
- [`free-tier.md`](free-tier.md) — 11 findings
- [`accessibility.md`](accessibility.md) — 15 findings

**Total**: 73 findings.

---

## Baselines (captured 2026-04-20)

| Metric | Value |
| --- | --- |
| `npm run lint` | 0 errors, 66 warnings |
| `npm run typecheck` | 0 errors |
| `npm run test` (Vitest) | 326 passed, 34 skipped (50 files) |
| `tests/e2e/features/*.feature` count | 21 |
| `supabase/migrations/` count | 37 |
| `frontend:build` | clean (`✓ built in 15.07s`) |
| Bundle: main `index.js` gzip | 115.67 KB |
| Bundle: `chart-vendor` gzip | 119.92 KB |
| Bundle: `supabase-vendor` gzip | 49.93 KB |
| Logo PNG | 452.30 KB unoptimized |
| E2E baseline | 40/63 passing (per `TEST_CHECKLIST.md` + `PR-155-TRIAGE`) |
| Edge Functions count | 7 |
| `npm audit` | 0 vulnerabilities (per security audit §F-2-13) |

---

## Distribution table

Findings grouped by **proposed wave**. Trivial-wave eligibility is the bar from `wave-execution-protocol.md` §4 (zero behavior change, ≤15 min, ≤3 files, no test edits, no schema/config/dep changes).

| Proposed wave | P1 | P2 | P3 | P0-trivial | Total |
| --- | --- | --- | --- | --- | --- |
| 1b-trivial | 5 | 0 | 0 | 16 | 21 |
| 2-security | 5 | 4 | 1 | 0 | 10 |
| 5-e2e (a11y in axe-core) | 4 | 3 | 0 | 0 | 7 |
| 6a-bundle | 4 | 4 | 1 | 0 | 9 |
| 6b-edge / 6b-storage | 1 | 5 | 0 | 0 | 6 |
| 7a-pgtap (RLS) / 7b-csp | 1 | 1 | 0 | 0 | 2 |
| 8-docs (v1.1 architecture) | 0 | 6 | 1 | 0 | 7 |
| Skip / re-file post-v1.0.1 | 0 | 7 | 4 | 0 | 11 |
| **Total** | **20** | **30** | **7** | **16** | **73** |

Status legend (used in per-finding tables below):
- 🟡 **queued** — finding accepted, awaits the proposed wave's execution.
- ✅ **shipped** — fix has merged. (Updated by each wave's closure task.)
- 🔵 **waived** — accepted with rationale; not fixing in v1.0.1.
- 🔄 **re-filed** — moved to a different wave; pointer below.

---

## Findings by source

### Code-quality (`code-quality.md`)

**P0-trivial (Wave 1b-trivial)** — 12 findings:

| ID | Title | Status |
| --- | --- | --- |
| CQ-01 | Unused import `useEffect` (ImportPanel.jsx:1) | 🟡 queued |
| CQ-02 | Unused import `useMemo` (ImportPanel.jsx:1) | 🟡 queued |
| CQ-03 | Unused import `RotateCcw` (ErrorBoundary.jsx:2) | 🟡 queued |
| CQ-04 | Unused import `Button` (ErrorBoundary.jsx:3) | 🟡 queued |
| CQ-05 | Unused import `CheckCircle2` (EvaluationPanel.jsx:3) | 🟡 queued |
| CQ-06 | Unused import `XCircle` (DataValidationPanel.jsx:2) | 🟡 queued |
| CQ-07 | Unused import `Eye` (RosterManager.jsx:19) | 🟡 queued |
| CQ-08 | Unused local `data` (EvaluationPanel.jsx:75) | 🟡 queued |
| CQ-09 | Unused local `importLogs` (ImportPanel.jsx:62) | 🟡 queued |
| CQ-10 | Unused local `date` (TeamScheduleView.jsx:24) | 🟡 queued |
| CQ-11 | Unused local `teams` (GameScheduleGrid.jsx:22) | 🟡 queued |
| CQ-12 | Unused local `resetImport` (IngestionOverlay.jsx:6) | 🟡 queued |

**P1 (mix of 1b-trivial + 8-docs)** — 4 findings:

| ID | Title | Wave | Status |
| --- | --- | --- | --- |
| CQ-13 | Hardcoded `#fff` in OfflineGuard.jsx:92 | 1b-trivial | 🟡 queued |
| CQ-14 | Hardcoded `#fbbf24` in Sidebar.jsx:271 | 1b-trivial | 🟡 queued |
| CQ-15 | `@ts-ignore` should be `@ts-expect-error` (Login.jsx:4) | 1b-trivial | 🟡 queued |
| CQ-16 | `@ts-ignore` without description (config.js:7,9) | 1b-trivial | 🟡 queued |

**P2 (8-docs / re-file post-v1.0.1)** — 5 findings:

| ID | Title | Wave | Status |
| --- | --- | --- | --- |
| CQ-17 | Conditional hook calls in TeamPersistencePanel.jsx | 8-docs (BEHAVIOR risk) | 🔄 re-filed: see §"Critical re-file" |
| CQ-18 | Cascading setState in useTeamAnalysis.js:16 | Skip / v1.1 | 🔵 waived |
| CQ-19 | ImportPanel.jsx > 547 lines (split candidate) | Skip / v1.1 | 🔵 waived |
| CQ-20 | Login.jsx > 320 lines (split candidate) | Skip / v1.1 | 🔵 waived |
| CQ-21 | `console.warn`/`error` outside logger.js (7 sites) | 1b-trivial | 🟡 queued |

**P3** — 1 finding:

| ID | Title | Wave | Status |
| --- | --- | --- | --- |
| CQ-22 | Type precision gap in global.d.ts:8 (`__MOCK_DB__`) | 8-docs / v1.1 | 🔵 waived |

> **Critical re-file (CQ-17)**: the code-quality agent flagged "Conditional hook calls in TeamPersistencePanel.jsx" as a Rules-of-Hooks violation. If accurate, this is a P0-correctness bug, NOT a code-quality nicety. Wave 1b execution must verify against the actual file and either (a) fix in 1b as a hotfix-style trivial PR if confirmed and ≤3 files, or (b) re-file to a Wave 2-correctness ticket if non-trivial. Verification command: `grep -n "useEffect\|useMemo\|useCallback" frontend/src/components/TeamPersistencePanel.jsx` cross-referenced against the file's control flow.

---

### Security (`security.md`)

| ID | Title | Severity | Wave | Status |
| --- | --- | --- | --- | --- |
| F-2-01 | `import_efficiency_metrics` view is SECURITY DEFINER | P1 | 2-security | 🟡 queued |
| F-2-02 | `raw-imports` bucket public with broad SELECT | P1 | 2-security | 🟡 queued |
| F-2-03 | Six functions missing `SET search_path` | P1 | 2-security | 🟡 queued |
| F-2-04 | Leaked-password protection disabled (Auth dashboard) | P1 | 2-security (operator) | 🟡 queued |
| F-2-05 | `VITE_SENTRY_DSN` not set in Vercel prod | P1 | 2-security (operator) | 🟡 queued |
| F-2-06 | CSP missing Sentry ingest endpoint in `connect-src` | P2 | 7b-csp | 🟡 queued |
| F-2-07 | CSP `style-src 'unsafe-inline'` for Tailwind | P2 | 7b-csp | 🔵 waived (compat) |
| F-2-08 | Profiles `auth.uid() = id` without org-scope verification | P2 | 7a-pgtap | 🟡 queued |
| F-2-09 | Password trigger fires on every auth.users INSERT/UPDATE | P3 | Skip / v1.1 | 🔵 waived |
| F-2-10 | No rate-limiting on auth endpoints | P2 | 8-docs (Supabase Auth setting) | 🔵 waived |
| F-2-11 | Mock test creds in `.env.example` | P2 | 1b-trivial (rename + comment) | 🟡 queued |
| F-2-12 | No audit-log coverage for calendar token rotation | P2 | 8-docs / v1.1 | 🔵 waived |
| F-2-13 | `npm audit` clean | (info) | n/a | ✅ verified |

---

### Supabase performance (`supabase-performance.md`)

| ID | Title | Severity | Wave | Status |
| --- | --- | --- | --- | --- |
| SP-01 | Missing composite index on `scheduler_runs(org_id, run_type, status, created_at DESC)` | P1 | 6b-storage | 🟡 queued |
| SP-02 | Missing index on `scheduler_runs(org_id, status)` | P2 | 6b-storage | 🟡 queued |
| SP-03 | Missing FK + index on `practice_assignments(run_id)` and `game_assignments(run_id)` | P2 (blocking) | 2-security (schema integrity) | 🟡 queued |
| SP-04 | Unindexed `team_id` in `event_rsvps` RLS policy | P2 | 6b-storage | 🟡 queued |
| SP-05 | Unindexed `organization_id` on 8+ multi-tenancy tables | P2 | 6b-storage | 🟡 queued |
| SP-06 | Missing composite index `team_players(team_id, organization_id)` | P2 | 6b-storage | 🟡 queued |
| SP-07 | Missing indexes on `import_jobs(org_id, status)` + staging | P2 | 6b-storage | 🟡 queued |
| SP-08 | Missing indexes on `games(home_team_id, away_team_id)` | P2 | 6b-storage | 🟡 queued |
| SP-09 | Missing indexes on `practice_slots(org_id)` + facility joins | P2 | 6b-storage | 🟡 queued |
| SP-10 | `pg_cron` jobs lack `IF NOT EXISTS` guard | P1 | 2-security (corrective migration) | 🟡 queued |
| SP-11 | `prune_old_audit_logs()` references missing `organizations.settings` column | P2 | 2-security (corrective migration) | 🟡 queued |
| SP-12 | `organization_members` RLS has O(n) admin check | P3 | 8-docs / v1.1 | 🔵 waived |

---

### Free-tier (`free-tier.md`)

| ID | Title | Severity | Wave | Status |
| --- | --- | --- | --- | --- |
| F-4-01 | Main bundle 115.67 KB gzip + ThemeToggle dual-import | P1 | 6a-bundle | 🟡 queued |
| F-4-02 | `chart-vendor` 119.92 KB gzip — heaviest chunk | P1 | 6a-bundle | 🟡 queued |
| F-4-03 | Logo asset is 452 KB unoptimized PNG | P1 | 6a-bundle | 🟡 queued |
| F-4-04 | No TTL cache on `calendar-feed` / `fairness-scoring` Edge Functions | P1 | 6b-edge | 🟡 queued |
| F-4-05 | `raw-imports` bucket has no retention | P2 | 6b-storage | 🟡 queued |
| F-4-06 | CI runs full matrix on doc-only PRs | P2 | 6a-bundle | 🟡 queued |
| F-4-07 | No bundle-size check in CI | P2 | 6a-bundle | 🟡 queued (Wave 6a Task 1) |
| F-4-08 | `audit_log` retention not yet observability-verified | P2 | 6b-storage | 🟡 queued |
| F-4-09 | `pg_cron` jobs lack `IF NOT EXISTS` (= SP-10) | P2 | 2-security | 🔄 dup of SP-10 |
| F-4-10 | `staging_players` rows not cleaned per-import | P3 | Skip / v1.1 | 🔵 waived |
| F-4-11 | Vercel preview deploys on every PR (operator setting) | P3 | 6a-bundle (operator) | 🔵 waived |

---

### Accessibility (`accessibility.md`)

| ID | Title | Severity | Wave | Status |
| --- | --- | --- | --- | --- |
| A-01 | Missing `type="button"` on DataValidationPanel button | P0-trivial | 1b-trivial | 🟡 queued |
| A-02 | Unlabeled location input in Field Management | P1 | 1b-trivial | 🟡 queued |
| A-03 | Missing `htmlFor` wiring on location field label | P1 | 1b-trivial | 🟡 queued |
| A-04 | No skip-to-content link | P1 | 5-e2e | 🟡 queued |
| A-05 | No `prefers-reduced-motion` overrides | P1 | 5-e2e | 🟡 queued |
| A-06 | Dynamic page titles not implemented | P2 | 8-docs / v1.1 | 🔵 waived |
| A-07 | DnD keyboard announcements not configured | P1 | 1b-trivial | 🟡 queued |
| A-08 | No non-drag fallback for game schedule | P1 | 5-e2e | 🟡 queued |
| A-09 | No focus trap on `OfflineGuard` overlay | P2 | 5-e2e | 🟡 queued |
| A-10 | Form validation errors not linked to fields | P1 | 1b-trivial | 🟡 queued |
| A-11 | `aria-required` not wired on required form fields | P0-trivial | 1b-trivial | 🟡 queued |
| A-12 | Glass panel contrast cannot be statically validated | P2 | 5-e2e (axe runtime) | 🟡 queued |
| A-13 | Heading hierarchy not established in DashboardPage | P2 | 5-e2e | 🟡 queued |
| A-14 | No `aria-current` on active navigation item | P0-trivial | 1b-trivial | 🟡 queued |
| A-15 | Button without accessible name in close-modal | P0-trivial | 1b-trivial | 🟡 queued |

---

## Cross-cutting observations

1. **F-4-09 = SP-10** (pg_cron `IF NOT EXISTS` guard). Counted once in totals. Wave 2 owns the corrective migration.
2. **CQ-17 (TeamPersistencePanel hook violation)** is a behavior risk if confirmed. Verify in Wave 1b pre-flight; don't fix in trivial-mode if non-trivial.
3. **Lint warning baseline drift**: Wave 1a expected ≤7 warnings; actual is 66. Wave 1b's 12 P0-trivial unused-import fixes will trim ~12; the remaining 50+ warnings are mostly `'expect' is defined but never used` in tests (a vitest-globals pattern). Consider adding a vitest-globals override to the eslint config in Wave 1b Task 1 closure to push the baseline down to ~5.
4. **Schema integrity findings (SP-03, SP-11)** belong in Wave 2 even though they're labeled "performance" — they're DDL corrections, not index additions.
5. **No Wave 3 (test-infra) findings surfaced** in this audit. Wave 3a's factories/helpers are still useful but no audit finding directly motivates them. They remain on the planned roadmap.
6. **No Wave 4 (OrganizationCreation salvage) findings surfaced** in this audit — that work is already pre-scoped from PR #155 triage. Tracked separately in `wave-4-prompt.md`.
7. **No Wave 9 (release) findings surfaced** — release readiness is gated on the success of waves 1b through 8.

---

## Wave-1b execution backlog (snapshot for the next session)

These are the 21 findings tagged `1b-trivial`. Wave 1b's 4 tasks pick them up:

**Task 1 — code-quality trivial sweep** (12 P0 + 4 P1 = 16 findings):
CQ-01 through CQ-16, CQ-21.

**Task 2 — security/docs trivial sweep** (1 finding):
F-2-11.

**Task 3 — accessibility trivial sweep** (8 findings):
A-01, A-02, A-03, A-07, A-10, A-11, A-14, A-15.

**Task 4 — distribution + audit closure**:
update each `🟡 queued` row above to `✅ shipped`; record the ship commit SHA.

**Estimated Wave 1b throughput**: ~1.5–2.5 hours total (~6 minutes per trivial finding average).

---

## Re-verification checklist (for downstream waves' pre-flight)

When each downstream wave starts, its pre-flight should:

1. Re-grep its own findings against the live repo (some may have shifted since 2026-04-20).
2. Mark this index's rows accordingly:
   - 🟡 queued → ✅ shipped (after the wave's closure task).
   - 🟡 queued → 🔄 re-filed (with pointer to a follow-up wave) if scope changed.
   - 🟡 queued → 🔵 waived (with rationale) if no longer applicable.
3. Append the wave's progress-log entry with finding-IDs closed.

Per `wave-execution-protocol.md` §6, this index is the source of truth for closure markers.
