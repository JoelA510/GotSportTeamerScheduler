# Epic 17: Tech Debt — Framework Upgrades

> Lessons learned from the BUILDTWO prototype that should be adopted as future tech debt when capacity allows.

## Scope

These are **non-blocking** upgrades identified during the BUILDTWO integration analysis. They are NOT needed for current functionality but will improve DX and performance long-term.

## Items

| Item         | Current | Target          | Effort | Status      | Notes                            |
| ------------ | ------- | --------------- | ------ | ----------- | -------------------------------- |
| Vite         | 5.x     | 6.x             | Low    | [PROCESSED] | Upgrade verified by build        |
| React        | 18.x    | 19.x            | Medium | [PROCESSED] | Types added, build verified      |
| Tailwind CSS | 3.x     | 4.x (CSS-first) | High   | [PROCESSED] | @theme migration, config deleted |
| TypeScript   | None    | Incremental     | High   | [PROCESSED] | tsc --noEmit, tsconfig.json      |

## Prerequisites

- All 4 BUILDTWO integration phases must be complete ✅
- React Query migration should be evaluated first (replaces custom clear-and-refetch)

## Decision

Defer to next major milestone. Track as backlog items.
