[← Back to Documentation Index](docs/README.md)
---

# Front-End Architecture

This document describes the implemented frontend architecture for SquadLogic. The frontend is a React 19 Single-Page Application built with Vite 6, deployed as a static bundle on Vercel.

## Routing & Navigation

- **Router**: `react-router-dom` v7 with `<BrowserRouter>`.
- **Layout**: `DashboardLayout` provides a persistent sidebar (`Sidebar.jsx`) on desktop and a collapsible hamburger drawer on mobile.
- **Page Loading**: All page components are lazy-loaded via `React.lazy()` in `App.jsx` for optimal bundle splitting.
- **Route Protection**: `<ProtectedRoute requiredPermission={PERMISSIONS.*}>` gates admin-only pages with immediate redirect for unauthorized users.
- **Provider Hierarchy**: `BrowserRouter > AuthProvider > OrganizationProvider > ImportProvider > ThemeProvider > ErrorBoundary`.

## Current Routes

| Route                   | Page Component             | Description                                                     |
| ----------------------- | -------------------------- | --------------------------------------------------------------- |
| `/`                     | `DashboardPage`            | Dashboard with metrics, workflow progression, and league status |
| `/import`               | `ImportPage`               | GotSport CSV data ingestion with validation                     |
| `/teams`                | `TeamAnalysisPage`         | Roster generation, analysis, drag-and-drop overrides            |
| `/fields`               | `FieldManagementPage`      | Venue/field/blackout date CRUD with weekly grid                 |
| `/schedule/practice`    | `PracticeSchedulingPage`   | Practice slot assignment with lock/unlock toggles               |
| `/schedule/game`        | `GameSchedulingPage`       | Interactive game schedule grid with drag-and-drop               |
| `/settings`             | `SettingsPage`             | League config, theme branding, season management                |
| `/compliance`           | `AdminComplianceDashboard` | Registration forms, waiver tracking                             |
| `/reporting`            | `AdminReportingDashboard`  | Game metrics, standings, charts                                 |
| `/standings`            | `LeagueStandings`          | Score entry, standings tables, tie-breaker logic                |
| `/registration/:formId` | `RegistrationFlow`         | Public registration form flow                                   |
| `/team/:teamId`         | `TeamPortalPage`           | Coach/parent portal — roster, schedule, RSVP, chat              |

## State Management

State is managed entirely through **React Context** — no external state library is used.

| Context               | File                               | Purpose                                             |
| --------------------- | ---------------------------------- | --------------------------------------------------- |
| `AuthContext`         | `contexts/AuthContext.jsx`         | Supabase auth session, user profile, login/logout   |
| `OrganizationContext` | `contexts/OrganizationContext.jsx` | Active org selection, org membership, org switching |
| `ImportContext`       | `contexts/ImportContext.jsx`       | CSV import state, parsed data, validation results   |
| `ThemeContext`        | `contexts/ThemeContext.jsx`        | Theme selection (dark/light/party/club), timezone   |

## Custom Hooks (`frontend/src/hooks/`)

| Hook                     | Purpose                                                          |
| ------------------------ | ---------------------------------------------------------------- |
| `useDashboardData`       | Aggregates team, practice, game, and evaluation data             |
| `useTeamSummary`         | Team generation run data from `scheduler_runs`                   |
| `useTeamAnalysis`        | Player grouping by age/gender with season-aware age calculations |
| `useTeamPersistence`     | Snapshot packaging and Supabase persistence triggers             |
| `usePracticeSummary`     | Practice scheduling run data                                     |
| `usePracticeAssignments` | Practice slot assignment data                                    |
| `useGameSummary`         | Game scheduling run data                                         |
| `useGameAssignments`     | Game assignment data by run ID                                   |
| `useGameSlots`           | Available game time slots                                        |
| `useFields`              | Field and venue CRUD operations                                  |
| `useConflicts`           | Real-time conflict detection across scheduling data              |
| `useSchedulerRun`        | Generic scheduler run execution and status tracking              |
| `usePermission`          | RBAC permission checks against current user role                 |
| `useTeamPortal`          | Team portal data — roster, schedule, RSVP, chat                  |

## Component Organization

