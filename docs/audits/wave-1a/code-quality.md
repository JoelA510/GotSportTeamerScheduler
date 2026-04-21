# Wave 1a Code-Quality Audit

**Audit Date**: 2026-04-20  
**Scope**: SquadLogic monorepo (frontend, packages/core, supabase/functions)  
**Auditor**: Claude Code (Haiku 4.5)

## Baselines

| Metric | Value |
|--------|-------|
| Lint Errors | 0 |
| Lint Warnings | 66 |
| Typecheck Errors | 0 |
| Test Files (unit/integration) | 50 |
| Tests Passed | 326 |
| Tests Skipped | 34 |
| E2E Feature Files | 21 |
| Migrations | 37 |

---

## Findings (22 total)

### P0 – Trivial (Wave 1b-eligible cleanup)

**1. Unused import: useEffect in ImportPanel.jsx**
- **Severity**: P0
- **Location**: `frontend/src/components/ImportPanel.jsx:1`
- **Observation**: `useEffect` imported from React but never used in component logic.
- **Impact**: Dead import increases bundle metadata; signals incomplete refactoring.
- **Recommended Fix**: Remove `useEffect` from import line 1.
- **Proposed Wave**: 1b-trivial
- **Effort**: XS

**2. Unused import: useMemo in ImportPanel.jsx**
- **Severity**: P0
- **Location**: `frontend/src/components/ImportPanel.jsx:1`
- **Observation**: `useMemo` imported but not called anywhere in component.
- **Impact**: Dead import; increases cognitive load for maintainers.
- **Recommended Fix**: Remove `useMemo` from import destructuring.
- **Proposed Wave**: 1b-trivial
- **Effort**: XS

**3. Unused import: RotateCcw in ErrorBoundary.jsx**
- **Severity**: P0
- **Location**: `frontend/src/components/ErrorBoundary.jsx:2`
- **Observation**: Lucide icon `RotateCcw` imported but never rendered or referenced.
- **Impact**: Unused icon asset in bundle.
- **Recommended Fix**: Remove from lucide-react destructuring.
- **Proposed Wave**: 1b-trivial
- **Effort**: XS

**4. Unused import: Button in ErrorBoundary.jsx**
- **Severity**: P0
- **Location**: `frontend/src/components/ErrorBoundary.jsx:3`
- **Observation**: Component import but not used in JSX or logic.
- **Impact**: Dead component reference; bundle bloat.
- **Recommended Fix**: Remove Button import; if button UI needed, use direct UI element or add back.
- **Proposed Wave**: 1b-trivial
- **Effort**: XS

**5. Unused import: CheckCircle2 in EvaluationPanel.jsx**
- **Severity**: P0
- **Location**: `frontend/src/components/EvaluationPanel.jsx:3`
- **Observation**: Lucide icon imported but never used in render.
- **Impact**: Unused asset.
- **Recommended Fix**: Remove from lucide-react import.
- **Proposed Wave**: 1b-trivial
- **Effort**: XS

**6. Unused import: XCircle in DataValidationPanel.jsx**
- **Severity**: P0
- **Location**: `frontend/src/components/teaming/DataValidationPanel.jsx:2`
- **Observation**: Lucide icon `XCircle` imported but never referenced.
- **Impact**: Unused icon asset.
- **Recommended Fix**: Remove from lucide-react destructuring.
- **Proposed Wave**: 1b-trivial
- **Effort**: XS

**7. Unused import: Eye in RosterManager.jsx**
- **Severity**: P0
- **Location**: `frontend/src/components/teaming/RosterManager.jsx:19`
- **Observation**: Lucide icon `Eye` imported but never rendered.
- **Impact**: Unused asset.
- **Recommended Fix**: Remove from lucide-react import.
- **Proposed Wave**: 1b-trivial
- **Effort**: XS

**8. Unused local variable: data in EvaluationPanel.jsx**
- **Severity**: P0
- **Location**: `frontend/src/components/EvaluationPanel.jsx:75`
- **Observation**: Variable assigned from destructuring but never read.
- **Impact**: Dead assignment; confuses maintenance.
- **Recommended Fix**: Remove `data` from destructuring or use it.
- **Proposed Wave**: 1b-trivial
- **Effort**: XS

