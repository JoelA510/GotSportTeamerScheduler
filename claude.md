# CLAUDE.md — SquadLogic Project Instructions

## 1. Role and Scope

You are an **Autonomous Developer** working on SquadLogic — proficient across the full stack: React frontend, Node.js domain logic, Supabase (PostgreSQL, Edge Functions, RLS policies), and CI/CD.

SquadLogic is a youth sports administration platform that converts raw GotSport registration data into teaming and scheduling frameworks. It is a feature-complete v1.0 MVP deployed on Vercel with a Supabase (PostgreSQL) backend.

---

## 2. Scope Guardrails (Hard Exclusions)

The following are **STRICTLY OUT OF SCOPE** — refuse to implement these even if asked:

1. **Website/CMS/Public Site Generation** — no hosting, website builders, or public club sites.
2. **Billing/Payment Collection** — no collecting money from players/families (SaaS billing display OK).
3. **Sensitive Document Storage** — no file uploads for waivers, IDs, birth certs (boolean toggles OK).
4. **Online Store/Merch** — no e-commerce.
5. **Sponsor Management** — no sponsor CRM.
6. **AI Assistants/Chatbots** — no integrated AI copilots (simple algorithmic automation is fine).
7. **Payment Processing** — no payment-related code or UI for end-users.

**Privacy & Data Rules:**

- **Data Minimization**: Only store PII necessary for scheduling/comms (Name, Email, Role, Team).
- **No PII in Repo**: Never commit test data containing real personal information.
- **RLS Enforcement**: All data access must be gated by Supabase Row Level Security policies.
- **Never expose the Supabase service-role key** in environment variables prefixed with `VITE_`.

---

## 3. Agent Workflow & Execution (Runbook)

When executing the roadmap file-by-file, follow this exact loop:

1. **Read Next Epic**: Check `docs/expansion/00_INDEX.md` or `docs/expansion/03_ROADMAP.md` for the next unprocessed Epic.
2. **Read Epic File**: Ingest the relevant `docs/expansion/1X_EPIC_*.md`.
3. **Process PRs Sequentially**: Create branch → Implement → Verify → Self-Review (using `docs/expansion/05_CODE_REVIEW_TEMPLATE.md`) → Commit → Mark Complete.

### Critical Rules (Agent Behavior)

- **Refactor First**: If a PR requires modifying existing messy code, refactor it into a clean utility/hook _before_ adding new logic.
- **Test-Driven**: Create the test file `tests/<feature>.test.js` _before_ or _during_ implementation.
- **No Broken Main**: Never leave the `main` branch in a broken state.
- **Blocker Handling**: If a hard blocker (missing secret, impassable error) occurs, write to `docs/expansion/98_PROGRESS_LOG.md` or `99_BLOCKERS.md` and stop.

### Definition of Done (Per PR)

- [ ] Types check (TypeScript/JSDoc).
- [ ] Tests pass (Unit + Integration). _(Note: E2E runs separately in CI/bulk)_
- [ ] Linter is happy (`npm run lint`).
- [ ] New exports are registered in their package/module index.
- [ ] Database migrations applied (if any).

---

## 4. Architecture

### Monorepo Structure (npm Workspaces)

```text
SquadLogic/
├── frontend/           # Vite + React 19 SPA
│   └── src/
│       ├── components/ # UI components (flat + subdirs: scheduling/, teaming/, ui/)
│       ├── contexts/   # React Contexts (Auth, Import, Organization, Theme)
│       ├── hooks/      # Custom hooks (useConflicts, useDashboardData, etc.)
│       ├── layouts/    # Layout wrappers (DashboardLayout)
│       ├── lib/        # supabaseClient, mockSupabaseClient, logger, apiClient
│       ├── pages/      # Route-level page components
│       ├── constants/  # App constants (permissions, roadmap)
│       └── utils/      # Frontend utilities
├── packages/core/      # @squadlogic/core — shared domain logic (pure JS, NO React imports)
│   └── src/            # Scheduling engines, metrics, persistence, validation, team generation
├── supabase/           # Edge Functions + migrations + seed.sql
│   ├── functions/      # Edge Functions (calendar-feed, game-persistence, etc.)
│   └── migrations/     # SQL migrations
├── tests/              # All tests (unit, integration, e2e)
│   ├── e2e/            # Playwright-BDD tests (features/ + steps/)
│   └── *.test.{js,jsx} # Vitest unit/integration tests
├── scripts/            # Build and utility scripts
├── docs/               # Architecture, UI/UX guidelines, roadmap
└── .github/workflows/  # CI pipeline (ci.yml)
```

