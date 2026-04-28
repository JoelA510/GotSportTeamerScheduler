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

| Metric                               | Value                                                     |
| ------------------------------------ | --------------------------------------------------------- |
| `npm run lint`                       | 0 errors, 66 warnings                                     |
| `npm run typecheck`                  | 0 errors                                                  |
| `npm run test` (Vitest)              | 326 passed, 34 skipped (50 files)                         |
| `tests/e2e/features/*.feature` count | 21                                                        |
| `supabase/migrations/` count         | 37                                                        |
| `frontend:build`                     | clean (`✓ built in 15.07s`)                               |
| Bundle: main `index.js` gzip         | 115.67 KB                                                 |
| Bundle: `chart-vendor` gzip          | 119.92 KB                                                 |
| Bundle: `supabase-vendor` gzip       | 49.93 KB                                                  |
| Logo PNG                             | 452.30 KB unoptimized                                     |
| E2E baseline                         | 40/63 passing (per `TEST_CHECKLIST.md` + `PR-155-TRIAGE`) |
| Edge Functions count                 | 7                                                         |
| `npm audit`                          | 0 vulnerabilities (per security audit §F-2-13)            |

---

## Distribution table

Findings grouped by **proposed wave**. Trivial-wave eligibility is the bar from `wave-execution-protocol.md` §4 (zero behavior change, ≤15 min, ≤3 files, no test edits, no schema/config/dep changes).

| Proposed wave              | P1     | P2     | P3    | P0-trivial | Total  |
| -------------------------- | ------ | ------ | ----- | ---------- | ------ |
| 1b-trivial                 | 5      | 0      | 0     | 16         | 21     |
| 2-security                 | 5      | 4      | 1     | 0          | 10     |
| 5-e2e (a11y in axe-core)   | 4      | 3      | 0     | 0          | 7      |
| 6a-bundle                  | 4      | 4      | 1     | 0          | 9      |
| 6b-edge / 6b-storage       | 1      | 5      | 0     | 0          | 6      |
| 7a-pgtap (RLS) / 7b-csp    | 1      | 1      | 0     | 0          | 2      |
| 8-docs (v1.1 architecture) | 0      | 6      | 1     | 0          | 7      |
| Skip / re-file post-v1.0.1 | 0      | 7      | 4     | 0          | 11     |
| **Total**                  | **20** | **30** | **7** | **16**     | **73** |

Status legend (used in per-finding tables below):