**9. Unused local variable: importLogs in ImportPanel.jsx**
- **Severity**: P0
- **Location**: `frontend/src/components/ImportPanel.jsx:62`
- **Observation**: Variable assigned a value but never referenced in component logic.
- **Impact**: Dead code.
- **Recommended Fix**: Remove assignment or use for debugging/telemetry.
- **Proposed Wave**: 1b-trivial
- **Effort**: XS

**10. Unused local variable: date in TeamScheduleView.jsx**
- **Severity**: P0
- **Location**: `frontend/src/components/TeamScheduleView.jsx:24`
- **Observation**: Variable assigned but never used.
- **Impact**: Dead assignment.
- **Recommended Fix**: Remove or use for computed display logic.
- **Proposed Wave**: 1b-trivial
- **Effort**: XS

**11. Unused local variable: teams in GameScheduleGrid.jsx**
- **Severity**: P0
- **Location**: `frontend/src/components/scheduling/GameScheduleGrid.jsx:22`
- **Observation**: Function parameter destructured but never used in body.
- **Impact**: Dead parameter; confuses API contract.
- **Recommended Fix**: Prefix with underscore (`_teams`) to signal intentional non-use, or remove.
- **Proposed Wave**: 1b-trivial
- **Effort**: XS

**12. Unused local variable: resetImport in IngestionOverlay.jsx**
- **Severity**: P0
- **Location**: `frontend/src/components/ui/IngestionOverlay.jsx:6`
- **Observation**: Destructured from context but never referenced.
- **Impact**: Dead variable; clutters props.
- **Recommended Fix**: Remove from destructuring.
- **Proposed Wave**: 1b-trivial
- **Effort**: XS

---

### P1 – Correctness / Best Practice Violations

**13. Hardcoded color hex #fff outside index.css**
- **Severity**: P1
- **Location**: `frontend/src/components/OfflineGuard.jsx:92` (line with `color: '#fff'`)
- **Observation**: Inline style uses hardcoded white hex; design tokens defined in index.css not used.
- **Impact**: Breaks design consistency; makes theming/accessibility changes hard.
- **Recommended Fix**: Replace with CSS custom property or Tailwind class. Use `text-white` or `var(--color-text-primary)`.
- **Proposed Wave**: 1b-trivial (if simple token swap) or 2-style
- **Effort**: S

**14. Hardcoded color hex #fbbf24 outside index.css**
- **Severity**: P1
- **Location**: `frontend/src/components/Sidebar.jsx:271` (inline style with color hex)
- **Observation**: Hardcoded amber-400 hex in inline style; should use design token.
- **Impact**: Design inconsistency; undermines color system.
- **Recommended Fix**: Replace with Tailwind `text-amber-400` or CSS var.
- **Proposed Wave**: 2-style
- **Effort**: S

**15. @ts-ignore used instead of @ts-expect-error in Login.jsx**
- **Severity**: P1
- **Location**: `frontend/src/components/Login.jsx:4`
- **Observation**: `@ts-ignore` used instead of `@ts-expect-error`, which is less safe and deprecated.
- **Impact**: Type-safety escape hatch not clearly documented; harder to audit TypeScript gaps.
- **Recommended Fix**: Replace with `@ts-expect-error` and add description comment explaining why needed.
- **Proposed Wave**: 1b-trivial
- **Effort**: XS

**16. @ts-ignore in config.js without description (2 instances)**
- **Severity**: P1
- **Location**: `frontend/src/config.js:7, 9`
- **Observation**: Two `@ts-ignore` comments lack required descriptions; eslint already flagged these as errors in lint_results.txt.
- **Impact**: Type-safety gaps undocumented; auditing escape hatches becomes impossible.
- **Recommended Fix**: Convert to `@ts-expect-error [REASON]` with 3+ character reason.
- **Proposed Wave**: 1b-trivial
- **Effort**: S

---

### P2 – Architecture / Performance