> **⚠️ Vite root is `frontend/`** — `vite.config.js` at project root sets `root: 'frontend'` and `envDir: '..'`. All frontend paths are relative to `frontend/`, but env files live in the project root.

### Key Technologies

| Layer         | Technology                                           |
|---------------|------------------------------------------------------|
| Frontend      | React 19, Vite 6, react-router-dom v7                |
| Styling       | Tailwind CSS 4 (`@tailwindcss/vite` plugin) + Vanilla CSS design system |
| State         | React Context (Auth, Import, Organization, Theme)    |
| Backend       | Supabase (PostgreSQL, Edge Functions, Auth, Storage) |
| Unit Testing  | Vitest + @testing-library/react + jsdom              |
| E2E Testing   | Playwright-BDD (Gherkin features + TS step defs)     |
| Linting       | ESLint (flat config) + Prettier                      |
| Type Checking | TypeScript (checkJs + allowJs, strict: false)        |
| Drag & Drop   | @dnd-kit/core + @dnd-kit/sortable                    |
| Charts        | Recharts                                             |
| Icons         | lucide-react                                         |
| Deployment    | Vercel (static SPA + rewrites)                       |

### Path Aliases (vite.config.js + tsconfig.json)

- `@` → `packages/core/src/`
- `src` → `packages/core/src/`
- `@squadlogic/core` → `packages/core/src/`

**Always use `@squadlogic/core/...` for imports from the core package in frontend code.**

---

## 5. Coding Conventions

### Formatting (Prettier — enforced by ESLint)

- Semicolons: **yes** · Quotes: **single** · Trailing commas: **es5**
- Print width: **100** · Tab width: **2**

### Component Patterns

- Components are **`.jsx`** files (not `.tsx`) — the project uses `checkJs`/`allowJs` for type checking.
- Use **functional components** with hooks exclusively.
- Pages are lazy-loaded via `React.lazy()` in `App.jsx`.
- Protected routes use `<ProtectedRoute requiredPermission={PERMISSIONS.MANAGE_ORGANIZATION}>`.
- Provider wrapping order: `BrowserRouter > AuthProvider > OrganizationProvider > ImportProvider > ThemeProvider > ErrorBoundary`.

### File Organization Rules

- **Domain logic** → `packages/core/src/` — must remain pure and framework-agnostic (no React imports).
- **React components** → `frontend/src/components/` — use subdirs for feature groupings (`scheduling/`, `teaming/`, `ui/`).
- **Custom hooks** → `frontend/src/hooks/` — prefixed with `use`.
- **Page components** → `frontend/src/pages/`.
- **Contexts** → `frontend/src/contexts/`.
- **Supabase Edge Functions** → `supabase/functions/<function-name>/index.ts`.

### RBAC System

Roles: `admin`, `coach`, `player`, `parent`, `staff`.
Permissions are defined in `frontend/src/constants/permissions.js` and enforced via the `usePermission` hook and `<ProtectedRoute>`.

---

## 6. Design System — "Deep Space Glass"

Defined in `frontend/src/index.css`. Themes are controlled via `data-theme` attribute on `:root`:

- **`dark`** (default) — Deep navy backgrounds, sky-blue accents
- **`light`** — Slate/white backgrounds, ocean-blue accents
- **`party`** — Purple/fuchsia backgrounds, pink accents
- **`club`** — Dynamic club branding (with `data-club-mode` light/dark sub-modes)

### CSS Utilities (always prefer these over custom styles)

- `.glass-panel` / `.glass-panel-premium` — Frosted glass containers
- `.card-glass` — Inner card surfaces
- `.glass-button` / `.glass-button-secondary` — Interactive buttons
- `.glass-input` — Form inputs
- `.text-display` — Display typography (Outfit font)
- `.text-accent` / `.text-muted` — Text color utilities
- `.animate-fadeIn` / `.animate-slideUp` / `.animate-pulseGlow` — Animations

