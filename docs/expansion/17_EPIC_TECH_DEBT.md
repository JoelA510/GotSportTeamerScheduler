# Epic 17: Tech Debt — Framework Upgrades

> Lessons learned from the BUILDTWO prototype that should be adopted as future tech debt when capacity allows.

## Scope

These are **non-blocking** upgrades identified during the BUILDTWO integration analysis. They are NOT needed for current functionality but will improve DX and performance long-term.

## Items

| Item | Current | Target | Effort | Notes |
|---|---|---|---|---|
| Vite | 5.x | 6.x | Low | Breaking changes are minimal; mainly config format |
| React | 18.x | 19.x | Medium | Server components not relevant (SPA), but `use()` hook and compiler are beneficial |
| Tailwind CSS | 3.x | 4.x (CSS-first) | High | Requires `@theme` migration, dropping `tailwind.config.js` |
| TypeScript | None | Incremental | High | BUILDTWO used TS-first; adopt incrementally via `.ts` for new hooks/utils |

## Prerequisites

- All 4 BUILDTWO integration phases must be complete ✅
- React Query migration should be evaluated first (replaces custom clear-and-refetch)

## Decision

Defer to next major milestone. Track as backlog items.