**17. Conditional hook calls in TeamPersistencePanel.jsx violate Rules of Hooks**
- **Severity**: P2
- **Location**: `frontend/src/components/TeamPersistencePanel.jsx:24-75` (multiple lines)
- **Observation**: Lint_results.txt shows 5 errors: `useEffect`, `useMemo`, `useCallback` called conditionally inside if statements (lines 28, 32, 39, 58, 66, 75, 90).
- **Impact**: React Hook rules violation; will cause crashes or stale closures in production.
- **Recommended Fix**: Move all hook calls to component top-level; use conditional logic inside hook bodies.
- **Proposed Wave**: 2-correctness
- **Effort**: M

**18. Cascading setState in useTeamAnalysis.js effect**
- **Severity**: P2
- **Location**: `frontend/src/hooks/useTeamAnalysis.js:16`
- **Observation**: Calling `setState` synchronously within effect body; causes cascading renders.
- **Impact**: Performance degradation; excessive re-renders on every data fetch.
- **Recommended Fix**: Wrap setState in callback or use state transitions library; ensure external state sync pattern.
- **Proposed Wave**: 2-perf
- **Effort**: M

**19. Components > 250 lines: ImportPanel (547 lines) – split candidate**
- **Severity**: P2
- **Location**: `frontend/src/components/ImportPanel.jsx` (lines 1–547)
- **Observation**: Monolithic component handling CSV upload, preview, mapping, and import orchestration. Exceeds 250-line threshold significantly.
- **Impact**: Hard to test, maintain, and reason about; violates single-responsibility principle.
- **Recommended Fix**: Extract SmartBadge, file upload handler, preview section, mapping UI into sub-components.
- **Proposed Wave**: 2-refactor
- **Effort**: M

**20. Components > 250 lines: Login (320 lines) – split candidate**
- **Severity**: P2
- **Location**: `frontend/src/components/Login.jsx` (lines 1–320)
- **Observation**: Login handles sign-in, sign-up, forgot password, and email verification in single component.
- **Impact**: Complex state management; hard to test individual auth flows.
- **Recommended Fix**: Extract ForgotPasswordForm, SignUpForm, or use hook abstraction.
- **Proposed Wave**: 2-refactor
- **Effort**: M

**21. Console.warn/error outside logger.js in multiple files**
- **Severity**: P2
- **Location**: `frontend/src/components/ui/FeatureGuard.jsx:21`, `frontend/src/contexts/AuthContext.jsx:43, 89, 132, 156, 178`, `frontend/src/pages/TeamAnalysisPage.jsx:77`, `frontend/src/constants/featureFlags.js:45`
- **Observation**: Direct `console.warn()` and `console.error()` calls bypass logger.js abstraction. Should route through logger for consistent formatting, remote capture, and audit trail.
- **Impact**: Logging inconsistency; loss of structured logging; production debugging harder.
- **Recommended Fix**: Replace all `console.*` calls with `logger.warn()`, `logger.error()`, etc. from `lib/logger.js`.
- **Proposed Wave**: 2-perf
- **Effort**: S

---

### P3 – Documentation / Type Safety

**22. Explicit any type in global.d.ts**
- **Severity**: P3
- **Location**: `frontend/src/global.d.ts:8`
- **Observation**: Window interface property `__MOCK_DB__` typed as `Record<string, unknown>` but should narrow value type.
- **Impact**: Type precision gap; allows unsafe casts; eslint `@typescript-eslint/no-explicit-any` flagged it.
- **Recommended Fix**: Define precise type for mock DB structure (e.g., `Record<string, any>` → `Record<string, { players?: any[], teams?: any[] }>`).
- **Proposed Wave**: 3-types
- **Effort**: S

---

## Summary

- **P0 findings (Wave 1b-trivial)**: 12 — unused imports and variables, trivial dead code.
- **P1 findings (1b + 2-style)**: 4 — hardcoded colors, @ts-ignore violations.
- **P2 findings (2-correctness/perf/refactor)**: 6 — hook rules, setState cascade, large components, logging abstraction.
- **P3 findings (3-types/nice-to-have)**: 1 — type precision gap.

All 22 findings are actionable and non-invasive (no code rewrites required for P0/P1). Recommend prioritizing P2 hook violation and cascading render fix to unblock Wave 2 performance work.