- 🟡 **queued** — finding accepted, awaits the proposed wave's execution.
- ✅ **shipped** — fix has merged. (Updated by each wave's closure task.)
- 🔵 **waived** — accepted with rationale; not fixing in v1.0.1.
- 🔄 **re-filed** — moved to a different wave; pointer below.

---

## Findings by source

### Code-quality (`code-quality.md`)

**P0-trivial (Wave 1b-trivial)** — 12 findings:

| ID    | Title                                                | Status    |
| ----- | ---------------------------------------------------- | --------- |
| CQ-01 | Unused import `useEffect` (ImportPanel.jsx:1)        | 🟡 queued |
| CQ-02 | Unused import `useMemo` (ImportPanel.jsx:1)          | 🟡 queued |
| CQ-03 | Unused import `RotateCcw` (ErrorBoundary.jsx:2)      | 🟡 queued |
| CQ-04 | Unused import `Button` (ErrorBoundary.jsx:3)         | 🟡 queued |
| CQ-05 | Unused import `CheckCircle2` (EvaluationPanel.jsx:3) | 🟡 queued |
| CQ-06 | Unused import `XCircle` (DataValidationPanel.jsx:2)  | 🟡 queued |
| CQ-07 | Unused import `Eye` (RosterManager.jsx:19)           | 🟡 queued |
| CQ-08 | Unused local `data` (EvaluationPanel.jsx:75)         | 🟡 queued |
| CQ-09 | Unused local `importLogs` (ImportPanel.jsx:62)       | 🟡 queued |
| CQ-10 | Unused local `date` (TeamScheduleView.jsx:24)        | 🟡 queued |
| CQ-11 | Unused local `teams` (GameScheduleGrid.jsx:22)       | 🟡 queued |
| CQ-12 | Unused local `resetImport` (IngestionOverlay.jsx:6)  | 🟡 queued |

**P1 (mix of 1b-trivial + 8-docs)** — 4 findings:

| ID    | Title                                                   | Wave       | Status    |
| ----- | ------------------------------------------------------- | ---------- | --------- |
| CQ-13 | Hardcoded `#fff` in OfflineGuard.jsx:92                 | 1b-trivial | 🟡 queued |
| CQ-14 | Hardcoded `#fbbf24` in Sidebar.jsx:271                  | 1b-trivial | 🟡 queued |
| CQ-15 | `@ts-ignore` should be `@ts-expect-error` (Login.jsx:4) | 1b-trivial | 🟡 queued |
| CQ-16 | `@ts-ignore` without description (config.js:7,9)        | 1b-trivial | 🟡 queued |

**P2 (8-docs / re-file post-v1.0.1)** — 5 findings:

| ID    | Title                                              | Wave                   | Status                               |
| ----- | -------------------------------------------------- | ---------------------- | ------------------------------------ |
| CQ-17 | Conditional hook calls in TeamPersistencePanel.jsx | 8-docs (BEHAVIOR risk) | 🔄 re-filed: see §"Critical re-file" |
| CQ-18 | Cascading setState in useTeamAnalysis.js:16        | Skip / v1.1            | 🔵 waived                            |
| CQ-19 | ImportPanel.jsx > 547 lines (split candidate)      | Skip / v1.1            | 🔵 waived                            |
| CQ-20 | Login.jsx > 320 lines (split candidate)            | Skip / v1.1            | 🔵 waived                            |
| CQ-21 | `console.warn`/`error` outside logger.js (7 sites) | 1b-trivial             | 🟡 queued                            |

**P3** — 1 finding:

| ID    | Title                                               | Wave          | Status    |
| ----- | --------------------------------------------------- | ------------- | --------- |
| CQ-22 | Type precision gap in global.d.ts:8 (`__MOCK_DB__`) | 8-docs / v1.1 | 🔵 waived |

> **Critical re-file (CQ-17)**: the code-quality agent flagged "Conditional hook calls in TeamPersistencePanel.jsx" as a Rules-of-Hooks violation. If accurate, this is a P0-correctness bug, NOT a code-quality nicety. Wave 1b execution must verify against the actual file and either (a) fix in 1b as a hotfix-style trivial PR if confirmed and ≤3 files, or (b) re-file to a Wave 2-correctness ticket if non-trivial. Verification command: `grep -n "useEffect\|useMemo\|useCallback" frontend/src/components/TeamPersistencePanel.jsx` cross-referenced against the file's control flow.

---

### Security (`security.md`)

| ID     | Title                                                     | Severity | Wave                           | Status             |
| ------ | --------------------------------------------------------- | -------- | ------------------------------ | ------------------ |
| F-2-01 | `import_efficiency_metrics` view is SECURITY DEFINER      | P1       | 2-security                     | 🟡 queued          |
| F-2-02 | `raw-imports` bucket public with broad SELECT             | P1       | 2-security                     | 🟡 queued          |
| F-2-03 | Six functions missing `SET search_path`                   | P1       | 2-security                     | 🟡 queued          |
| F-2-04 | Leaked-password protection disabled (Auth dashboard)      | P1       | 2-security (operator)          | 🟡 queued          |
| F-2-05 | `VITE_SENTRY_DSN` not set in Vercel prod                  | P1       | 2-security (operator)          | 🟡 queued          |
| F-2-06 | CSP missing Sentry ingest endpoint in `connect-src`       | P2       | 7b-csp                         | 🟡 queued          |
| F-2-07 | CSP `style-src 'unsafe-inline'` for Tailwind              | P2       | 7b-csp                         | 🔵 waived (compat) |
| F-2-08 | Profiles `auth.uid() = id` without org-scope verification | P2       | 7a-pgtap                       | 🟡 queued          |
| F-2-09 | Password trigger fires on every auth.users INSERT/UPDATE  | P3       | Skip / v1.1                    | 🔵 waived          |
| F-2-10 | No rate-limiting on auth endpoints                        | P2       | 8-docs (Supabase Auth setting) | 🔵 waived          |
| F-2-11 | Mock test creds in `.env.example`                         | P2       | 1b-trivial (rename + comment)  | 🟡 queued          |
| F-2-12 | No audit-log coverage for calendar token rotation         | P2       | 8-docs / v1.1                  | 🔵 waived          |
| F-2-13 | `npm audit` clean                                         | (info)   | n/a                            | ✅ verified        |

---

### Supabase performance (`supabase-performance.md`)

| ID    | Title                                                                                  | Severity      | Wave                              | Status                                                                                                                                                                                      |
| ----- | -------------------------------------------------------------------------------------- | ------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SP-01 | Missing composite index on `scheduler_runs(org_id, run_type, status, created_at DESC)` | P1            | 6b-storage                        | ✅ shipped Wave 6b (migration `20260421005642_add_free_tier_indexes`)                                                                                                                       |
| SP-02 | Missing index on `scheduler_runs(org_id, status)`                                      | P2            | 6b-storage                        | ✅ shipped Wave 6b (same migration)                                                                                                                                                         |
| SP-03 | Missing FK + index on `practice_assignments(run_id)` and `game_assignments(run_id)`    | P2 (blocking) | 2-security (schema integrity)     | 🟡 queued — needs 3-step migration (add nullable → backfill → promote NOT NULL) per Gemini PR #173 review. Defer to operator-gated session.                                                 |
| SP-04 | Unindexed `team_id` in `event_rsvps` RLS policy                                        | P2            | 6b-storage                        | ✅ shipped Wave 6b (same migration)                                                                                                                                                         |
| SP-05 | Unindexed `organization_id` on 8+ multi-tenancy tables                                 | P2            | 6b-storage                        | ✅ shipped Wave 6b (same migration — 8 indexes: divisions, teams, players, coaches, locations, fields, field_subunits, practice_slots)                                                      |
| SP-06 | Missing composite index `team_players(team_id, organization_id)`                       | P2            | 6b-storage                        | ✅ shipped Wave 6b (same migration; final order is `(organization_id, team_id)` per Gemini PR #174 review — RLS-leading column for prefix match on both org-scoped and team-scoped queries) |
| SP-07 | Missing indexes on `import_jobs(org_id, status)` + staging                             | P2            | 6b-storage                        | ✅ shipped Wave 6b (same migration; staging_players index deferred — minor)                                                                                                                 |
| SP-08 | Missing indexes on `games(home_team_id, away_team_id)`                                 | P2            | 6b-storage                        | ✅ shipped Wave 6b (same migration — 2 separate indexes since OR queries can't share a composite)                                                                                           |
| SP-09 | Missing indexes on `practice_slots(org_id)` + facility joins                           | P2            | 6b-storage                        | ✅ shipped Wave 6b (covered by SP-05's practice_slots index; facility join indexes deferred — narrow benefit)                                                                               |
| SP-10 | `pg_cron` jobs lack `IF NOT EXISTS` guard                                              | P1            | 2-security (corrective migration) | 🟡 queued                                                                                                                                                                                   |
| SP-11 | `prune_old_audit_logs()` references missing `organizations.settings` column            | P2            | 2-security (corrective migration) | 🟡 queued                                                                                                                                                                                   |
| SP-12 | `organization_members` RLS has O(n) admin check                                        | P3            | 8-docs / v1.1                     | 🔵 waived                                                                                                                                                                                   |

---

### Free-tier (`free-tier.md`)

| ID     | Title                                                               | Severity | Wave                 | Status                     |
| ------ | ------------------------------------------------------------------- | -------- | -------------------- | -------------------------- |
| F-4-01 | Main bundle 115.67 KB gzip + ThemeToggle dual-import                | P1       | 6a-bundle            | 🟡 queued                  |
| F-4-02 | `chart-vendor` 119.92 KB gzip — heaviest chunk                      | P1       | 6a-bundle            | 🟡 queued                  |
| F-4-03 | Logo asset is 452 KB unoptimized PNG                                | P1       | 6a-bundle            | 🟡 queued                  |
| F-4-04 | No TTL cache on `calendar-feed` / `fairness-scoring` Edge Functions | P1       | 6b-edge              | 🟡 queued                  |
| F-4-05 | `raw-imports` bucket has no retention                               | P2       | 6b-storage           | 🟡 queued                  |
| F-4-06 | CI runs full matrix on doc-only PRs                                 | P2       | 6a-bundle            | 🟡 queued                  |
| F-4-07 | No bundle-size check in CI                                          | P2       | 6a-bundle            | 🟡 queued (Wave 6a Task 1) |
| F-4-08 | `audit_log` retention not yet observability-verified                | P2       | 6b-storage           | 🟡 queued                  |
| F-4-09 | `pg_cron` jobs lack `IF NOT EXISTS` (= SP-10)                       | P2       | 2-security           | 🔄 dup of SP-10            |
| F-4-10 | `staging_players` rows not cleaned per-import                       | P3       | Skip / v1.1          | 🔵 waived                  |
| F-4-11 | Vercel preview deploys on every PR (operator setting)               | P3       | 6a-bundle (operator) | 🔵 waived                  |

---

### Accessibility (`accessibility.md`)

| ID   | Title                                                 | Severity   | Wave                | Status    |
| ---- | ----------------------------------------------------- | ---------- | ------------------- | --------- |
| A-01 | Missing `type="button"` on DataValidationPanel button | P0-trivial | 1b-trivial          | 🟡 queued |
| A-02 | Unlabeled location input in Field Management          | P1         | 1b-trivial          | 🟡 queued |
| A-03 | Missing `htmlFor` wiring on location field label      | P1         | 1b-trivial          | 🟡 queued |
| A-04 | No skip-to-content link                               | P1         | 5-e2e               | 🟡 queued |
| A-05 | No `prefers-reduced-motion` overrides                 | P1         | 5-e2e               | 🟡 queued |
| A-06 | Dynamic page titles not implemented                   | P2         | 8-docs / v1.1       | 🔵 waived |
| A-07 | DnD keyboard announcements not configured             | P1         | 1b-trivial          | 🟡 queued |
| A-08 | No non-drag fallback for game schedule                | P1         | 5-e2e               | 🟡 queued |
| A-09 | No focus trap on `OfflineGuard` overlay               | P2         | 5-e2e               | 🟡 queued |
| A-10 | Form validation errors not linked to fields           | P1         | 1b-trivial          | 🟡 queued |
| A-11 | `aria-required` not wired on required form fields     | P0-trivial | 1b-trivial          | 🟡 queued |
| A-12 | Glass panel contrast cannot be statically validated   | P2         | 5-e2e (axe runtime) | 🟡 queued |
| A-13 | Heading hierarchy not established in DashboardPage    | P2         | 5-e2e               | 🟡 queued |
| A-14 | No `aria-current` on active navigation item           | P0-trivial | 1b-trivial          | 🟡 queued |
| A-15 | Button without accessible name in close-modal         | P0-trivial | 1b-trivial          | 🟡 queued |

---

## Cross-cutting observations

1. **F-4-09 = SP-10** (pg_cron `IF NOT EXISTS` guard). Counted once in totals. Wave 2 owns the corrective migration.
2. **CQ-17 (TeamPersistencePanel hook violation)** is a behavior risk if confirmed. Verify in Wave 1b pre-flight; don't fix in trivial-mode if non-trivial.
3. **Lint warning baseline drift**: Wave 1a expected ≤7 warnings; actual is 66. Wave 1b's 12 P0-trivial unused-import fixes will trim ~12; the remaining 50+ warnings are mostly `'expect' is defined but never used` in tests (a vitest-globals pattern). Consider adding a vitest-globals override to the eslint config in Wave 1b Task 1 closure to push the baseline down to ~5.
4. **Schema integrity findings (SP-03, SP-11)** belong in Wave 2 even though they're labeled "performance" — they're DDL corrections, not index additions.
5. ✅ **Wave 3 (test-infra) consolidation shipped** (Wave 3a + 3b): shared factories/helpers landed, 5 representative tests migrated, and `docs/testing/test-helpers.md` published (including planned-path drift note: `tests/teamPersistencePanel.test.jsx` → `tests/teamPersistencePanel.test.js`).
6. **No Wave 4 (OrganizationCreation salvage) findings surfaced** in this audit — that work is already pre-scoped from PR #155 triage. Tracked separately in `wave-4-prompt.md`.
7. **No Wave 9 (release) findings surfaced** — release readiness is gated on the success of waves 1b through 8.

---

## Wave 1b closure (2026-04-21)

Wave 1b shipped on the same execution branch (`claude/wave-execution-plan-87XGq`) as Wave 0/1a. The trivial sweep produced these outcomes:

### Lint baseline delta

| Metric                   | Before (Wave 1a)      | After (Wave 1b)       | Delta    |
| ------------------------ | --------------------- | --------------------- | -------- |
| Lint warnings            | 66                    | 4                     | **−62**  |
| Lint errors              | 0                     | 0                     | 0        |
| Test files               | 50 (49 pass + 1 skip) | 50 (49 pass + 1 skip) | 0        |
| Tests                    | 326 pass + 34 skip    | 326 pass + 34 skip    | 0        |
| Bundle (`index.js` gzip) | 115.67 KB             | 115.68 KB             | +0.01 KB |
| Build                    | clean                 | clean                 | 0        |

### Outcomes per finding

**Code quality (CQ)** — 22 findings audited:

| ID                    | Outcome                       | Note                                                                                                                                   |
| --------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| CQ-01..CQ-12          | 🔵 waived (false positive)    | Audit agent hallucinated unused imports that don't exist in the live files. Real fix delivered as the 47→4 lint-warning sweep instead. |
| CQ-13, CQ-14          | 🔄 re-filed → Wave 8/v1.1     | Hardcoded hex → design-token swap is a behavior change (color-token mismatch); above the trivial bar.                                  |
| CQ-15, CQ-16          | 🔵 waived (false positive)    | No `@ts-ignore` comments exist in the codebase; only one `@ts-expect-error` (already correctly typed).                                 |
| CQ-17                 | 🔵 waived (false alarm)       | All hooks in TeamPersistencePanel.jsx ARE at top-level; the early return is on line 91 AFTER all hooks. No Rules-of-Hooks violation.   |
| CQ-18..CQ-20          | 🔵 waived                     | P2 architectural items: cascading setState, ImportPanel split, Login split. Re-file post-v1.0.1.                                       |
| CQ-21                 | 🔄 re-filed → Wave 9          | console._ → logger._ sweep explicitly excluded from trivial bar by Wave 1b plan §4.                                                    |
| CQ-22                 | 🔵 waived                     | P3 type precision; defer to v1.1.                                                                                                      |
| **(real lint sweep)** | ✅ shipped (commit `71188df`) | Removed dead `expect` from 19 tests; underscore-prefixed unused vars across 25+ files.                                                 |

**Security (F-2)** — 13 findings:

| ID                             | Outcome                                 | Note                                                                                                                                                                                      |
| ------------------------------ | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-2-01                         | ✅ shipped Wave 2 (commit `7d56e92`)    | `import_efficiency_metrics` view → SECURITY INVOKER (migration `20260421000833_*`).                                                                                                       |
| F-2-02                         | ✅ shipped Wave 2 (commit `07ca5bd`)    | `raw-imports` bucket → private + org-scoped RLS (migration `20260421001043_*`).                                                                                                           |
| F-2-03                         | ✅ shipped Wave 2 (commit `9046c94`)    | search*path pinned on 6 definer functions / 7 overloads (migration `20260421001209*\*`).                                                                                                  |
| F-2-04                         | ✅ documented Wave 2 (commit `15ff9ab`) | Operator runbook `docs/operations/leaked-password-protection.md`.                                                                                                                         |
| F-2-05                         | ✅ documented Wave 2 (commit `15ff9ab`) | Operator runbook `docs/operations/sentry-smoke.md`.                                                                                                                                       |
| F-2-06                         | ✅ shipped Wave 7b                      | CSP `connect-src` includes `https://*.ingest.sentry.io`; Supabase ref replaced with `*.supabase.co` wildcard (`vercel.json`). Full policy + waivers documented in `docs/security/csp.md`. |
| F-2-07, F-2-09, F-2-10, F-2-12 | 🔵 waived                               | Tailwind CSP compat / trigger overhead / rate-limit dashboard / calendar-token audit — defer or operator.                                                                                 |
| F-2-08                         | 🟡 queued for Wave 7a                   | Profiles cross-org pgTAP coverage.                                                                                                                                                        |
| F-2-11                         | ✅ shipped (commit `1c0c06e`)           | Added warning comment to `.env.test.example`.                                                                                                                                             |
| F-2-13                         | ✅ verified                             | npm audit (prod) clean. Dev-only vitest/vite advisory waived in `docs/security/dependabot-waivers.md` (Wave 2 commit `1279c26`); re-evaluation gated on Wave 9 vitest upgrade.            |

**Supabase performance (SP)** — 12 findings: all `🟡 queued for Wave 2 (DDL fixes)` or `Wave 6b (indexes)` per the original assignments. No Wave 1b changes.

**Free-tier (F-4)** — 11 findings: all `🟡 queued for Wave 6a/6b` per original assignments. No Wave 1b changes.

**Accessibility (A / F-4.5)** — 15 findings:

| ID                                                                   | Outcome                       | Note                                                                                                                  |
| -------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| F-4.5-01, F-4.5-02, F-4.5-03, F-4.5-07, F-4.5-11, F-4.5-15           | ✅ shipped (commit `5b2b092`) | type="button", aria-label, htmlFor, screenReaderInstructions, aria-required, aria-label on close.                     |
| F-4.5-14                                                             | 🔵 waived (false positive)    | react-router-dom v7 NavLink already auto-applies `aria-current="page"`.                                               |
| F-4.5-10                                                             | 🔄 re-filed → Wave 5          | aria-describedby across 4 form files exceeds ≤3-files trivial bar; ships with axe-core integration.                   |
| F-4.5-04, F-4.5-05, F-4.5-06, F-4.5-08, F-4.5-09, F-4.5-12, F-4.5-13 | 🟡 queued for Wave 5 / Wave 8 | Skip-to-content, prefers-reduced-motion, page titles, drag fallback, focus trap, contrast runtime, heading hierarchy. |

### Follow-ups to Waves 2–9 (rollup)

- **Wave 2-security**: ~~F-2-01, F-2-02, F-2-03, F-2-04, F-2-05~~ (✅ all shipped 2026-04-21); SP-03, SP-10, SP-11 still queued (re-filed to Wave 6b — schema integrity DDL paired with the index migration).
- **Wave 5-e2e**: F-4.5-04, F-4.5-05, F-4.5-08, F-4.5-09, F-4.5-10, F-4.5-12, F-4.5-13.
- **Wave 6a-bundle**: F-4-01, F-4-02, F-4-03, F-4-06, F-4-07.
- **Wave 6b-edge / 6b-storage**: F-4-04; F-4-05, F-4-08; SP-01, SP-02, SP-04, SP-05, SP-06, SP-07, SP-08, SP-09.
- **Wave 7a-pgtap**: F-2-08.
- **Wave 7b-csp**: F-2-06.
- **Wave 8-docs (or v1.1)**: CQ-13, CQ-14, F-4.5-06, A-13.
- **Wave 9-release**: CQ-21 (console→logger sweep).
- **Skip / v1.1 backlog**: CQ-01..CQ-12 (false positives — handled inline), CQ-15..CQ-22, F-2-07, F-2-09..F-2-12, F-4-10, F-4-11, F-4.5-14, SP-12.

### Critical lint warnings remaining (re-filed)

The 4 remaining lint warnings after Wave 1b are NOT trivial:

1. `frontend/src/components/teaming/RosterManager.jsx:93` — react-compiler "incompatible library" (Compilation Skipped). **→ Wave 9-release** or v1.1.
2. `frontend/src/pages/GameSchedulingPage.jsx:33` — react-hooks/exhaustive-deps (`game.assignments`). **→ Wave 5** (behavior-touching, needs E2E coverage to verify no regression).
3. `frontend/src/pages/PracticeSchedulingPage.jsx:31` — same. **→ Wave 5**.
4. `frontend/src/pages/TeamAnalysisPage.jsx:81` — react-hooks/exhaustive-deps unnecessary deps. **→ Wave 5**.

---

## Wave-1b execution backlog (snapshot — superseded by closure above)

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