### Design Tokens (CSS Variables)

All colors use CSS custom properties that auto-switch with theme:

- Backgrounds: `var(--color-bg-app)`, `var(--color-bg-surface)`, `var(--color-bg-glass)`
- Text: `var(--color-text-primary)`, `var(--color-text-secondary)`, `var(--color-text-muted)`, `var(--color-text-accent)`
- Brand: `var(--color-primary)`, `var(--color-primary-400)`, `var(--color-primary-600)`
- Status: `var(--color-status-success)`, `var(--color-status-warning)`, `var(--color-status-error)`
- Effects: `var(--shadow-soft)`, `var(--shadow-glow)`, `var(--backdrop-blur)`
- Spacing: `var(--space-1)` through `var(--space-16)` (4px grid)
- Radius: `var(--radius-sm)` through `var(--radius-full)`

**Do NOT introduce new color values or inline style overrides** — update shared tokens in `index.css` instead.

---

## 7. Supabase & Mock Client

### Environment Switching

The app auto-switches between real and mock Supabase clients:

- **Real mode**: Uses `@supabase/supabase-js` with credentials from `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`.
- **Mock mode**: Activates when `VITE_USE_MOCK_SUPABASE=true` or credentials are missing. Uses `frontend/src/lib/mockSupabaseClient.js` — a **sessionStorage-backed** in-memory mock that simulates `.from()`, `.select()`, `.insert()`, `.auth`, etc.

**All code imports from `frontend/src/lib/supabaseClient.js`** — never import the mock or `@supabase/supabase-js` directly.

### Edge Functions

Located in `supabase/functions/`. Each function has its own directory with an `index.ts`. Shared utilities live in `supabase/functions/_shared/`.

---

## 8. Testing

### Unit & Integration Tests (Vitest)

- **Command**: `npm run test` (or `npm run test:watch`)
- **Config**: `vitest.config.js` — environment: jsdom, setup: `tests/setup.js`
- **Location**: `tests/*.test.{js,jsx}` (e2e excluded)
- **Coverage thresholds**: statements 60%, branches 50%, functions 55%, lines 60%
- **Coverage scope**: `packages/core/src/**` and `frontend/src/hooks/**`

### E2E Tests (Playwright-BDD)

- **Command**: `npm run test:e2e` (runs `bddgen && playwright test`)
- **Config**: `playwright.config.ts`
- **Features**: `tests/e2e/features/**/*.feature` (Gherkin syntax)
- **Step Definitions**: `tests/e2e/steps/**/*.ts` (TypeScript)
- **Generated specs**: `.features-gen/` (gitignored, auto-generated by `bddgen`)
- **Web server**: Auto-starts Vite dev server on port 5173 with `VITE_USE_MOCK_SUPABASE=true`
- **Browser**: Chromium only
- **Workers**: 50% locally, 100% in CI (but CI runs with `--workers=1` for mock isolation)

### E2E Rules That Prevent Flaky Tests

1. **Always include `organization_id`** in mock data injections — React hooks filter by active org, causing empty states if omitted.
2. **Use DOM-based assertions only** — never assert on mock internal state or sessionStorage directly.
3. **Wait for hydration** — always use `expect(locator).toBeVisible()` or `page.waitForSelector()` before interacting with elements. React lazy-loading causes race conditions.
4. **Worker isolation** — CI runs with `--workers=1` to prevent sessionStorage cross-contamination between parallel workers.
5. **After changing `.feature` files**, always run `bddgen` to regenerate specs before running tests.
6. **Debugging failures**: Check `__MOCK_DB__` key in `sessionStorage` via Browser DevTools to inspect seeded data.

### Verification Sequence (before committing)

1. `npm run typecheck` — TypeScript type checking
2. `npm run lint` — ESLint
3. `npm run test` — Unit/Integration tests
4. `npm run test:e2e` — E2E tests (requires mock mode)

---

## 9. UI/UX & Accessibility Guidelines

When asked to perform a "UI/UX pass", "visual polish", or work on frontend views, follow the Agent UI/UX Guidelines:

1. **Reference the docs**:
   - **Agent guidelines**: `docs/ui/agent-ui-ux-guidelines.md` (canonical behavior rules for UI/UX work)
   - **P0/P1 checklist**: `docs/ui/ui-ux-pass.md` + `docs/ui/ui-ux-pass-summary.md`
   - **P2 visual polish**: `docs/ui/ui-ux-polish.md`
   - **Rule IDs**: `docs/ui/ui-ux-rules.json`
2. **Prioritization**: Always fix P0 and P1 issues before applying P2 visual polish.
3. **Accessibility (WCAG 2.2 AA)**:
   - Ensure all interactive elements are keyboard accessible and have visible focus indicators.
   - Maintain sufficient color contrast.
   - Provide non-drag alternatives for drag-and-drop interactions in scheduling grids.
4. **Semantic HTML**: Use proper landmarks (`<header>`, `<main>`, `<nav>`, `<section>`, `<article>`, `<footer>`).
5. **Design system alignment**: Reuse existing CSS classes and variables from `App.css` and `index.css`. Do not introduce new colors, spacings, or radii when equivalent tokens already exist.

---

## 10. Environment Variables

| Variable | Purpose | Committed? |
|----------|---------|------------|
| `VITE_SUPABASE_URL` | Supabase project URL | `.env` (yes) |
| `VITE_SUPABASE_ANON_KEY` | Supabase publishable (anon) key | `.env.local` (no) |
| `VITE_USE_MOCK_SUPABASE` | Force mock Supabase client (`true`) | `.env.local` / CI |
| `VITE_PERSISTENCE_ENDPOINT` | Custom persistence API endpoint | `.env.local` (no) |
| `TEST_ADMIN_EMAIL` | E2E admin test email | `.env.test` (no) |
| `TEST_COACH_EMAIL` | E2E coach test email | `.env.test` (no) |
| `TEST_PARENT_EMAIL` | E2E parent test email | `.env.test` (no) |
| `TEST_PASSWORD` | E2E test password | `.env.test` (no) |

**Never commit** `.env`, `.env.local`, or `.env.test` — they are gitignored. Use the `.example` templates.

---

## 11. CI Pipeline

GitHub Actions (`.github/workflows/ci.yml`):

1. Checkout → Node 20 setup → `npm install`
2. `npm run typecheck`
3. `npm run lint`
4. `npm run test`
5. `npm run frontend:build`
6. Install Playwright Chromium → `npm run test:e2e -- --workers=1`

Plus a **weekly keepalive** cron job (Monday noon UTC) that pings the Supabase REST API to prevent free-tier project pausing.

---

## 12. Common Commands

| Command | Description |
|---------|-------------|
| `npm run frontend:dev` | Start Vite dev server (port 5173) |
| `npm run frontend:build` | Production build → `dist/` |
| `npm run test` | Vitest unit/integration tests |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:coverage` | Vitest with coverage report |
| `npm run test:e2e` | `bddgen` + Playwright E2E suite |
| `npm run test:e2e:ui` | Playwright with interactive debug UI |
| `npm run typecheck` | TypeScript type checking (`tsc --noEmit`) |
| `npm run lint` | ESLint check |
| `npm run lint:fix` | ESLint auto-fix |
| `npm run format` | Prettier format all files |

---

## 13. Key Documentation Reference

| Document | Path |
|----------|------|
| Architecture overview | `docs/architecture.md` |
| Frontend architecture | `docs/frontend-architecture.md` |
| Data modeling | `docs/data-modeling.md` |
| RLS policies | `docs/rls-policies.md` |
| Requirements | `docs/requirements.md` |
| E2E master plan | `docs/testing/e2e_master_plan.md` |
| Test checklist | `TEST_CHECKLIST.md` |
| Expansion roadmap | `docs/expansion/03_ROADMAP.md` |
| Agent runbook (full) | `docs/expansion/04_AGENT_RUNBOOK.md` |
| Code review template | `docs/expansion/05_CODE_REVIEW_TEMPLATE.md` |
| Progress log | `docs/expansion/98_PROGRESS_LOG.md` |
| Security audit | `docs/security/audit_and_remediation_plan.md` |
| UI/UX agent guidelines | `docs/ui/agent-ui-ux-guidelines.md` |
| UI/UX checklist | `docs/ui/ui-ux-pass.md` |
| UI/UX polish guide | `docs/ui/ui-ux-polish.md` |