```text
frontend/src/components/
├── scheduling/          # Game Schedule Grid components
│   ├── GameScheduleGrid.jsx    # Interactive field × timeslot grid
│   ├── FieldColumn.jsx         # Droppable column per field
│   ├── TimeSlotDropZone.jsx    # Droppable zone per time slot
│   ├── GameCard.jsx            # Draggable game assignment card
│   └── GameConflictBanner.jsx  # Conflict summary banner
├── teaming/             # Roster management components
│   └── RosterManager.jsx       # Drag-and-drop roster with @dnd-kit
├── ui/                  # Shared UI components
├── DashboardWorkflow.jsx       # 6-step workflow orchestration
├── ImportPanel.jsx             # CSV import with validation
├── TeamPersistencePanel.jsx    # Team save with optimistic UI
├── OutputGenerationPanel.jsx   # CSV/email export generation
├── Sidebar.jsx                 # Navigation with org/season switcher
├── ProtectedRoute.jsx          # RBAC route guard
├── ErrorBoundary.jsx           # Global error boundary (Deep Space Glass)
└── ...                         # Other panels and shared components
```

## Design System — "Deep Space Glass"

Defined in `frontend/src/index.css` with four themes controlled via `data-theme` attribute:

- **`dark`** (default) — Deep navy backgrounds, sky-blue accents
- **`light`** — Slate/white backgrounds, ocean-blue accents
- **`party`** — Purple/fuchsia backgrounds, pink accents
- **`club`** — Dynamic club branding (with `data-club-mode` light/dark sub-modes)

Key CSS utilities: `.glass-panel`, `.glass-button`, `.glass-input`, `.card-glass`, `.animate-fadeIn`, `.animate-slideUp`.

All colors use CSS custom properties (e.g., `var(--color-bg-app)`, `var(--color-primary)`, `var(--color-text-accent)`) that auto-switch with theme.

## Drag-and-Drop

Two drag-and-drop surfaces use `@dnd-kit`:

1. **RosterManager** — Cross-team player swaps with `SortableContext` per team column
2. **GameScheduleGrid** — Game card moves across field × timeslot grid with `useDroppable` zones and real-time validation feedback

Both follow the same pattern: `DndContext` with `closestCorners` collision detection, `DragOverlay` for ghost cards, optimistic UI with rollback on persistence failure.

## Supabase Integration

- **Client**: `frontend/src/lib/supabaseClient.js` auto-switches between real and mock clients based on `VITE_USE_MOCK_SUPABASE` or credential availability.
- **Mock**: `frontend/src/lib/mockSupabaseClient.js` — sessionStorage-backed in-memory mock simulating `.from()`, `.select()`, `.insert()`, `.auth`, etc. Used by E2E tests.
- **Rule**: All code imports from `supabaseClient.js` — never import the mock or `@supabase/supabase-js` directly.

## Testing

- **Unit/Integration**: Vitest + `@testing-library/react` + jsdom — `npm run test`
- **E2E**: Playwright-BDD with Gherkin `.feature` files + TypeScript step definitions — `npm run test:e2e`
- **Coverage**: V8 provider with thresholds (60% statements, 50% branches, 55% functions, 60% lines) scoped to `packages/core/src/**` and `frontend/src/hooks/**`

## Accessibility (WCAG 2.2 AA)

- Keyboard-accessible interactive elements with visible focus indicators
- Semantic HTML landmarks (`<header>`, `<main>`, `<nav>`, `<section>`, `<article>`, `<footer>`)
- Non-drag alternatives for drag-and-drop interactions
- Sufficient color contrast across all themes


## Wave 4 Onboarding Route Flow

- Route added: `/organizations/new` (renders `frontend/src/pages/OrganizationCreation.jsx`).
- Hook added: `frontend/src/hooks/useOrganizationCreation.js` handles schema validation + `initialize_new_tenant` RPC.
- Cold-start behavior: authenticated users with zero organizations who hit `/` are redirected to `/organizations/new`; successful creation navigates back to dashboard via SPA navigation.
- Guardrails preserved: `/auth/reset-password` and `/invite/:code` remain directly reachable and are not shadowed by zero-org routing.
