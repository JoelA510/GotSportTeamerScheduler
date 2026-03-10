# SquadLogic 360-Degree Code Review Report

## Executive Summary
This report aggregates the 360-degree audit executed across four primary domains: Security, UI/UX, Core Engine, and QA. Findings are categorized by priority to guide upcoming feature development and refactoring.

---

## 1. Security & Data Governance Domain
**Scope:** `supabase/`, sql migrations, backend api.

*   **[CRITICAL] Missing RLS Organization Checks:** Core tables (e.g., `teams`, `players`, `coaches`, `locations`) defined in `20251208000000_consolidated_schema.sql` lack explicit `organization_id` validation within their Row Level Security (RLS) policies. The policies primarily check for `role = 'admin'`, allowing any admin cross-tenant visibility.
*   **[CRITICAL] SQL View RLS Bypass:** The `coach_team_map` view in `consolidated_schema.sql` is missing the `WITH (security_invoker = true)` flag. This creates a critical RLS bypass vector.
*   **[HIGH] Edge Function Service Key Leakage:** The `calendar-feed/index.ts` Edge Function leverages `SUPABASE_SERVICE_ROLE_KEY` to query `games`, `teams`, and `practice_assignments`. While designed for public calendar ingestion, it lacks strict scoping filters, exposing internal table structures globally.

---

## 2. UI/UX & Accessibility Domain
**Scope:** `frontend/src/`

*   **[HIGH] Widespread Accessibility Blockers (P0):** The app severely lacks `aria-labels` on interactive elements (only 11 instances found codebase-wide). Furthermore, the `:focus-visible` states are missing internally on React components, breaking WCAG 2.2 AA keyboard navigation guidelines.
*   **[MEDIUM] Design System Attrition:** Hardcoded hexadecimal colors (`#0f172a`, `#334155`, etc.) and extensive inline styles (`style={{...}}`) are prevalent in `AdminReportingDashboard.jsx`, `Login.jsx`, and `SettingsPage.jsx`. These bypass the 'Deep Space Glass' design system and CSS variables.

---

## 3. Core Engine & Algorithmic Domain
**Scope:** `packages/core/src/`

*   **[HIGH] Timezone UTC/Local Conversion Bug:** In `practiceScheduling.js`, time filtering utilizes `new Date(start.toLocaleString('en-US', { timeZone: timezone }))`. This parses the string relative to the *local system runtime* rather than mapping to UTC properly, which will induce timezone bleed against `season_settings.timezone`.
*   **[MEDIUM] Impure Functions & State Mutation:** The assignment engines (`gameScheduling.js`, `practiceScheduling.js`) mutate input state directly (e.g., modifying `slot.remainingCapacity -= 1` and `slot.assignedTeams.push()`). This impurity leads to fragile architectures.
*   **[LOW] Code Quality & Types:** Portions of `teamGeneration.js` (`createAssignmentUnits`, `assignUnitToTeam`) are missing comprehensive JSDoc typings, decreasing maintainability.

---

## 4. Testing & QA Domain
**Scope:** `tests/`, Error Handling

*   **[HIGH] Missing Core BDD coverage (Pillars 1 & 2):** Based on `docs/testing/e2e_master_plan.md`, the repository is missing `.feature` files for Pillar 1 (The Engine) and Pillar 2 (Coach Daily Loop). Files like `coach_daily_loop.feature` and `scheduler.feature` are completely unwritten.
*   **[HIGH] Missing React Hook Vitest Coverage:** Out of 12 distinct React hooks in `frontend/src/hooks` (e.g., `useTeamPortal`, `useFields`, `usePracticeAssignments`), *only one* (`usePermission`) has a correlating Vitest unit test. The rest are entirely untested.
*   **[MEDIUM] Error Handling Blind Spots:** Edge cases in the frontend often swallow validation states without presenting actionable, user-facing error toasts (e.g., missing payload guards returning 400s without UI propagation).
