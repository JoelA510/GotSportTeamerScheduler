[← Back to Documentation Index](docs/README.md)
---

# Architecture & Technology Overview

## System Architecture

SquadLogic is a **monorepo SPA** (Single-Page Application) that converts raw GotSport registration data into teaming and scheduling frameworks for youth sports organizations. The system is structured into three layers:

1. **Frontend (React 19 + Vite 6)**: A Vite-built React SPA deployed as a static bundle on Vercel. Uses `VITE_*`-scoped environment variables. The frontend contains all UI components, routing, and state management via React Context providers.

2. **Core Domain Logic (`@squadlogic/core`)**: A pure JavaScript package within the monorepo (`packages/core/src/`) containing all scheduling algorithms, team generation, metrics evaluation, and data validation. Framework-agnostic — no React imports allowed.

3. **Backend (Supabase)**: PostgreSQL database with Row Level Security, Edge Functions (Deno/TypeScript) for persistence and calendar feeds, and Auth for user management. All data access is organization-scoped via `is_org_member()` RLS policies.

```text
┌─────────────────────────────────────────────────────────┐
│  Vercel (Static SPA Hosting)                            │
│  ┌───────────────────────────────────────────────────┐  │
│  │  React 19 + Vite 6 Frontend                       │  │
│  │  • React Router v7 (lazy-loaded pages)            │  │
│  │  • Lightning-class Design System (CSS + TW4)     │  │
│  │  • React Context (Auth, Org, Import, Theme)       │  │
│  │  • FeatureGuard & FeatureFlagSchema (Zod)         │  │
│  │  • @dnd-kit (drag-and-drop scheduling)            │  │
│  │  • Recharts (dashboard charts)                    │  │
│  └────────────────────┬──────────────────────────────┘  │
└───────────────────────┼─────────────────────────────────┘
                        │ HTTPS
┌───────────────────────┼─────────────────────────────────┐
│  Supabase                                               │
│  ├── Auth (JWT, email/password, magic link)              │
│  ├── PostgreSQL + RLS (organization-scoped)              │
│  ├── Edge Functions:                                     │
│  │   ├── team-persistence                               │
│  │   ├── practice-persistence                           │
│  │   ├── game-persistence                               │
│  │   ├── calendar-feed (public ICS, no JWT)              │
│  │   └── import-validation                              │
│  └── Storage (CSV imports, exported files)               │
└─────────────────────────────────────────────────────────┘
```

## Technology Stack

| Layer            | Technology                                                                            |
| ---------------- | ------------------------------------------------------------------------------------- |
| Frontend         | React 19, Vite 6, react-router-dom v7                                                 |
| Styling          | Tailwind CSS 4 (`@tailwindcss/vite`) + Vanilla CSS ("Lightning-class" design system, light + dark) |
| State Management | React Context (Auth, Import, Organization, Theme)                                     |
| Backend          | Supabase (PostgreSQL, Edge Functions, Auth, Storage)                                  |
| Unit Testing     | Vitest + @testing-library/react + jsdom                                               |
| E2E Testing      | Playwright-BDD (Gherkin `.feature` files + TypeScript step definitions)               |
| Linting          | ESLint (flat config) + Prettier                                                       |
| Type Checking    | TypeScript (`checkJs` + `allowJs`, `strict: false`)                                   |
| Drag & Drop      | @dnd-kit/core + @dnd-kit/sortable                                                     |
| Charts           | Recharts                                                                              |
| Icons            | lucide-react                                                                          |
| Deployment       | Vercel (static SPA + API rewrites)                                                    |

## Domain Modules (`packages/core/src/`)

The core package contains pure JavaScript modules implementing the scheduling domain:

- **`teamGeneration.js`** — Balanced roster allocation using a modular **Evaluator Registry**.
- **`evaluators/`** — A specialized directory of metrics classes (e.g., `BuddyEvaluator`, `SkillEvaluator`) extending `BaseEvaluator`.
- **`practiceScheduling.js`** — Conflict-aware weekday practice slot assignment with daylight expansion.
- **`gameScheduling.js`** — Round-robin Saturday game generation with slot allocation.
- **`practiceMetrics.js` / `gameMetrics.js`** — Fairness scoring and conflict detection using standard Evaluator patterns.
- **`evaluationPipeline.js`** — Automated readiness assessment across all scheduling outputs
- **`gameValidation.js`** — Real-time drag-time validation for the interactive Game Schedule Grid
- **`outputGeneration.js`** — CSV/export formatting for master and per-team schedule files
- **`teamPersistenceSnapshot.js`** / **`teamPersistenceApi.js`** — Snapshot packaging and transactional persistence

## Free-Tier Constraints & Mitigations

- **Vercel**: Deployed on Vercel's free tier. Production builds are optimized with code splitting via `React.lazy()` page loading.
- **Supabase**: 500 MB Postgres, project pause after 7 days inactivity. Mitigated by a **weekly keep-alive cron** in the GitHub Actions CI pipeline (Monday noon UTC) that pings the Supabase REST API.
- **Client Performance**: Code-split pages, lazy-loaded routes, and minimal bundle size via Vite's tree-shaking.

## Integration Points

- **GotSport**: CSV import via the Data Import page — parsed client-side with PapaParse, validated server-side via the `import-validation` Edge Function.
- **Calendar Sync**: Public ICS feeds generated by the `calendar-feed` Edge Function, accessible via token-authenticated URLs with 90-day expiry and rotation support.
- **Authentication**: Supabase Auth with email/password. Role-based access control via `usePermission` hook and `<ProtectedRoute>` component.
- **Configuration & Flags**: Hardened via `FeatureFlagSchema` (Zod validation in `featureFlags.js`) and rendered via the `<FeatureGuard>` component.
- **Observability**: `audit_log` table for admin action tracking; retrieved via the secure `get_settings_audit_log` RPC for enterprise visibility.
